/**
 * lib/notion/campaigns.ts — 追蹤名單（葉領域）
 *
 * 商品 × 客戶的派工追蹤：老闆給一份某商品的潛在購買清單 → 匯入成名單成員 →
 * 業務逐一聯絡並更新狀態 → 訂單含目標 SKU 時由 cron 自動標成交。
 *
 * 領域邊界：只碰 追蹤名單/名單成員 兩個 DB。
 * 「比對客戶主檔」「查客戶詳情」屬 customers 領域，由上層 route 組合，不在此 import。
 */
import {
  notion, DB, normalizeDatabaseId, notionCallWithRetry, richText,
  getTitle, getText, getSelect, getDate, getRelationIds,
} from './shared'

export const MEMBER_STATUSES = ['未聯絡', '已聯絡', '有興趣', '已報價', '成交', '放棄'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

export interface Campaign {
  id: string
  name: string
  product: string      // 目標商品（人看的描述）
  targetSkus: string[] // 成交自動判定用；空=不自動判定
  deadline: string
  status: string       // 進行中/已結束
  note: string
  creator: string
  createdAt: string
}

export interface CampaignMember {
  id: string
  campaignId: string
  customerId: string
  name: string         // 客戶名稱快照
  status: MemberStatus | string
  salesperson: string
  note: string
  dealOrderNo: string
}

function mapCampaign(page: any): Campaign {
  return {
    id: page.id,
    name: getTitle(page, '名單名稱'),
    product: getText(page, '目標商品'),
    targetSkus: getText(page, '目標SKU').split(/[,，\s]+/).map((s: string) => s.trim()).filter(Boolean),
    deadline: getDate(page, '截止日'),
    status: getSelect(page, '狀態'),
    note: getText(page, '說明'),
    creator: getText(page, '建立者'),
    createdAt: page.created_time ?? '',
  }
}

function mapMember(page: any): CampaignMember {
  return {
    id: page.id,
    campaignId: getRelationIds(page, '名單')[0] ?? '',
    customerId: getRelationIds(page, '客戶')[0] ?? '',
    name: getTitle(page, '成員'),
    status: getSelect(page, '狀態') || '未聯絡',
    salesperson: getSelect(page, '負責業務'),
    note: getText(page, '備註'),
    dealOrderNo: getText(page, '成交單號'),
  }
}

export async function listCampaigns(): Promise<Campaign[]> {
  const out: Campaign[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('listCampaigns', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.campaigns),
        page_size: 100,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    out.push(...(res.results ?? []).map(mapCampaign))
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return out
}

export async function createCampaign(data: {
  name: string; product: string; targetSkus?: string[]
  deadline?: string; note?: string; creator?: string
}): Promise<Campaign> {
  const page: any = await notionCallWithRetry('createCampaign', () =>
    notion.pages.create({
      parent: { database_id: normalizeDatabaseId(DB.campaigns) },
      properties: {
        '名單名稱': { title: richText(data.name) },
        '目標商品': { rich_text: richText(data.product) },
        '目標SKU':  { rich_text: richText((data.targetSkus ?? []).join(', ')) },
        '狀態':     { select: { name: '進行中' } },
        ...(data.deadline ? { '截止日': { date: { start: data.deadline } } } : {}),
        ...(data.note ? { '說明': { rich_text: richText(data.note) } } : {}),
        ...(data.creator ? { '建立者': { rich_text: richText(data.creator) } } : {}),
      } as any,
    })
  )
  return mapCampaign(page)
}

export async function updateCampaignStatus(id: string, status: '進行中' | '已結束'): Promise<void> {
  await notionCallWithRetry('updateCampaignStatus', () =>
    notion.pages.update({ page_id: id, properties: { '狀態': { select: { name: status } } } as any })
  )
}

export async function listMembers(campaignId: string): Promise<CampaignMember[]> {
  const out: CampaignMember[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('listMembers', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.campaignMembers),
        page_size: 100,
        filter: { property: '名單', relation: { contains: campaignId } },
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    out.push(...(res.results ?? []).map(mapMember))
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'))
  return out
}

/** 批次加入成員（呼叫端負責先比對出 customerId/name/salesperson）。回傳建立數。 */
export async function addMembers(
  campaignId: string,
  members: { customerId: string; name: string; salesperson?: string }[]
): Promise<number> {
  let ok = 0
  for (const m of members) {
    await notionCallWithRetry('addMember', () =>
      notion.pages.create({
        parent: { database_id: normalizeDatabaseId(DB.campaignMembers) },
        properties: {
          '成員':     { title: richText(m.name) },
          '名單':     { relation: [{ id: campaignId }] },
          '客戶':     { relation: [{ id: m.customerId }] },
          '狀態':     { select: { name: '未聯絡' } },
          ...(m.salesperson ? { '負責業務': { select: { name: m.salesperson } } } : {}),
        } as any,
      })
    )
    ok++
  }
  return ok
}

export async function updateMember(
  id: string,
  data: { status?: string; note?: string; salesperson?: string; dealOrderNo?: string }
): Promise<void> {
  const properties: any = {}
  if (data.status !== undefined) {
    if (!MEMBER_STATUSES.includes(data.status as MemberStatus)) throw new Error(`無效的成員狀態：${data.status}`)
    properties['狀態'] = { select: { name: data.status } }
  }
  if (data.note !== undefined)        properties['備註'] = { rich_text: richText(data.note) }
  if (data.salesperson !== undefined) properties['負責業務'] = data.salesperson ? { select: { name: data.salesperson } } : { select: null }
  if (data.dealOrderNo !== undefined) properties['成交單號'] = { rich_text: richText(data.dealOrderNo) }
  if (Object.keys(properties).length === 0) return
  await notionCallWithRetry('updateMember', () =>
    notion.pages.update({ page_id: id, properties })
  )
}

export async function removeMember(id: string): Promise<void> {
  await notionCallWithRetry('removeMember', () =>
    notion.pages.update({ page_id: id, archived: true })
  )
}

/**
 * 拜訪連動：某客戶被拜訪後，把他在所有「進行中」名單裡的「未聯絡」推進為「已聯絡」。
 * 由 visits 建立 route fire-and-forget 呼叫（cross-domain 在 route 層組合）。
 */
export async function bumpContactedByCustomer(customerId: string): Promise<number> {
  if (!customerId) return 0
  const res: any = await notionCallWithRetry('bumpContacted:find', () =>
    notion.databases.query({
      database_id: normalizeDatabaseId(DB.campaignMembers),
      page_size: 100,
      filter: {
        and: [
          { property: '客戶', relation: { contains: customerId } },
          { property: '狀態', select: { equals: '未聯絡' } },
        ],
      },
    })
  )
  let bumped = 0
  for (const page of res.results ?? []) {
    await notionCallWithRetry('bumpContacted:update', () =>
      notion.pages.update({ page_id: page.id, properties: { '狀態': { select: { name: '已聯絡' } } } as any })
    )
    bumped++
  }
  return bumped
}

/** 成交自動判定用：列出所有進行中名單的「未成交」成員（cron 掃訂單時比對）。 */
export async function listOpenMembersForAutoClose(): Promise<{ campaign: Campaign; members: CampaignMember[] }[]> {
  const campaigns = (await listCampaigns()).filter((c) => c.status === '進行中' && c.targetSkus.length > 0)
  const out: { campaign: Campaign; members: CampaignMember[] }[] = []
  for (const campaign of campaigns) {
    const members = (await listMembers(campaign.id)).filter((m) => m.status !== '成交' && m.status !== '放棄')
    if (members.length) out.push({ campaign, members })
  }
  return out
}
