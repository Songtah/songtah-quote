/**
 * 唯讀 dry-run:列出牙體技術所的重複建檔可刪清單。
 * 絕不寫入、不刪除任何資料;只產生報告供人工核可。
 *
 * 判定原則(保守):
 *  - 只看「同名 + 同縣市 + 同行政區」的完全重複,不同區的同名一律不碰。
 *  - 每組保留分數最高的一筆(有機構代碼 > 有往來紀錄 > 有負責業務 > 有電話 > 建檔早)。
 *  - 其餘各筆只有在「無機構代碼 且 無任何往來紀錄」時才列為可刪;
 *    有往來紀錄者一律改列「需人工合併」,不進可刪清單。
 */
import { config } from 'dotenv'; config({ path: '.env.local' })
import { Client } from '@notionhq/client'
import { writeFile } from 'node:fs/promises'
const notion=new Client({auth:process.env.NOTION_TOKEN})
const { DB } = await import('./lib/notion/shared.ts')
const { isInactiveCustomer } = await import('./lib/customer-status.ts')
const bare=s=>(s??'').replace(/-/g,'')

const txt=(p,k)=>(p.properties?.[k]?.rich_text??[]).map(t=>t.plain_text).join('')
const sel=(p,k)=>p.properties?.[k]?.select?.name??''
const num=(p,k)=>p.properties?.[k]?.number??null
const title=(p,k)=>(p.properties?.[k]?.title??[]).map(t=>t.plain_text).join('')
async function scan(dbid, filter){const out=[];let c;do{const r=await notion.databases.query({database_id:dbid,page_size:100,...(filter?{filter}:{}),...(c?{start_cursor:c}:{})});out.push(...r.results);c=r.has_more?r.next_cursor:undefined}while(c);return out}

// ── 1. 撈全部牙體技術所 ──
const labs=(await scan(DB.customers,{property:'客戶類型',select:{equals:'牙體技術所'}}))
  .filter(p=>title(p,'客戶名稱'))
  .map(p=>({id:p.id,name:title(p,'客戶名稱'),code:txt(p,'機構代碼').trim(),status:sel(p,'機構狀態'),
    city:sel(p,'縣市'),district:sel(p,'行政區')||txt(p,'行政區'),sp:sel(p,'負責業務'),
    phone:p.properties?.['電話']?.phone_number??'',addr:txt(p,'地址'),stage:sel(p,'開發階段'),
    level:sel(p,'客戶等級'),owner:txt(p,'負責人'),
    heads:(num(p,'牙醫師數')??0)+(num(p,'牙體技術師數')??0)+(num(p,'牙體技術生數')??0),
    created:p.created_time??'', edited:p.last_edited_time??'',
    url:`https://www.notion.so/${bare(p.id)}`}))
console.log(`牙體技術所 ${labs.length} 筆`)

// ── 2. 反查往來紀錄 ──
const refs=new Map() // customerId(bare) → {visits,tickets,equipment,events,campaigns,orders,quotes}
const bump=(id,k)=>{const b=bare(id);const e=refs.get(b)??{};e[k]=(e[k]??0)+1;refs.set(b,e)}
const relScans=[[DB.visits,'🏥 牙科單位資料','visits'],[DB.tickets,'🏥 牙科單位資料','tickets'],
  [DB.equipment,'客戶名稱','equipment'],[DB.registrations,'客戶配對','events'],[DB.campaignMembers,'客戶','campaigns']]
for(const [dbid,prop,key] of relScans){
  if(!dbid) continue
  const pages=await scan(dbid)
  for(const p of pages) for(const r of (p.properties?.[prop]?.relation??[])) bump(r.id,key)
  console.log(`  掃 ${key}: ${pages.length} 筆`)
}
for(const [dbid,key] of [[process.env.NOTION_ORDERS_DB,'orders'],[process.env.NOTION_QUOTES_DB,'quotes']]){
  if(!dbid) continue
  const pages=await scan(dbid)
  for(const p of pages){const cid=txt(p,'客戶ID').trim(); if(cid) bump(cid,key)}
  console.log(`  掃 ${key}: ${pages.length} 筆`)
}
const hist=l=>{const e=refs.get(bare(l.id))??{};return Object.values(e).reduce((s,n)=>s+n,0)}
const histStr=l=>{const e=refs.get(bare(l.id))??{};return Object.entries(e).map(([k,n])=>`${k}${n}`).join(' ')||'—'}

// ── 3. 找完全重複組 ──
const norm=s=>s.replace(/[\s（）()有限公司股份]/g,'')
const groups=new Map()
for(const l of labs){const k=norm(l.name)+'|'+l.city+'|'+l.district;(groups.get(k)??groups.set(k,[]).get(k)).push(l)}
const dupGroups=[...groups.values()].filter(a=>a.length>1)

const score=l=>(l.code?1000:0)+hist(l)*100+(l.sp?50:0)+(l.phone?20:0)+(l.addr?10:0)+(l.heads>0?10:0)+(l.stage?5:0)+(l.level?5:0)+(l.owner?5:0)
// 刪掉這筆會不會弄丟保留筆沒有的資料
const FIELDS=[['phone','電話'],['addr','地址'],['code','機構代碼'],['sp','負責業務'],['stage','開發階段'],['level','客戶等級'],['owner','負責人']]
const lossOf=(dup,keep)=>{
  const out=FIELDS.filter(([k])=>dup[k]&&!keep[k]).map(([,label])=>label)
  if(dup.heads>0&&keep.heads===0) out.push('人員數')
  return out
}
let deletable=[], needMerge=[], manual=[]
for(const g of dupGroups){
  const sorted=[...g].sort((a,b)=>score(b)-score(a) || a.created.localeCompare(b.created))
  const keep=sorted[0]
  const statuses=new Set(g.map(x=>x.status).filter(Boolean))
  for(const l of sorted.slice(1)){
    const loss=lossOf(l,keep)
    const row={group:`${keep.name}@${keep.city}${keep.district}`,keep,dup:l,loss,
               statusConflict: statuses.size>1 ? [...statuses].join('/') : ''}
    if(l.code || hist(l)>0) manual.push(row)
    else if(loss.length || row.statusConflict) needMerge.push(row)
    else deletable.push(row)
  }
}
console.log(`\n完全重複組 ${dupGroups.length} 組`)
console.log(`  A 可直接刪(無代碼、無往來、不會弄丟任何欄位): ${deletable.length} 筆`)
console.log(`  B 先補欄位再刪(待刪筆帶著保留筆沒有的資料): ${needMerge.length} 筆`)
console.log(`  C 需人工合併(有機構代碼或有往來紀錄): ${manual.length} 筆`)

const esc=s=>`"${String(s??'').replace(/"/g,'""')}"`
const head='處置,會遺失欄位,狀態不一致,群組,保留-名稱,保留-代碼,保留-負責業務,保留-電話,保留-往來,保留-連結,刪除-名稱,刪除-狀態,刪除-負責業務,刪除-電話,刪除-往來,刪除-建檔日,刪除-連結'
const line=(act,r)=>[act,r.loss.join('/')||'—',r.statusConflict||'—',r.group,
  r.keep.name,r.keep.code||'無',r.keep.sp||'空',r.keep.phone||'無',histStr(r.keep),r.keep.url,
  r.dup.name,r.dup.status||'空',r.dup.sp||'空',r.dup.phone||'無',histStr(r.dup),r.dup.created.slice(0,10),r.dup.url].map(esc).join(',')
await writeFile('可刪清單-牙體技術所重複建檔.csv','\ufeff'+[head,
  ...deletable.map(r=>line('A 可直接刪',r)),...needMerge.map(r=>line('B 先補欄位再刪',r)),...manual.map(r=>line('C 需人工合併',r))].join('\n'),'utf8')

console.log('\n──── A 可直接刪（全部）────')
for(const r of deletable)
  console.log(`  ${r.dup.name} @${r.dup.city}${r.dup.district}  狀態:${r.dup.status||'空'} 建檔:${r.dup.created.slice(0,10)}  → 保留 ${r.keep.code?'[代碼'+r.keep.code+']':''}${r.keep.sp?'[業務'+r.keep.sp+']':''}${histStr(r.keep)!=='—'?'[往來'+histStr(r.keep)+']':''}`)
console.log('\n──── B 先補欄位再刪（全部）────')
for(const r of needMerge)
  console.log(`  ${r.dup.name} @${r.dup.city}${r.dup.district}  ★會遺失: ${r.loss.join('/')||'—'}${r.statusConflict?'  ★狀態不一致: '+r.statusConflict:''}\n     待刪 電話:${r.dup.phone||'無'} ／ 保留 電話:${r.keep.phone||'無'} 代碼:${r.keep.code||'無'}`)
console.log('\n──── C 需人工合併（全部）────')
for(const r of manual)
  console.log(`  ${r.dup.name} @${r.dup.city}${r.dup.district} [代碼:${r.dup.code||'無'} 往來:${histStr(r.dup)} 業務:${r.dup.sp||'空'}]\n     另一筆 → [代碼:${r.keep.code||'無'} 往來:${histStr(r.keep)} 業務:${r.keep.sp||'空'}]`)

console.log('\n報告已寫出:可刪清單-牙體技術所重複建檔.csv（未刪除任何資料）')
