/**
 * lib/notion/course-costs.ts — 辦課成本試算（從 system-notion.ts 抽出）
 */
import {
  notion, DB, normalizeDatabaseId, notionCallWithRetry,
  getProp, getTitle, getText, getSelect, getNumber,
} from './shared'

export type CourseCost = {
  id:          string
  name:        string   // 課程名稱
  venueFee:      number   // 場地費
  speakerFee:    number   // 講師費
  materialFee:   number   // 教材費
  marketingFee:  number   // 行銷費
  cateringFee:   number   // 餐飲費
  transportFee:  number   // 交通費
  otherFee:      number   // 其他費用
  feePerPerson:number   // 報名費_人
  headcount:   number   // 預計人數
  totalCost:   number   // 總成本 (formula)
  totalRevenue:number   // 總收入 (formula)
  netProfit:   number   // 淨利 (formula)
  marginPct:   number   // 利潤率% (formula)
  status:      string   // 規劃中 / 已確認 / 已結算
  note:        string
}

function getFormula(page: any, field: string): number {
  const prop = getProp(page, field)
  if (!prop || prop.type !== 'formula') return 0
  return prop.formula?.number ?? 0
}

function mapCourseCost(page: any): CourseCost {
  return {
    id:           page.id,
    name:         getTitle(page, '課程名稱'),
    venueFee:     getNumber(page, '場地費'),
    speakerFee:   getNumber(page, '講師費'),
    materialFee:  getNumber(page, '教材費'),
    marketingFee: getNumber(page, '行銷費'),
    cateringFee:  getNumber(page, '餐飲費'),
    transportFee: getNumber(page, '交通費'),
    otherFee:     getNumber(page, '其他費用'),
    feePerPerson: getNumber(page, '報名費_人'),
    headcount:    getNumber(page, '預計人數'),
    totalCost:    getFormula(page, '總成本'),
    totalRevenue: getFormula(page, '總收入'),
    netProfit:    getFormula(page, '淨利'),
    marginPct:    getFormula(page, '利潤率%'),
    status:       getSelect(page, '狀態'),
    note:         getText(page, '備註'),
  }
}

export async function listCourseCosts(): Promise<CourseCost[]> {
  if (!DB.course_costs) return []
  const items: CourseCost[] = []
  let cursor: string | undefined
  do {
    const res: any = await notionCallWithRetry('listCourseCosts', () =>
      notion.databases.query({
        database_id: normalizeDatabaseId(DB.course_costs!),
        page_size: 100,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
        ...(cursor ? { start_cursor: cursor } : {}),
      })
    )
    for (const page of res.results ?? []) items.push(mapCourseCost(page))
    cursor = res.has_more ? res.next_cursor : undefined
  } while (cursor)
  return items
}

export async function createCourseCost(data: Omit<CourseCost, 'id'|'totalCost'|'totalRevenue'|'netProfit'|'marginPct'>): Promise<CourseCost> {
  if (!DB.course_costs) throw new Error('NOTION_COURSE_COSTS_DB not set')
  const page: any = await notionCallWithRetry('createCourseCost', () =>
    notion.pages.create({
      parent: { database_id: normalizeDatabaseId(DB.course_costs!) },
      properties: {
        '課程名稱':  { title: [{ text: { content: data.name } }] },
        '場地費':    { number: data.venueFee || null },
        '講師費':    { number: data.speakerFee || null },
        '教材費':    { number: data.materialFee || null },
        '行銷費':    { number: data.marketingFee || null },
        '餐飲費':    { number: data.cateringFee || null },
        '交通費':    { number: data.transportFee || null },
        '其他費用':  { number: data.otherFee || null },
        '報名費_人': { number: data.feePerPerson || null },
        '預計人數':  { number: data.headcount || null },
        '狀態':      { select: { name: data.status || '規劃中' } },
        '備註':      { rich_text: [{ text: { content: data.note || '' } }] },
      },
    })
  )
  return mapCourseCost(page)
}

export async function updateCourseCost(id: string, data: Partial<Omit<CourseCost, 'id'|'totalCost'|'totalRevenue'|'netProfit'|'marginPct'>>): Promise<void> {
  const props: any = {}
  if (data.name         !== undefined) props['課程名稱']  = { title: [{ text: { content: data.name } }] }
  if (data.venueFee     !== undefined) props['場地費']    = { number: data.venueFee || null }
  if (data.speakerFee   !== undefined) props['講師費']    = { number: data.speakerFee || null }
  if (data.materialFee  !== undefined) props['教材費']    = { number: data.materialFee || null }
  if (data.marketingFee !== undefined) props['行銷費']    = { number: data.marketingFee || null }
  if (data.cateringFee  !== undefined) props['餐飲費']    = { number: data.cateringFee || null }
  if (data.transportFee !== undefined) props['交通費']    = { number: data.transportFee || null }
  if (data.otherFee     !== undefined) props['其他費用']  = { number: data.otherFee || null }
  if (data.feePerPerson !== undefined) props['報名費_人'] = { number: data.feePerPerson || null }
  if (data.headcount    !== undefined) props['預計人數']  = { number: data.headcount || null }
  if (data.status       !== undefined) props['狀態']      = { select: { name: data.status } }
  if (data.note         !== undefined) props['備註']      = { rich_text: [{ text: { content: data.note } }] }
  await notionCallWithRetry('updateCourseCost', () =>
    notion.pages.update({ page_id: id, properties: props })
  )
}

export async function deleteCourseCost(id: string): Promise<void> {
  await notionCallWithRetry('deleteCourseCost', () =>
    notion.pages.update({ page_id: id, archived: true })
  )
}
