/**
 * 近半年新增／減少趨勢（組合層）：長條數字＋逐筆名單一起算好、一起存。
 *
 * 使用者 2026-10-07 定調：開頁、點長條都直接讀存好的結果；只有按「重新計算」或每晚排程
 * （/api/cron/refresh-kind-trend）才重算。名單上的「客戶主檔」標記因此是重算當下的狀態。
 *
 * 名單加值：
 *   - 衛福部頁面連結與真實狀態：依代碼查 data/bas-cache.json
 *   - 舊紀錄只有備用鍵（名稱__縣市__區、當時尚未解析到代碼）→ 以「同名＋同縣市區、唯一」在快取裡找回正式代碼
 *   - 客戶主檔：以（找回後的）代碼對客戶主檔
 */
import { computeMonitorKindTrend, type MonitorKindTrend, type MonitorTrendKind } from '@/lib/notion/medical-monitor'
import { getCustomersWithCodes } from '@/lib/notion/customers'
import { loadBasCacheIndex, basVerdict, type BasCacheRow, type BasVerdict } from '@/lib/bas-cache-index'
import { getRedis } from '@/lib/notion/shared'

export type KindTrendItem = {
  month: string
  kind: MonitorTrendKind
  dir: 'added' | 'removed'
  code: string                // 正式代碼；備用鍵找不回時保留原鍵
  name: string
  address: string
  specialty: string
  changeType: string          // 新開業／恢復開業／停業／新增停業
  termDate: string
  basStatus: string
  basVerdict?: BasVerdict     // 只有減少才有
  basDetailUrl: string
  customer: { id: string; name: string; salesperson: string; status: string } | null
}

export type KindTrendWithItems = MonitorKindTrend & { items: KindTrendItem[] }

const KEY = (months: number) => `medical-monitor:kind-trend-v4:${months}`   // v4＝連同逐筆名單一起存
const TTL_MS = 60 * 24 * 3600_000   // 每晚重算；60 天只是保險，不靠過期刷新

const norm = (s: string) => (s ?? '').replace(/\s/g, '').replace(/台/g, '臺')

/** 備用鍵 → 正式代碼：同名、地址以該縣市區開頭、唯一（多筆時取仍開業者，仍不唯一就放棄） */
function makeTempKeyResolver(bas: Map<string, BasCacheRow>) {
  const byName = new Map<string, BasCacheRow[]>()
  for (const row of Array.from(bas.values())) {
    const k = norm(row.name)
    if (!k) continue
    const list = byName.get(k) ?? []
    list.push(row)
    byName.set(k, list)
  }
  return (tempKey: string): BasCacheRow | undefined => {
    const [name, city, dist] = tempKey.split('__')
    const area = norm(`${city ?? ''}${dist ?? ''}`)
    const hits = (byName.get(norm(name)) ?? []).filter((r) => norm(r.address).startsWith(area))
    if (hits.length === 1) return hits[0]
    const open = hits.filter((r) => basVerdict(r) !== 'closed' && basVerdict(r) !== 'suspended')
    return open.length === 1 ? open[0] : undefined
  }
}

async function compute(months: number): Promise<KindTrendWithItems> {
  const [{ trend, records }, customers] = await Promise.all([
    computeMonitorKindTrend(months),
    getCustomersWithCodes().catch(() => []),
  ])
  const custByCode = new Map(customers.filter((c) => c.institutionCode).map((c) => [c.institutionCode.trim(), c]))
  const bas = loadBasCacheIndex()
  const resolveTemp = makeTempKeyResolver(bas)

  const items: KindTrendItem[] = records.map((r) => {
    const raw = r.institutionCode.trim()
    const b = raw.includes('__') ? resolveTemp(raw) : bas.get(raw)
    const code = b?.code ?? raw
    const c = custByCode.get(code)
    return {
      month: r.month, kind: r.kind, dir: r.dir,
      code,
      name: r.nhiName || b?.name || r.customerName || r.title,
      address: b?.address || r.address,
      specialty: r.specialty,
      changeType: r.type,
      termDate: r.termDate,
      basStatus: b?.statusCheckedAt ? b.status : '',
      basVerdict: r.dir === 'removed' ? basVerdict(b) : undefined,
      basDetailUrl: b?.detailUrl ?? '',
      customer: c ? { id: c.id, name: c.name, salesperson: c.salesperson, status: c.status } : null,
    }
  }).sort((a, b) => (a.address || '').localeCompare(b.address || '') || a.name.localeCompare(b.name))

  return { ...trend, items }
}

/**
 * 讀存好的趨勢；沒有（首次）或 refresh 才重算並存起來。
 * 直接讀寫 Redis、不經 L1——重算後其他 serverless 實例才不會繼續回舊結果。
 */
export async function getKindTrend(options: { months?: number; refresh?: boolean } = {}): Promise<KindTrendWithItems> {
  const months = options.months ?? 6
  const r = getRedis()
  if (!options.refresh && r) {
    try {
      const cached = await r.get<KindTrendWithItems>(KEY(months))
      if (cached && Array.isArray(cached.items)) return cached
    } catch { /* 讀不到就重算 */ }
  }
  const out = await compute(months)
  if (r) {
    try { await r.set(KEY(months), out, { px: TTL_MS }) } catch (e) { console.warn('[kind-trend] save failed:', e) }
  }
  return out
}
