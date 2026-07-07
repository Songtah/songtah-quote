/**
 * scripts/create-campaign-dbs.mjs — 建立「追蹤名單」與「名單成員」兩個 Notion DB(一次性)
 * 用法: node --env-file=.env.local scripts/create-campaign-dbs.mjs
 * 冪等:若同名 DB 已存在於父頁面則跳過(避免重複建立)。
 */
import { Client } from '@notionhq/client'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const PARENT_PAGE = '340dcdaa-fb2a-8184-b6ec-d4777ad00b8d' // 與 訂貨單/促銷活動 同父頁
const CUSTOMERS_DB = (process.env.NOTION_CUSTOMERS_SYSTEM_DB ?? '').replace(/-/g, '')

const MEMBER_STATUSES = ['未聯絡', '已聯絡', '有興趣', '已報價', '成交', '放棄']

async function findExisting(title) {
  const res = await notion.search({ query: title, filter: { property: 'object', value: 'database' } })
  return res.results.find((d) => d.title?.[0]?.plain_text === title && d.parent?.page_id?.replace(/-/g, '') === PARENT_PAGE.replace(/-/g, ''))
}

async function main() {
  // ── 1. 追蹤名單 ──
  let campaigns = await findExisting('追蹤名單')
  if (campaigns) console.log('追蹤名單 已存在:', campaigns.id)
  else {
    campaigns = await notion.databases.create({
      parent: { type: 'page_id', page_id: PARENT_PAGE },
      title: [{ type: 'text', text: { content: '追蹤名單' } }],
      properties: {
        '名單名稱': { title: {} },
        '目標商品': { rich_text: {} },                    // 人看的商品描述,例:HT+ 氧化鋯塊
        '目標SKU':  { rich_text: {} },                    // 成交自動判定用,逗號分隔;空=不自動判定
        '截止日':   { date: {} },
        '狀態':     { select: { options: [{ name: '進行中', color: 'green' }, { name: '已結束', color: 'gray' }] } },
        '說明':     { rich_text: {} },
        '建立者':   { rich_text: {} },
      },
    })
    console.log('✅ 建立 追蹤名單:', campaigns.id)
  }

  // ── 2. 名單成員 ──
  let members = await findExisting('名單成員')
  if (members) console.log('名單成員 已存在:', members.id)
  else {
    members = await notion.databases.create({
      parent: { type: 'page_id', page_id: PARENT_PAGE },
      title: [{ type: 'text', text: { content: '名單成員' } }],
      properties: {
        '成員':     { title: {} },                        // 客戶名稱快照(顯示用)
        '名單':     { relation: { database_id: campaigns.id, single_property: {} } },
        '客戶':     { relation: { database_id: CUSTOMERS_DB, single_property: {} } },
        '狀態':     { select: { options: MEMBER_STATUSES.map((name, i) => ({ name, color: ['gray', 'blue', 'yellow', 'orange', 'green', 'red'][i] })) } },
        '負責業務': { select: { options: [] } },          // 選項寫入時自動生成
        '備註':     { rich_text: {} },
        '成交單號': { rich_text: {} },
      },
    })
    console.log('✅ 建立 名單成員:', members.id)
  }

  console.log('\nDB IDs(寫入 shared.ts):')
  console.log('campaigns:', campaigns.id)
  console.log('campaignMembers:', members.id)
}

main().catch((e) => { console.error('❌', e.message); process.exit(1) })
