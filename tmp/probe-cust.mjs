const { getRawPage } = await import('../lib/notion/shared.ts').catch(()=>({}))
import { Client } from '@notionhq/client'
import fs from 'fs'
const SP='/private/tmp/claude-501/-Users-ted-Desktop-Songtah/350e62f9-2ea1-429f-9033-c4bc64c9374c/scratchpad'
const rows=JSON.parse(fs.readFileSync(SP+'/nocontact.json','utf8'))
const one=rows.find(r=>r['縣市']==='臺北市'&&r['類型']==='牙體技術所')
const notion=new Client({auth:process.env.NOTION_TOKEN})
const db=process.env.NOTION_CUSTOMERS_SYSTEM_DB||process.env.NOTION_CUSTOMERS_DB
const q=await notion.databases.query({database_id:db,filter:{property:'客戶名稱',title:{equals:one['客戶']}},page_size:1})
const p=q.results[0]
console.log(one['客戶'])
for(const [k,v] of Object.entries(p.properties)) console.log(' -',k,':',v.type)
