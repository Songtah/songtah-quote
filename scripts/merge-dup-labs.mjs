/**
 * 牙體技術所重複建檔:A(直接封存) 與 B(補欄位後封存)。
 *
 * 安全設計:
 *  - 預設 dry-run,只印計畫。加 --execute 才寫入。
 *  - 「刪除」一律用 Notion archive(垃圾桶,30 天內可還原),不做永久刪除。
 *  - 每筆寫入前**重新讀取兩張頁面的當下狀態**再驗一次(dup 仍無機構代碼、
 *    仍無往來紀錄、keeper 該欄位仍為空),條件不符一律 skip 並記錄原因。
 *  - 補欄位後 read-back 驗證,值不符就不封存 dup。
 *  - 全程寫出 log CSV(含還原用的 page id)。
 *
 * 排除:機構狀態互相衝突的組(例:一筆開業一筆停業)不自動處理——
 * 哪一個才是真的,機器無從判斷,錯了會直接影響有效名單。
 */
import { config } from 'dotenv'; config({ path: '.env.local' })
import { Client } from '@notionhq/client'
import { writeFile } from 'node:fs/promises'
const EXECUTE = process.argv.includes('--execute')
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const { DB } = await import('../lib/notion/shared.ts')
const bare = s => (s ?? '').replace(/-/g, '')
const txt=(p,k)=>(p.properties?.[k]?.rich_text??[]).map(t=>t.plain_text).join('')
const sel=(p,k)=>p.properties?.[k]?.select?.name??''
const num=(p,k)=>p.properties?.[k]?.number??null
const title=(p,k)=>(p.properties?.[k]?.title??[]).map(t=>t.plain_text).join('')
async function scan(dbid, filter){const o=[];let c;do{const r=await notion.databases.query({database_id:dbid,page_size:100,...(filter?{filter}:{}),...(c?{start_cursor:c}:{})});o.push(...r.results);c=r.has_more?r.next_cursor:undefined}while(c);return o}
const shape=p=>({id:p.id,name:title(p,'客戶名稱'),code:txt(p,'機構代碼').trim(),status:sel(p,'機構狀態'),
  city:sel(p,'縣市'),district:sel(p,'行政區')||txt(p,'行政區'),sp:sel(p,'負責業務'),
  phone:p.properties?.['電話']?.phone_number??'',addr:txt(p,'地址'),stage:sel(p,'開發階段'),
  level:sel(p,'客戶等級'),owner:txt(p,'負責人'),
  docs:num(p,'牙醫師數'),techs:num(p,'牙體技術師數'),trainees:num(p,'牙體技術生數'),
  heads:(num(p,'牙醫師數')??0)+(num(p,'牙體技術師數')??0)+(num(p,'牙體技術生數')??0),
  created:p.created_time??'',url:`https://www.notion.so/${bare(p.id)}`})

// ── 往來紀錄 ──
const refs=new Map()
const bump=(id,k)=>{const b=bare(id);const e=refs.get(b)??{};e[k]=(e[k]??0)+1;refs.set(b,e)}
for(const [dbid,prop,key] of [[DB.visits,'🏥 牙科單位資料','visits'],[DB.tickets,'🏥 牙科單位資料','tickets'],
  [DB.equipment,'客戶名稱','equipment'],[DB.registrations,'客戶配對','events'],[DB.campaignMembers,'客戶','campaigns']]){
  if(!dbid) continue
  for(const p of await scan(dbid)) for(const r of (p.properties?.[prop]?.relation??[])) bump(r.id,key)
}
for(const [dbid,key] of [[process.env.NOTION_ORDERS_DB,'orders'],[process.env.NOTION_QUOTES_DB,'quotes']]){
  if(!dbid) continue
  for(const p of await scan(dbid)){const cid=txt(p,'客戶ID').trim(); if(cid) bump(cid,key)}
}
const hist=id=>Object.values(refs.get(bare(id))??{}).reduce((s,n)=>s+n,0)
const histStr=id=>Object.entries(refs.get(bare(id))??{}).map(([k,n])=>`${k}${n}`).join(' ')||'—'

// ── 分組(與 dry-run 同一套規則) ──
const labs=(await scan(DB.customers,{property:'客戶類型',select:{equals:'牙體技術所'}})).filter(p=>title(p,'客戶名稱')).map(shape)
const norm=s=>s.replace(/[\s（）()有限公司股份]/g,'')
const groups=new Map()
for(const l of labs){const k=norm(l.name)+'|'+l.city+'|'+l.district;(groups.get(k)??groups.set(k,[]).get(k)).push(l)}
const score=l=>(l.code?1000:0)+hist(l.id)*100+(l.sp?50:0)+(l.phone?20:0)+(l.addr?10:0)+(l.heads>0?10:0)+(l.stage?5:0)+(l.level?5:0)+(l.owner?5:0)

// 欄位定義:key → [Notion 欄位, 型別]
const FIELDS=[['phone','電話','phone'],['addr','地址','text'],['code','機構代碼','text'],
  ['sp','負責業務','select'],['stage','開發階段','select'],['level','客戶等級','select'],['owner','負責人','text'],
  ['docs','牙醫師數','number'],['techs','牙體技術師數','number'],['trainees','牙體技術生數','number']]
const isEmpty=v=>v===null||v===undefined||v===''||v===0
const propValue=(type,v)=>type==='phone'?{phone_number:v}:type==='text'?{rich_text:[{text:{content:String(v)}}]}
  :type==='select'?{select:{name:v}}:{number:v}

const plan=[]
for(const g of [...groups.values()].filter(a=>a.length>1)){
  const sorted=[...g].sort((a,b)=>score(b)-score(a)||a.created.localeCompare(b.created))
  const keep=sorted[0]
  const statuses=new Set(g.map(x=>x.status).filter(Boolean))
  for(const dup of sorted.slice(1)){
    if(dup.code||hist(dup.id)>0) continue                       // C:人工合併,不碰
    if(statuses.size>1){ plan.push({bucket:'SKIP',keep,dup,fills:[],reason:`機構狀態衝突(${[...statuses].join('/')})`}); continue }
    const fills=FIELDS.filter(([k])=>!isEmpty(dup[k])&&isEmpty(keep[k])).map(([k,label,type])=>({k,label,type,value:dup[k]}))
    plan.push({bucket:fills.length?'B':'A',keep,dup,fills,reason:''})
  }
}
const A=plan.filter(p=>p.bucket==='A'), B=plan.filter(p=>p.bucket==='B'), S=plan.filter(p=>p.bucket==='SKIP')
console.log(`模式: ${EXECUTE?'★ 實際執行':'dry-run(不寫入)'}`)
console.log(`A 直接封存 ${A.length} 筆 / B 補欄位後封存 ${B.length} 筆 / 跳過 ${S.length} 筆\n`)
console.log('──── 寫入計畫 ────')
for(const p of B) console.log(`  ${p.dup.name} @${p.dup.city}${p.dup.district}\n     補到保留筆(${bare(p.keep.id).slice(0,8)}): ${p.fills.map(f=>`${f.label}="${f.value}"`).join('  ')}\n     然後封存 ${bare(p.dup.id).slice(0,8)}`)
for(const p of A) console.log(`  ${p.dup.name} @${p.dup.city}${p.dup.district}  → 無需補欄位,直接封存 ${bare(p.dup.id).slice(0,8)}`)
for(const p of S) console.log(`  [跳過] ${p.dup.name} @${p.dup.city}${p.dup.district} — ${p.reason}`)

if(!EXECUTE){ console.log('\n這是 dry-run。確認無誤後加 --execute 才會寫入。'); process.exit(0) }

// ── 執行 ──
const log=[]
let filled=0, archived=0, skipped=0
for(const p of [...B,...A]){
  const [kNow,dNow]=await Promise.all([notion.pages.retrieve({page_id:p.keep.id}),notion.pages.retrieve({page_id:p.dup.id})]).then(r=>r.map(shape))
  // 逐筆重驗:條件已變就不動
  if(dNow.code){ log.push([p.dup.name,'skip','待刪筆已補上機構代碼',p.dup.url]); skipped++; continue }
  if(hist(dNow.id)>0){ log.push([p.dup.name,'skip','待刪筆已有往來紀錄',p.dup.url]); skipped++; continue }
  if(dNow.name!==p.dup.name||dNow.city!==p.dup.city||dNow.district!==p.dup.district){ log.push([p.dup.name,'skip','待刪筆內容已變動',p.dup.url]); skipped++; continue }

  const todo=p.fills.filter(f=>isEmpty(kNow[f.k]))   // 保留筆該欄位仍為空才寫
  if(todo.length){
    const props={}; for(const f of todo) props[f.label]=propValue(f.type,f.value)
    await notion.pages.update({page_id:p.keep.id,properties:props})
    const back=shape(await notion.pages.retrieve({page_id:p.keep.id}))
    const bad=todo.filter(f=>String(back[f.k]??'')!==String(f.value))
    if(bad.length){ log.push([p.dup.name,'abort',`補欄位 read-back 不符:${bad.map(b=>b.label).join('/')},未封存`,p.dup.url]); skipped++; continue }
    filled+=todo.length
    log.push([p.keep.name,'fill',todo.map(f=>`${f.label}=${f.value}`).join(' | '),p.keep.url])
  }
  await notion.pages.update({page_id:p.dup.id,archived:true})
  archived++
  log.push([p.dup.name,'archive',`@${p.dup.city}${p.dup.district} 建檔${p.dup.created.slice(0,10)}｜保留 ${p.keep.url}`,p.dup.url])
}
const esc=s=>`"${String(s??'').replace(/"/g,'""')}"`
await writeFile('合併紀錄-牙體技術所.csv','﻿'+['名稱,動作,內容,連結',...log.map(r=>r.map(esc).join(','))].join('\n'),'utf8')
console.log(`\n完成:補欄位 ${filled} 個、封存 ${archived} 筆、跳過 ${skipped} 筆`)
console.log('紀錄:合併紀錄-牙體技術所.csv（封存筆可從 Notion 垃圾桶還原）')
