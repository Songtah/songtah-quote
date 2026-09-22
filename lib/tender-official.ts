/**
 * lib/tender-official.ts — 政府電子採購網「官方開放資料集」
 *
 * 來源：https://web.pcc.gov.tw/tps/tp/OpenData/showList
 * 授權：**政府資料開放授權條款－第 1 版**（明文允許商業利用，只需註明出處）
 *       → 這是唯一能放心用於公司內部營利目的的來源。
 *
 * 限制（官方頁面自述）：「每個月 5 號會產出 2 個月前的資料」——例如 10/5 才產出 8 月份，
 * 所以官方檔**落後約兩個月**，不可能單獨滿足「今天有什麼新標案」。
 * 因此系統採雙軌：
 *   官方檔 = 權威底稿（歷史、決標結果、可商用），每月補寫一次
 *   即時 API = 近兩個月的提醒用途，官方檔釋出後會被覆蓋
 *
 * 檔名規則：tender_YYYYMM01.xml（1～15 日）／tender_YYYYMM02.xml（16 日～月底），
 * 決標則是 award_YYYYMM01.xml／award_YYYYMM02.xml。
 */
const BASE = 'https://web.pcc.gov.tw/tps/tp/OpenData/downloadFile?fileName='

export type OfficialTender = {
  source: 'official'
  kind: 'tender' | 'award'
  date: string            // 公告日／決標公告日 YYYY-MM-DD
  unitName: string
  jobNumber: string
  title: string
  procurementType: string // 招標方式
  procurementAttr: string // 採購性質（工程類／財物類／勞務類）
  // 決標檔才有
  awardAmount: number | null
  awardDate: string
  address: string
  contact: string
  phone: string
  winners: string[]
  losers: string[]
}

const text = (block: string, tag: string) =>
  block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? ''

const all = (block: string, tag: string) =>
  Array.from(block.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))).map((m) => m[1].trim())

const toISO = (d: string) => (d ? d.replace(/\//g, '-') : '')

/** 期別代碼：2026-07-20 → 20260702（上半月 01、下半月 02），對應 tender_20260702.xml */
export function periodOf(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}${m}0${date.getUTCDate() <= 15 ? 1 : 2}`
}

/** 最近 n 期（由新到舊），從「兩個月前」起算——更新的期別官方還沒產出 */
export function recentPeriods(n = 4): string[] {
  const out: string[] = []
  const d = new Date()
  d.setUTCMonth(d.getUTCMonth() - 2)
  d.setUTCDate(28)
  for (let i = 0; i < n; i++) {
    out.push(periodOf(d))
    d.setUTCDate(d.getUTCDate() - 15)
  }
  return Array.from(new Set(out))
}

async function download(fileName: string): Promise<string | null> {
  try {
    const res = await fetch(BASE + fileName, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) return null
    const text = await res.text()
    return text.includes('<TENDER_LIST>') ? text : null
  } catch {
    return null
  }
}

export async function fetchOfficialPeriod(period: string): Promise<OfficialTender[]> {
  const out: OfficialTender[] = []

  const tenderXml = await download(`tender_${period}.xml`)
  for (const block of tenderXml ? all(tenderXml, 'TENDER') : []) {
    out.push({
      source: 'official', kind: 'tender',
      date: toISO(text(block, 'TENDER_SPDT')),
      unitName: text(block, 'TENDER_ORG_NAME'),
      jobNumber: text(block, 'TENDER_CASE_NO'),
      title: text(block, 'TENDER_NAME'),
      procurementType: text(block, 'PROCUREMENT_TYPE'),
      procurementAttr: text(block, 'PROCUREMENT_ATTR'),
      awardAmount: null, awardDate: '', address: '', contact: '', phone: '',
      winners: [], losers: [],
    })
  }

  const awardXml = await download(`award_${period}.xml`)
  for (const block of awardXml ? all(awardXml, 'TENDER') : []) {
    const price = text(block, 'TENDER_AWARD_PRICE').replace(/[^0-9]/g, '')
    out.push({
      source: 'official', kind: 'award',
      date: toISO(text(block, 'AWARD_NOTICE_DATE') || text(block, 'AWARD_DATE')),
      unitName: text(block, 'TENDER_ORG_NAME'),
      jobNumber: text(block, 'TENDER_CASE_NO'),
      title: text(block, 'TENDER_NAME'),
      procurementType: text(block, 'PROCUREMENT_TYPE'),
      procurementAttr: text(block, 'PROCUREMENT_ATTR'),
      awardAmount: price ? Number(price) : null,
      awardDate: toISO(text(block, 'AWARD_DATE')),
      address: text(block, 'TENDER_ORG_ADDR'),
      contact: text(block, 'CONTACT_PERSON'),
      phone: text(block, 'TENDER_TEL'),
      winners: all(block, 'BIDDER_SUPP_NAME'),
      losers: all(block, 'NOT_OBTAIN_SUPP_NAME'),
    })
  }
  return out
}

/** 下載近 n 期官方檔並回傳（未過濾） */
export async function fetchOfficialRecent(periods = 4): Promise<{ records: OfficialTender[]; periods: string[] }> {
  const list = recentPeriods(periods)
  const records: OfficialTender[] = []
  for (const p of list) records.push(...await fetchOfficialPeriod(p))
  return { records, periods: list }
}
