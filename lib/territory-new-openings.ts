/**
 * lib/territory-new-openings.ts —— 轄區新機構（組合層：醫事比對 × 轄區 × 客戶主檔）
 *
 * 業務個人頁的「轄區新機構」視窗與首頁同名數字卡共用這一份計算，兩邊不會各算一套。
 *
 * ── 為什麼重做（2026-09-14）─────────────────────────────────────────────────
 * 既有首頁卡片（c866570 → 09ad1b7）只算「已被管理員從醫事監控匯入客戶庫、
 * 開發來源＝BAS新開業、尚無人負責」的客戶。實測全庫這種客戶只有 1 筆，
 * 所以卡片幾乎永遠是 0；而真正的訊號——衛福部登記開業、但還不在客戶庫的機構——
 * 必須等管理員手動按比對、再手動匯入才會出現，業務完全看不到。
 * 當日實測這類機構 40 家，其中 29 家落在業務轄區（Eason 11、Hank 8、Duncan 5、Gus 5）。
 *
 * 本模組納入兩種來源，都視為「醫事比對找出的轄區新客戶」：
 *   notInDb  —— 衛福部開業清單有、客戶庫沒有（醫事比對的「待開發機構」）
 *   imported —— 已匯入客戶庫（開發來源＝BAS新開業）但還沒有人負責
 * 兩者都會自己消失：被匯入／被認領之後下次計算就不再出現，不需要任何人手動結案。
 *
 * 地址揭露：notInDb 的地址來自衛福部公開的醫事查詢系統，屬公開資料，可顯示；
 * imported 已是客戶主檔紀錄，依「未認領客戶不得開放看地址/電話」鐵則不回傳地址。
 *
 * 資料新鮮度：比對結果存 Redis（medical-monitor:last-result），由每晚排程重算；
 * 快取不存在時當場算一次並回寫（約 60 秒），之後管理頁與個人頁都讀同一份。
 */
import { computeMonitor, type MonitorResult, type NewOpening } from '@/lib/medical-monitor-compare'
import { getCachedMonitorResult, setCachedMonitorResult } from '@/lib/notion/medical-monitor'
import { listTerritories } from '@/lib/notion/territories'
import { listPipelineCustomers } from '@/lib/notion/customers'
import { isInactiveCustomer } from '@/lib/customer-status'

export type TerritoryNewOpening = {
  key: string
  source: 'notInDb' | 'imported'
  name: string
  kind: string
  city: string
  district: string
  /** 只有 notInDb（衛福部公開資料）才有 */
  address: string
  institutionCode: string
  /** BAS 快照判定為本月新出現 */
  isNewThisMonth: boolean
  /** 轄區負責業務；空字串＝不在任何人的轄區 */
  owner: string
  /** imported 才有，供點進客戶頁 */
  customerId?: string
}

const tw = (s: string) => (s ?? '').replace(/臺/g, '台')

/** 讀比對快取；沒有就當場算並回寫。 */
export async function getMonitorResultForNewOpenings(allowCompute = true): Promise<(MonitorResult & { computedAt: string }) | null> {
  const cached = await getCachedMonitorResult<MonitorResult & { computedAt: string }>()
  if (cached?.newOpenings) return cached
  if (!allowCompute) return null
  const fresh = await computeMonitor()
  await setCachedMonitorResult(fresh)
  return fresh as MonitorResult & { computedAt: string }
}

/** 轄區對照：「縣市|行政區」→ 業務；行政區留空的轄區＝整個縣市 */
async function loadTerritoryOwners() {
  const territories = (await listTerritories().catch(() => []))
    .filter((t) => t.status !== '結束' && t.status !== '暫停' && t.city && t.salesperson)
  const byArea = new Map<string, string>()
  const byCity = new Map<string, string>()
  for (const t of territories) {
    if (t.district) byArea.set(`${tw(t.city)}|${tw(t.district)}`, t.salesperson)
    else byCity.set(tw(t.city), t.salesperson)
  }
  return (city: string, district: string) =>
    byArea.get(`${tw(city)}|${tw(district)}`) ?? byCity.get(tw(city)) ?? ''
}

export async function listTerritoryNewOpenings(params: {
  /** 指定業務只回他的；不帶＝全體（主管檢視，含不在任何轄區者） */
  salesperson?: string
  /** 快取不存在時是否當場重算（約 60 秒）。首頁數字卡傳 false，避免每次開首頁都觸發全庫比對 */
  allowCompute?: boolean
} = {}): Promise<{ items: TerritoryNewOpening[]; computedAt: string; snapshotFetched: string }> {
  const [result, ownerOf, pipeline] = await Promise.all([
    getMonitorResultForNewOpenings(params.allowCompute ?? true),
    loadTerritoryOwners(),
    listPipelineCustomers().catch(() => []),
  ])

  const bas: NewOpening[] = !result ? [] : [
    ...(result.newOpenings?.clinics ?? []),
    ...(result.newOpenings?.labs ?? []),
    ...(result.newOpenings?.hospitals ?? []),
  ]

  const items: TerritoryNewOpening[] = [
    ...bas.map((n): TerritoryNewOpening => ({
      key: `bas:${n.code}`,
      source: 'notInDb',
      name: n.name, kind: n.kind, city: n.city, district: n.district,
      address: n.address, institutionCode: n.code,
      isNewThisMonth: n.isNewThisMonth,
      owner: ownerOf(n.city, n.district),
    })),
    ...pipeline
      .filter((c) => c.devSource === 'BAS新開業' && !c.salesperson?.trim() && !isInactiveCustomer(c.status))
      .map((c): TerritoryNewOpening => ({
        key: `customer:${c.id}`,
        source: 'imported',
        name: c.name, kind: c.type, city: c.city, district: c.district,
        address: '', institutionCode: '',
        isNewThisMonth: false,
        owner: ownerOf(c.city, c.district),
        customerId: c.id,
      })),
  ]

  const scoped = params.salesperson ? items.filter((i) => i.owner === params.salesperson) : items
  // 本月新增排最前，其次尚未建檔（最需要趕快聯絡），再依縣市行政區聚在一起方便排路線
  scoped.sort((a, b) =>
    Number(b.isNewThisMonth) - Number(a.isNewThisMonth) ||
    Number(a.source === 'imported') - Number(b.source === 'imported') ||
    `${a.city}${a.district}`.localeCompare(`${b.city}${b.district}`, 'zh-TW') ||
    a.name.localeCompare(b.name, 'zh-TW'))

  return {
    items: scoped,
    computedAt: result?.computedAt ?? '',
    snapshotFetched: result?.snapshotFetched ?? '',
  }
}
