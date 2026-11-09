/**
 * lib/compliance/check.ts —— 擷取＋資料比對（不靠模型下結論的部分）
 *
 * 一次擷取：各自動來源抓首頁＋若干內頁 → 內容有變才存證 → 比對頁面上標示的許可證字號。
 * 這裡只產生「資料比對」類發現（字號已註銷／廢止／逾期）。廣告是否違規需判讀，見 judge.ts。
 */
import 'server-only'
import { archiveToWayback, fetchPage, pickInternalLinks, storeCapture } from './capture'
import { findLicense, licenseStatus } from './licenses'
import { type Capture, type Target, addFindingOnce, saveCapture, saveTarget } from './store'

const PAGES_PER_SOURCE = 20
const TIME_BUDGET_MS = 80_000

export type CaptureRunResult = {
  targetId: string; name: string
  pagesFetched: number; pagesStored: number; pagesUnchanged: number; pagesFailed: number
  newFindings: number
  blocked: string[]          // 抓不到內容的來源（登入牆、阻擋、逾時）
  notes: string[]
}

/** 比對頁面上標示的許可證字號；回傳新增的發現數 */
export async function hardCheck(target: Target, capture: Capture): Promise<number> {
  const today = capture.capturedAt.slice(0, 10)
  let added = 0
  for (const no of capture.licenseNos) {
    const lic = findLicense(no)
    if (!lic) continue                      // 未收錄（非牙科類或登錄制）：不可當成無證
    const st = licenseStatus(lic, today)
    if (st === '有效') continue
    const f = await addFindingOnce({
      targetId: target.id, captureId: capture.id, url: capture.url, ruleId: 'MD-LIC-INVALID', source: 'hard',
      product: lic.zh, quote: no,
      reason: `頁面標示的許可證字號在食藥署資料中狀態為「${st}」${lic.exp ? `（有效日期 ${lic.exp}）` : ''}，持證者：${lic.app}。`,
      confidence: '高',
    })
    if (f) added++
  }
  return added
}

export async function runCapture(target: Target): Promise<CaptureRunResult> {
  const started = Date.now()
  const out: CaptureRunResult = { targetId: target.id, name: target.name, pagesFetched: 0, pagesStored: 0, pagesUnchanged: 0, pagesFailed: 0, newFindings: 0, blocked: [], notes: [] }
  const flagged: Capture[] = []

  for (const source of target.sources.filter((s) => s.mode === 'auto')) {
    const home = await fetchPage(source.url)
    if (!home || home.status >= 400 || home.text.length < 200) {
      out.blocked.push(`${source.platform} ${source.url}`)
      out.pagesFailed++
      continue
    }
    // 首頁 → 內頁 → 內頁的內頁（兩層），產品與消息類優先；同網域、有頁數與時間上限
    const pages = [home]
    const depth = new Map<string, number>()
    const queue: string[] = []
    const enqueue = (from: typeof home, d: number) => {
      for (const link of pickInternalLinks(from, 40)) if (!depth.has(link)) { depth.set(link, d); queue.push(link) }
    }
    depth.set(home.url.replace(/#.*$/, ''), 0)
    enqueue(home, 1)
    while (queue.length && pages.length < PAGES_PER_SOURCE) {
      if (Date.now() - started > TIME_BUDGET_MS) { out.notes.push('已達時間上限，其餘內頁下次再抓'); break }
      const link = queue.shift()!
      const p = await fetchPage(link)
      if (!p || p.status >= 400 || p.text.length < 100) { out.pagesFailed++; continue }
      pages.push(p)
      if ((depth.get(link) ?? 2) < 2) enqueue(p, 2)
    }
    for (const page of pages) {
      out.pagesFetched++
      const capture = await storeCapture(target, source, page)
      if (!capture) { out.pagesUnchanged++; continue }
      out.pagesStored++
      const n = await hardCheck(target, capture)
      if (n) { out.newFindings += n; flagged.push(capture) }
    }
  }

  // 有資料比對發現的頁面，立即送第三方存檔（每次最多 2 頁，對方限流）
  for (const c of flagged.slice(0, 2)) {
    if (Date.now() - started > TIME_BUDGET_MS + 10_000) break
    const archiveUrl = await archiveToWayback(c.url)
    if (archiveUrl) await saveCapture({ ...c, archiveUrl })
  }

  await saveTarget({ ...target, lastCaptureAt: new Date().toISOString() })
  return out
}

/** 人工貼單篇網址（社群貼文等）。抓不到內容就如實回報，不規避登入牆。 */
export async function captureSingleUrl(target: Target, sourceId: string, url: string): Promise<{ ok: boolean; capture?: Capture; reason?: string; newFindings: number }> {
  const source = target.sources.find((s) => s.id === sourceId) ?? { id: 'manual', platform: '其他' as const, url, mode: 'manual' as const }
  const page = await fetchPage(url)
  if (!page) return { ok: false, reason: '無法取得頁面（網址無效、被阻擋或逾時）', newFindings: 0 }
  if (page.text.length < 200 || /log in|登入|login/i.test(page.title)) {
    return { ok: false, reason: '此頁需要登入才看得到內容，系統不會繞過登入牆。請改用截圖自行存證，或改貼不需登入的網址。', newFindings: 0 }
  }
  const capture = await storeCapture(target, source, page, { force: true })
  if (!capture) return { ok: false, reason: '存證失敗', newFindings: 0 }
  const newFindings = await hardCheck(target, capture)
  const archiveUrl = await archiveToWayback(url)
  if (archiveUrl) await saveCapture({ ...capture, archiveUrl })
  return { ok: true, capture: { ...capture, archiveUrl }, newFindings }
}
