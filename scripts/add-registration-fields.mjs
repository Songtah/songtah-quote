/**
 * 報名表單整合 SurveyCake 欄位（2026-10-27）：活動報名 DB 與活動管理 DB 新增欄位。只新增、不改不刪既有欄位。
 *
 *   node scripts/add-registration-fields.mjs          # dry-run：列出會新增哪些欄位
 *   node scripts/add-registration-fields.mjs --write  # 實際新增
 */
import fs from 'node:fs'
import { Client } from '@notionhq/client'

for (const l of fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const write = process.argv.includes('--write')
const select = (...names) => ({ select: { options: names.map((name) => ({ name })) } })
const text = { rich_text: {} }

const PLAN = [
  {
    db: process.env.NOTION_REGISTRATIONS_DB || '39f9723b83ce44dab9b9348288814469',
    props: {
      報名方案: text,
      同行人員: text,
      性別: select('男', '女'),
      飲食需求: select('不限', '不吃牛', '蛋奶素', '其他'),
      資訊來源: select('臉書粉絲團', 'LINE 官方帳號', '業務介紹', '其他'),
      介紹業務: text,
      付款方式: select('匯款', '現金交業務'),
      匯款後五碼: text,
      付款日期: { date: {} },
    },
  },
  {
    db: process.env.NOTION_EVENTS_DB || '36dc5ca6467a46c299e2fe6efe5ab05e',
    props: { 報名方案: text, 報名表欄位: text },   // JSON：方案 [{ name, price, people }]；欄位 { 欄位: off|optional|required }
  },
]

for (const { db, props } of PLAN) {
  const d = await notion.databases.retrieve({ database_id: db })
  const title = d.title?.[0]?.plain_text ?? db
  const missing = Object.fromEntries(Object.entries(props).filter(([k]) => !d.properties[k]))
  const clash = Object.keys(props).filter((k) => d.properties[k] && !(Object.keys(props[k])[0] === d.properties[k].type))
  console.log(`== ${title}：新增 ${Object.keys(missing).join('、') || '（無）'}`)
  if (clash.length) { console.log(`   同名但型別不同，略過：${clash.join('、')}`); }
  if (write && Object.keys(missing).length) {
    await notion.databases.update({ database_id: db, properties: missing })
    console.log('   已新增')
  }
}
if (!write) console.log('\n（dry-run，加 --write 實際新增）')
