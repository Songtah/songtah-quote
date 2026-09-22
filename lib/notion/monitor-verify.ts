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

export type FieldDiff = { field: string; label: string; from: string; to: string }

export type VerifyResult = {
  customerId: string
  customerName: string
  city: string
  institutionCode: string
  /** 客戶主檔目前登記的代碼（更換代碼的候選會與查詢用的代碼不同） */
  crmCode: string
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
  /** 衛福部代碼與主檔不同 → 換照換碼，套用時要一起更正 */
  codeMismatch: boolean
  /** 所有與主檔不同的欄位（狀態、代碼、地址、電話、健保特約、人員數、三個連結、名稱） */
  diffs: FieldDiff[]
  /** 可直接寫回的值（apply 用；名稱另由使用者勾選才寫） */
  patch: Record<string, unknown>
  checkedAt: string
  error?: string
}

export type VerifyBatchSummary = {
  checked: number
  /** 狀態或代碼與主檔不同 */
  mismatched: number
  codeMismatched: number
  /** 所有不一致欄位的總數 */
  fieldDiffs: number
  closed: number
  notFound: number
  failed: number
  startedAt: string
  finishedAt: string
}

const KEY = 'medical-monitor:verify-v2'   // v2＝逐欄比對
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

/** 客戶主檔現值，供逐欄比對 */
export type CrmSnapshot = {
  address?: string; phone?: string; nhi?: boolean
  dentistCount?: number | null; technicianCount?: number | null; technicianTraineeCount?: number | null
  infoUrl?: string; personnelUrl?: string; deptUrl?: string
}

export type VerifyTarget = {
  customerId: string; customerName: string; city: string
  crm?: CrmSnapshot
  /** 查詢用的代碼（更換代碼候選會帶新碼） */
  institutionCode: string
  /** 客戶主檔目前的代碼；不給就視同 institutionCode */
  crmCode?: string
  crmStatus: string; kind?: string
}

export async function verifyCandidates(targets: VerifyTarget[]): Promise<{
  results: VerifyResult[]; summary: VerifyBatchSummary
}> {
  const startedAt = new Date().toISOString()
  const results: VerifyResult[] = []
  for (const t of targets.slice(0, MAX_ITEMS)) {
    const crmCode = (t.crmCode ?? t.institutionCode ?? '').trim()
    const base = {
      customerId: t.customerId, customerName: t.customerName, city: t.city,
      institutionCode: t.institutionCode, crmCode, crmStatus: t.crmStatus,
      checkedAt: new Date().toISOString(),
    }
    try {
      const r: any = await lookupInstitution({ name: t.customerName, kind: t.kind, city: t.city })
      const basStatus = r?.status ?? ''
      const basCode = r?.code ?? ''
      const full = r?.full ?? null
      const crm = t.crm ?? {}
      const diffs: FieldDiff[] = []
      const patch: Record<string, unknown> = {}
      const str = (v: unknown) => (v ?? '').toString().trim()
      const addStr = (field: string, label: string, from: unknown, to: unknown) => {
        const f = str(from), v = str(to)
        if (v && v !== f) { diffs.push({ field, label, from: f, to: v }); patch[field] = v }
      }
      if (r?.found) {
        const sug = basToCrmStatus(basStatus)
        if (sug && sug !== str(t.crmStatus)) {
          diffs.push({ field: 'status', label: '機構狀態', from: str(t.crmStatus) || '（未填）', to: sug })
          patch.status = sug
        }
        if (basCode && crmCode && basCode !== crmCode) {
          diffs.push({ field: 'institutionCode', label: '機構代碼', from: crmCode, to: basCode })
          patch.institutionCode = basCode
        }
        if (full) {
          addStr('address', '地址', crm.address, full.address)
          addStr('phone', '電話', crm.phone, full.phone)
          if (typeof full.nhi === 'boolean' && typeof crm.nhi === 'boolean' && full.nhi !== crm.nhi) {
            diffs.push({ field: 'nhi', label: '健保特約', from: crm.nhi ? '是' : '否', to: full.nhi ? '是' : '否' })
            patch.nhi = full.nhi
          }
          const num = (field: string, label: string, from: unknown, to: unknown) => {
            if (typeof to === 'number' && to !== (typeof from === 'number' ? from : null)) {
              diffs.push({ field, label, from: from == null ? '（未填）' : String(from), to: String(to) })
              patch[field] = to
            }
          }
          num('dentistCount', '牙醫師數', crm.dentistCount, full.dentistCount)
          num('technicianCount', '牙體技術師數', crm.technicianCount, full.technicianCount)
          num('technicianTraineeCount', '牙體技術生數', crm.technicianTraineeCount, full.technicianTraineeCount)
          addStr('infoUrl', '機構資料連結', crm.infoUrl, full.infoUrl)
          addStr('personnelUrl', '醫事人員連結', crm.personnelUrl, full.personnelUrl)
          addStr('deptUrl', '診療科別連結', crm.deptUrl, full.deptUrl)
          // 名稱差異只列出、不放進 patch：客戶名稱是客情比對依據，改名要使用者明確勾選
          const basName = str(full.name)
          if (basName && basName !== str(t.customerName)) {
            diffs.push({ field: 'name', label: '客戶名稱', from: str(t.customerName), to: basName })
          }
        }
      }
      results.push({
        ...base,
        found: Boolean(r?.found),
        basStatus,
        basCode,
        closed: isClosedStatus(basStatus),
        outOfCity: Boolean(r?.outOfCity),
        suggestedStatus: r?.found ? basToCrmStatus(basStatus) : '',
        codeMismatch: Boolean(r?.found && basCode && crmCode && basCode !== crmCode),
        diffs,
        patch,
      })
    } catch (e: any) {
      results.push({
        ...base, found: false, basStatus: '', basCode: '', closed: false,
        outOfCity: false, suggestedStatus: '', codeMismatch: false, diffs: [], patch: {},
        error: e?.message ?? '查詢失敗',
      })
    }
    await new Promise((res) => setTimeout(res, GAP_MS))
  }

  const summary: VerifyBatchSummary = {
    checked: results.length,
    mismatched: results.filter((r) => r.diffs.length > 0).length,
    codeMismatched: results.filter((r) => r.codeMismatch).length,
    fieldDiffs: results.reduce((n, r) => n + r.diffs.length, 0),
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
