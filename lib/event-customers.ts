/**
 * lib/event-customers.ts —— 課程／活動客戶（組合層：活動足跡 × 客戶主檔 × 拜訪訊號 × 轄區）
 *
 * 業務首頁「課程／活動客戶」視窗的資料來源。與拜訪建議的「活動足跡」訊號同一套條件，
 * 只是換成專屬清單讓業務一打開首頁就看到，並讓主管看見沒人負責、公司戶的課程客戶。
 *
 * 列入條件（任一不符即不列）：
 *   1. 報名紀錄已配對客戶，狀態不是取消（getEventFootprints 已處理，每家取最近一次）
 *   2. 活動還沒辦，或辦完 60 天內
 *   3. 活動之後尚無拜訪紀錄 —— 拜訪回報後自動消失（拜訪訊號每晚重建，最慢隔天消失）
 *   4. 客戶機構狀態不是歇業類
 * 歸屬：
 *   mine      負責業務＝該業務
 *   territory 無人負責、在該業務轄區內、且該業務可承接新客戶
 *   unowned   無人負責、不在任何可承接者的轄區（只有主管看得到）
 *   company   負責業務＝公司（只有主管看得到；盤商一律不列）
 *   other     同事負責（只有主管看得到）
 */
import { getEventFootprints, FOOTPRINT_WINDOW_DAYS, territoryOwner, type EventFootprint } from '@/lib/registration-footprint'
import { getSystemCustomerById } from '@/lib/notion/customers'
import { getVisitSignals } from '@/lib/notion/visit-suggestions'
import { loadClaimContext } from '@/lib/notion/visit-claim'
import { getRedisValue, setRedisValue } from '@/lib/notion/shared'
import { isInactiveCustomer } from '@/lib/customer-status'

export type EventCustomer = {
  customerId: string
  name: string
  type: string
  city: string
  district: string
  owner: string              // 負責業務（空＝無人負責）
  territoryOwner: string     // 所在轄區的業務（空＝不在轄區）
  eventName: string
  eventDate: string
  upcoming: boolean
  status: string             // 已報名／已確認／已到場
  source: string
  lastVisit: string
}

export type EventCustomerScope = 'mine' | 'territory' | 'unowned' | 'company' | 'other'

const todayTW = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const daysSince = (d: string) => Math.floor((Date.parse(todayTW()) - Date.parse(d.slice(0, 10))) / 86400e3)

const CACHE_KEY = 'event-customers-v1'
const CACHE_TTL = 10 * 60_000

/** 全部符合條件的課程客戶（未分歸屬）。客戶主檔逐筆讀取、5 筆一批，結果快取 10 分鐘。 */
async function loadAll(): Promise<EventCustomer[]> {
  const cached = await getRedisValue<EventCustomer[]>(CACHE_KEY)
  if (cached) return cached

  const [footprints, { signals }] = await Promise.all([getEventFootprints(), getVisitSignals()])
  const today = todayTW()
  const candidates = Object.entries(footprints).filter(([key, fp]: [string, EventFootprint]) => {
    if (!fp.date) return false
    const upcoming = fp.date > today
    if (!upcoming && daysSince(fp.date) > FOOTPRINT_WINDOW_DAYS) return false
    const lastVisit = signals[key]?.lastVisit ?? ''
    return !lastVisit || lastVisit < fp.date
  })

  const ctx = await loadClaimContext()
  const out: EventCustomer[] = []
  for (let i = 0; i < candidates.length; i += 5) {
    const batch = candidates.slice(i, i + 5)
    const details = await Promise.all(batch.map(([key]) => getSystemCustomerById(key).catch(() => null)))
    details.forEach((c, j) => {
      if (!c || isInactiveCustomer(c.status) || c.salesperson === '盤商') return
      const [key, fp] = batch[j]
      out.push({
        customerId: c.id, name: c.name, type: c.type, city: c.city, district: c.district,
        owner: c.salesperson,
        territoryOwner: territoryOwner(ctx, c.city, c.district),
        eventName: fp.eventName, eventDate: fp.date, upcoming: fp.date > today,
        status: fp.status, source: fp.source,
        lastVisit: signals[key]?.lastVisit ?? '',
      })
    })
  }
  // 快到的課排前面（提醒出席），其次最近剛上完的
  out.sort((a, b) =>
    Number(b.upcoming) - Number(a.upcoming) ||
    (a.upcoming ? a.eventDate.localeCompare(b.eventDate) : b.eventDate.localeCompare(a.eventDate)) ||
    a.name.localeCompare(b.name, 'zh-TW'))
  await setRedisValue(CACHE_KEY, out, CACHE_TTL)
  return out
}

export function scopeFor(c: EventCustomer, me: string, canClaim: (name: string) => boolean): EventCustomerScope {
  if (c.owner === '公司') return 'company'
  if (c.owner) return c.owner === me ? 'mine' : 'other'
  if (c.territoryOwner && canClaim(c.territoryOwner)) return c.territoryOwner === me ? 'territory' : 'other'
  return 'unowned'
}

export async function listEventCustomers(params: { viewer: string; manager: boolean }) {
  const [all, ctx] = await Promise.all([loadAll(), loadClaimContext()])
  const canClaim = (name: string) => ctx.canClaimBy.get(name) === true
  const items = all.map((c) => ({ ...c, scope: scopeFor(c, params.viewer, canClaim) }))
  if (params.manager) return items
  return items.filter((c) => c.scope === 'mine' || c.scope === 'territory')
}
