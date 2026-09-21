/**
 * lib/notion/monitor-verify.ts — 異常候選批次查證（第 3 層）
 *
 * 分層策略（2026-09-21 定調）：
 *   第 1 層 每月全台列表（3 個請求）        → 消失＝歇業、新出現＝新開業
 *   第 2 層 輪流回抓詳細頁（客戶優先）      → 還在列表但狀態變了
 *   第 3 層 **本檔**：異常候選批次即時查證  → 有疑慮的那批，每次約 127 筆／40 秒
 *   第 4 層 單筆查衛福部＋一鍵套用          → 人要百分之百確定時
 *
 * 為什麼不全頁即時查：全台 8,466 家逐筆查詳細頁約 40 分鐘（實測 3.5 筆／秒），
 * 超過函式時限、失敗率 6.6% 會產生數百筆假訊號，且量放大 7 倍很可能觸發 WAF 封鎖。
 * 候選只有一百多筆，卻涵蓋所有真正需要確認的對象——投報率最高的一層。
 *
 * 本層只**查證與記錄**，不自動改客戶主檔：機構狀態會影響全頁統計與業務看到的清單，
 * 一律由人按「套用衛福部狀態」確認（比照既有的狀態回寫流程）。
 */
import { getRedisValue, setRedisValue } from './shared'
import { lookupInstitution, isClosedStatus } from '@/lib/mohw-bas.mjs'

export type VerifyResult = {
  customerId: string
  customerName: string
  city: string
  institutionCode: string
  /** 衛福部即時查詢結果 */
  found: boolean
  basStatus: string
  basCode: string
  closed: boolean
  /** 同縣市查無、但外縣市有同名（不採用，僅供人工判讀） */
  outOfCity: boolean
  crmStatus: string
  /** 衛福部狀態換算成客戶主檔用語；與 crmStatus 不同才需要人工確認 */
  suggestedStatus: string
  checkedAt: string
  error?: string
}

export type VerifyBatchSummary = {
  checked: number
  mismatched: number
  closed: number
  notFound: number
  failed: number
  startedAt: string
  finishedAt: string
}

const KEY = 'medical-monitor:verify-v1'
const TTL_MS = 30 * 24 * 3600_000
/** 對 WAF 禮貌：逐筆送、間隔 400ms；127 筆約 1 分鐘 */
const GAP_MS = 400
const MAX_ITEMS = 300

export function basToCrmStatus(basStatus: string): string {
  const s = basStatus ?? ''
  if (/撤銷|註銷|廢止/.test(s)) return '撤銷'
  if (/歇業/.test(s)) return '已歇業'
  if (/停業/.test(s)) return '停業'
  if (/開業/.test(s)) return '開業'
  return ''
}

export type VerifyTarget = {
  customerId: string; customerName: string; city: string
  institutionCode: string; crmStatus: string; kind?: string
}

export async function verifyCandidates(targets: VerifyTarget[]): Promise<{
  results: VerifyResult[]; summary: VerifyBatchSummary
}> {
  const startedAt = new Date().toISOString()
  const results: VerifyResult[] = []
  for (const t of targets.slice(0, MAX_ITEMS)) {
    const base = {
      customerId: t.customerId, customerName: t.customerName, city: t.city,
      institutionCode: t.institutionCode, crmStatus: t.crmStatus,
      checkedAt: new Date().toISOString(),
    }
    try {
      const r: any = await lookupInstitution({ name: t.customerName, kind: t.kind, city: t.city })
      const basStatus = r?.status ?? ''
      results.push({
        ...base,
        found: Boolean(r?.found),
        basStatus,
        basCode: r?.code ?? '',
        closed: isClosedStatus(basStatus),
        outOfCity: Boolean(r?.outOfCity),
        suggestedStatus: r?.found ? basToCrmStatus(basStatus) : '',
      })
    } catch (e: any) {
      results.push({
        ...base, found: false, basStatus: '', basCode: '', closed: false,
        outOfCity: false, suggestedStatus: '', error: e?.message ?? '查詢失敗',
      })
    }
    await new Promise((res) => setTimeout(res, GAP_MS))
  }

  const summary: VerifyBatchSummary = {
    checked: results.length,
    mismatched: results.filter((r) => r.suggestedStatus && r.suggestedStatus !== r.crmStatus).length,
    closed: results.filter((r) => r.closed).length,
    notFound: results.filter((r) => !r.found && !r.error).length,
    failed: results.filter((r) => r.error).length,
    startedAt,
    finishedAt: new Date().toISOString(),
  }

  // 併入既有結果（同一客戶以新的覆蓋），供頁面顯示「已查證」徽章
  const prev = (await getRedisValue<VerifyResult[]>(KEY).catch(() => null)) ?? []
  const merged = new Map(prev.map((r) => [r.customerId, r]))
  for (const r of results) merged.set(r.customerId, r)
  await setRedisValue(KEY, Array.from(merged.values()).slice(-1000), TTL_MS)
  return { results, summary }
}

export async function getVerifyResults(): Promise<VerifyResult[]> {
  return (await getRedisValue<VerifyResult[]>(KEY).catch(() => null)) ?? []
}
