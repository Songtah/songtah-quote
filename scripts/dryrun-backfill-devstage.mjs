/**
 * 唯讀 dry-run：以既有客情紀錄回填客戶的「開發階段」。不寫入任何資料。
 *
 * 判定與正式路徑完全同一套規則（lib/line-daily-report 的 inferReaction → devStageForReaction），
 * 只多做一件事：同一客戶取所有拜訪中「最高階段」，因為 advanceCustomerDevStage 只前進不後退。
 */
import { config } from 'dotenv'; config({ path: '.env.local' })
import { Client } from '@notionhq/client'
import { readFileSync } from 'fs'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const { DB } = await import('../lib/notion/shared.ts')
const { devStageForReaction } = await import('../lib/line-daily-report.ts')
const { isInactiveCustomer } = await import('../lib/customer-status.ts')

const RANK = { '線索': 0, '已接觸': 1, '試用中': 2, '報價中': 3, '已成交': 4 }
const TERMINAL = new Set(['流失', '已成交'])
const sel=(p,k)=>p.properties?.[k]?.select?.name??''
const txt=(p,k)=>(p.properties?.[k]?.rich_text??[]).map(t=>t.plain_text).join('')
const title=(p,k)=>(p.properties?.[k]?.title??[]).map(t=>t.plain_text).join('')
async function scan(id,f){const o=[];let c;do{const r=await notion.databases.query({database_id:id,page_size:100,...(f?{filter:f}:{}),...(c?{start_cursor:c}:{})});o.push(...r.results);c=r.has_more?r.next_cursor:undefined}while(c);return o}

// 反應規則直接從原始碼讀，確保與正式路徑一字不差
const src = readFileSync('lib/line-daily-report.ts','utf8')
const RULES = [...src.matchAll(/\{ pattern: (\/[^/]+\/), *value: '([^']+)' \}/g)].map(m=>({re:new RegExp(m[1].slice(1,-1)), v:m[2]}))
const inferReaction = t => { for(const r of RULES) if(r.re.test(t)) return r.v; return '' }

const visits = await scan(DB.visits)
const customers = new Map()
for (const p of await scan(DB.customers)) {
  const n = title(p,'客戶名稱'); if(!n) continue
  customers.set(p.id.replace(/-/g,''), {
    id:p.id, name:n, city:sel(p,'縣市'), district:sel(p,'行政區')||txt(p,'行政區'),
    owner:sel(p,'負責業務'), stage:sel(p,'開發階段'), status:sel(p,'機構狀態'),
  })
}

// 每個客戶：由其拜訪推導出的最高目標階段 + 誰回報的
const target = new Map()
let noLink=0
for (const p of visits) {
  const rel = p.properties?.['🏥 牙科單位資料']?.relation?.[0]?.id
  if (!rel) { noLink++; continue }
  const cid = rel.replace(/-/g,'')
  const who = sel(p,'業務人員') || txt(p,'業務人員')
  const reaction = sel(p,'客戶反應') || inferReaction(txt(p,'拜訪內容'))
  const stage = devStageForReaction(reaction)
  const cur = target.get(cid) ?? { stage:'', reaction:'', reporters:new Set() }
  if (!cur.stage || RANK[stage] > RANK[cur.stage]) { cur.stage = stage; cur.reaction = reaction }
  if (who) cur.reporters.add(who)
  target.set(cid, cur)
}

const plan=[], skip={ '客戶查無':0, '已是終態(已成交/流失)':0, '目標不高於現況':0, '已歇業停業撤銷':0, '他人負責且非回報者':0 }
for (const [cid, t] of target) {
  const c = customers.get(cid)
  if (!c) { skip['客戶查無']++; continue }
  if (TERMINAL.has(c.stage)) { skip['已是終態(已成交/流失)']++; continue }
  if (isInactiveCustomer(c.status)) { skip['已歇業停業撤銷']++; continue }
  if (c.stage && RANK[c.stage] >= RANK[t.stage]) { skip['目標不高於現況']++; continue }
  // 只回填自己名下或無人負責者（與 advanceCustomerDevStage 的 owner 檢查一致）
  if (c.owner && !t.reporters.has(c.owner)) { skip['他人負責且非回報者']++; continue }
  plan.push({ ...c, from: c.stage || '(空白)', to: t.stage, reaction: t.reaction || '(無)', reporters:[...t.reporters] })
}

const tally = a => a.reduce((m,x)=>(m[x]=(m[x]??0)+1,m),{})
console.log(`拜訪 ${visits.length} 筆（無客戶關聯 ${noLink}）→ 涉及 ${target.size} 家客戶`)
console.log(`\n★ 會回填 ${plan.length} 家客戶的開發階段`)
console.log('  目標階段:', tally(plan.map(p=>p.to)))
console.log('  現況分布:', tally(plan.map(p=>p.from)))
console.log('  負責業務:', Object.entries(tally(plan.map(p=>p.owner||'(未認領)'))).sort((a,b)=>b[1]-a[1]))
console.log('\n略過:', skip)

console.log('\n── 回填後漏斗會長這樣（含現有 114 筆）──')
const after = {}
for (const c of customers.values()) if (c.stage) after[c.stage]=(after[c.stage]??0)+1
for (const p of plan) { if (p.from!=='(空白)') after[p.from]--; after[p.to]=(after[p.to]??0)+1 }
console.log(' ', Object.entries(after).sort((a,b)=>RANK[a[0]]-RANK[b[0]]))

console.log('\n── 樣本 12 筆 ──')
for (const p of plan.slice(0,12))
  console.log(`  ${p.name}（${p.city}${p.district}）${p.from} → ${p.to}｜反應「${p.reaction}」｜負責 ${p.owner||'(未認領)'}｜回報 ${p.reporters.join('/')}`)
console.log('\n（唯讀，未修改任何資料）')
