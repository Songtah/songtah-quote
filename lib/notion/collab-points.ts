/**
 * lib/notion/collab-points.ts — 業務協作積分（葉領域）
 *
 * 依《業務客戶分區管理辦法 2026v4》第八章「團隊協作機制」。
 *
 * 積分不是自動計算的：辦法明訂流程為「助攻者主動提出 → 業務會議上經受助業務
 * 確認 → 總經理現場認列」，所以本表是有狀態流轉的紀錄，狀態機在
 * app/api/collab-points 的 route 把關，本檔只負責讀寫。
 *
 * 只有「已認列」才計入積分統計——待確認/已確認都還沒經總經理認列。
 *
 * 葉領域規則：不 import 其他葉領域；客戶名稱由 ./relations 的 resolveCustomerInfo
 * 反查（讀取方向，允許），比照 cross-support.ts 的做法。
 */
import {
  notion, DB, normalizeDatabaseId, notionCallWithRetry,
  richText, getTitle, getText, getSelect, getDate, getNumber, getRelationIds,
} from './shared'
import { resolveCustomerInfo } from './relations'

/** 辦法第八章助攻項目表：項目 → 積分 */
export const COLLAB_ITEMS = {
  '提供有效客戶基本聯絡資訊': 1,
  '陪同簡報介紹、Demo': 1,
  '其他由總經理認定具實質效益': 1,
  '協助產品教育訓練': 2,
  '跨區支援擺攤或課程': 2,
  '介紹認識院長、老闆或決策者': 2,
  '協助解決重大問題': 3,
} as const

export type CollabItem = keyof typeof COLLAB_ITEMS

/** 辦法第八章獎勵門檻；達 12 點後歸零重算 */
export const REWARD_TIERS = [
  { points: 6, reward: '800 元現金或等值禮券／禮品' },
  { points: 12, reward: '1,500 元現金或等值禮券／禮品' },
] as const

export const CYCLE_POINTS = 12

export const COLLAB_STATUSES = ['待確認', '已確認', '已認列', '駁回'] as const
export type CollabStatus = (typeof COLLAB_STATUSES)[number]

/** 只有「已認列」才計入積分 */
export const COUNTED_STATUS: CollabStatus = '已認列'

export interface CollabPointLog {
  id: string
  title: string
  helper: string          // 助攻業務（積分歸屬）
  helped: string          // 受助業務（需其確認）
  customerId: string
  customerName: string
  customerCity: string
  item: string
  points: number
  caseKey: string         // 案件識別，用於「同一案件僅認列一次」
  status: string
  countedDate: string     // 認列日期
  note: string
  /** 系統判定 = Slack 自動分類的建議項目，確認/認列時可改 */
  autoClassified: boolean
  rawMessage: string
  createdTime: string
}

function parsePage(page: any): Omit<CollabPointLog, 'customerName' | 'customerCity'> {
  return {
    id: page.id.replace(/-/g, ''),
    title: getTitle(page, '標題'),
    helper: getSelect(page, '助攻業務'),
    helped: getSelect(page, '受助業務'),
    customerId: getRelationIds(page, '客戶')[0] ?? '',
    item: getSelect(page, '助攻項目'),
    points: getNumber(page, '積分'),
    caseKey: getText(page, '案件識別'),
    status: getSelect(page, '狀態'),
    countedDate: getDate(page, '認列日期'),
    note: getText(page, '說明'),
    autoClassified: getSelect(page, '判定方式') === '系統判定',
    rawMessage: getText(page, '原始訊息'),
    createdTime: page.created_time ?? '',
  }
}

/**
 * 列出協作積分紀錄。
 * range 依「認列日期」篩選——積分歸屬的是總經理認列當天，不是提出當天，
 * 這樣週/月/季/年統計才跟獎勵發放對得起來。未認列者沒有認列日期，
 * 因此帶 range 時查不到，需要看待辦清單請用 status 篩選、不要帶 range。
 */
export async function listCollabPoints(options?: {
  range?: { from: string; to: string }
  helper?: string
  status?: CollabStatus
}): Promise<CollabPointLog[]> {
  if (!DB.collabPoints) return []
  const clauses: any[] = []
  if (options?.range) {
    clauses.push({ property: '認列日期', date: { on_or_after: options.range.from } })
    clauses.push({ property: '認列日期', date: { on_or_before: options.range.to } })
  }
  if (options?.helper) clauses.push({ property: '助攻業務', select: { equals: options.helper } })
  if (options?.status) clauses.push({ property: '狀態', select: { equals: options.status } })

  const pages: any[] = []
  let cursor: string | undefined
  do {
    const resp: any = await notionCallWithRetry('listCollabPoints', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.collabPoints),
        filter: clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : { and: clauses },
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    pages.push(...resp.results)
    cursor = resp.has_more ? resp.next_cursor : undefined
  } while (cursor)

  const parsed = pages.map(parsePage)
  const customerIds = Array.from(new Set(parsed.map((p) => p.customerId).filter(Boolean)))
  const info = await resolveCustomerInfo(customerIds)
  return parsed.map((p) => ({
    ...p,
    customerName: info[p.customerId]?.name ?? '',
    customerCity: info[p.customerId]?.city ?? '',
  }))
}

/**
 * 建立一筆助攻申報。積分由項目表決定，不接受呼叫端自訂——
 * 避免有人從前端灌高分。狀態一律從「待確認」起算。
 */
export async function createCollabPoint(data: {
  helper: string
  helped: string
  item: CollabItem
  customerId?: string
  caseKey?: string
  note?: string
  /** Slack 自動判定的建議項目；true 時 UI 會標示「系統判定」提醒人工複核 */
  autoClassified?: boolean
  rawMessage?: string
}): Promise<{ id: string }> {
  if (!DB.collabPoints) throw new Error('NOTION_COLLAB_POINTS_DB 未設定')
  const points = COLLAB_ITEMS[data.item]
  if (points == null) throw new Error(`未知的助攻項目：${data.item}`)

  const title = `${data.helper} 助攻 ${data.helped}｜${data.item}`
  const page: any = await notionCallWithRetry('createCollabPoint', () =>
    notion.pages.create({
      parent: { database_id: normalizeDatabaseId(DB.collabPoints) },
      properties: {
        '標題':   { title: richText(title) },
        '助攻業務': { select: { name: data.helper } },
        '受助業務': { select: { name: data.helped } },
        '助攻項目': { select: { name: data.item } },
        '積分':   { number: points },
        '狀態':   { select: { name: '待確認' } },
        ...(data.customerId ? { '客戶': { relation: [{ id: data.customerId }] } } : {}),
        ...(data.caseKey ? { '案件識別': { rich_text: richText(data.caseKey) } } : {}),
        ...(data.note ? { '說明': { rich_text: richText(data.note) } } : {}),
        '判定方式': { select: { name: data.autoClassified ? '系統判定' : '人工填寫' } },
        ...(data.rawMessage ? { '原始訊息': { rich_text: richText(data.rawMessage.slice(0, 1900)) } } : {}),
      } as any,
    })
  )
  return { id: page.id.replace(/-/g, '') }
}

/** 讀單筆（狀態機轉換前要先確認現值，不可盲寫） */
export async function getCollabPoint(id: string): Promise<CollabPointLog | null> {
  if (!DB.collabPoints) return null
  const page: any = await notionCallWithRetry('getCollabPoint', () =>
    notion.pages.retrieve({ page_id: id })
  )
  const targetDb = (page?.parent?.database_id ?? '').replace(/-/g, '')
  const ownDb = normalizeDatabaseId(DB.collabPoints).replace(/-/g, '')
  if (!targetDb || targetDb !== ownDb || page.archived) return null
  const parsed = parsePage(page)
  const info = await resolveCustomerInfo(parsed.customerId ? [parsed.customerId] : [])
  return {
    ...parsed,
    customerName: info[parsed.customerId]?.name ?? '',
    customerCity: info[parsed.customerId]?.city ?? '',
  }
}

/**
 * 更新狀態。轉為「已認列」時一併寫入認列日期（積分以此日期歸入統計期間）；
 * 轉離「已認列」時清空，避免已撤銷的紀錄還留著認列日期被統計到。
 */
export async function updateCollabPointStatus(
  id: string, status: CollabStatus, countedDate?: string,
): Promise<void> {
  if (!DB.collabPoints) throw new Error('NOTION_COLLAB_POINTS_DB 未設定')
  const page: any = await notionCallWithRetry('updateCollabPointStatus:checkOwner', () =>
    notion.pages.retrieve({ page_id: id })
  )
  const targetDb = (page?.parent?.database_id ?? '').replace(/-/g, '')
  const ownDb = normalizeDatabaseId(DB.collabPoints).replace(/-/g, '')
  if (!targetDb || targetDb !== ownDb) throw new Error('id 不屬於協作積分庫，拒絕寫入')

  await notionCallWithRetry('updateCollabPointStatus', () =>
    notion.pages.update({
      page_id: id,
      properties: {
        '狀態': { select: { name: status } },
        '認列日期': status === COUNTED_STATUS
          ? { date: { start: countedDate ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10) } }
          : { date: null },
      } as any,
    })
  )
}

/**
 * 依辦法計算某人的積分週期狀態。
 * 達 12 點歸零重算，所以「本輪點數」＝總點數 % 12；但剛好整除且有點數時
 * 代表剛完成一輪，視為 0 起算下一輪。
 */
export function summarizePoints(totalPoints: number) {
  const completedCycles = Math.floor(totalPoints / CYCLE_POINTS)
  const cyclePoints = totalPoints % CYCLE_POINTS
  const nextTier = REWARD_TIERS.find((tier) => tier.points > cyclePoints) ?? null
  return {
    totalPoints,
    completedCycles,
    cyclePoints,
    nextTier,
    pointsToNextTier: nextTier ? nextTier.points - cyclePoints : 0,
    reachedTiers: REWARD_TIERS.filter((tier) => cyclePoints >= tier.points),
  }
}

/**
 * 更正助攻項目（連帶更新積分與標題）。
 *
 * 存在的理由：Slack 自動判定只是「建議項目」，受助業務確認或總經理認列時
 * 若判錯要能改。積分一律由項目表重算，不接受呼叫端指定分數。
 */
export async function updateCollabPointItem(id: string, item: CollabItem): Promise<void> {
  if (!DB.collabPoints) throw new Error('NOTION_COLLAB_POINTS_DB 未設定')
  const points = COLLAB_ITEMS[item]
  if (points == null) throw new Error(`未知的助攻項目：${item}`)

  const page: any = await notionCallWithRetry('updateCollabPointItem:checkOwner', () =>
    notion.pages.retrieve({ page_id: id })
  )
  const targetDb = (page?.parent?.database_id ?? '').replace(/-/g, '')
  const ownDb = normalizeDatabaseId(DB.collabPoints).replace(/-/g, '')
  if (!targetDb || targetDb !== ownDb) throw new Error('id 不屬於協作積分庫，拒絕寫入')

  const helper = getSelect(page, '助攻業務')
  const helped = getSelect(page, '受助業務')
  await notionCallWithRetry('updateCollabPointItem', () =>
    notion.pages.update({
      page_id: id,
      properties: {
        '助攻項目': { select: { name: item } },
        '積分': { number: points },
        '標題': { title: richText(`${helper} 助攻 ${helped}｜${item}`) },
        // 一經人工更正就不再是系統判定，避免 UI 持續掛著「待複核」標記
        '判定方式': { select: { name: '人工填寫' } },
      } as any,
    })
  )
}
