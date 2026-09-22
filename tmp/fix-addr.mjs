import { Client } from '@notionhq/client'
const notion = new Client({ auth: process.env.NOTION_TOKEN })
const id = '335dcdaa-fb2a-8110-bfc0-f16f96c57f38'
const before = await notion.pages.retrieve({ page_id: id })
const cur = (before.properties['地址']?.rich_text ?? []).map(t=>t.plain_text).join('')
const next = '新北市板橋區新生街23巷1弄6號5樓'
console.log('地址', `「${cur}」→「${next}」`)
if (process.argv.includes('--apply')) {
  await notion.pages.update({ page_id: id, properties: { '地址': { rich_text: [{ text: { content: next } }] } } })
  console.log('✓ 已更正錯字（5櫻 → 5樓）')
}
