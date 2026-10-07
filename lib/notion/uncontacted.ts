/**
 * 未往來名單（組合層）：客戶主檔已建檔、但公司從未與之往來的機構。
 *
 * 「已往來」要有實證，兩者任一成立即算（與市場監控頁 engagedNoContact 共用同一份定義，改這裡兩頁一起變）：
 *   ① 主檔「開發狀態」含「公司既有客戶」
 *   ② 客情紀錄裡出現過（match-context 夜間排程全掃拜訪庫算好的集合）
 * 分母一律排除已歇業／停業／撤銷。
 *
 * 客情集合拿不到（快取空）時 visitedAvailable=false——此時「未往來」會把有拜訪過的也算進來，
 * 呼叫端要標示、且不得據此分派。
 */
import { getCustomersWithCodes, type CustomerWithCode } from '@/lib/notion/customers'
import { isInactiveCustomer } from '@/lib/customer-status'

export interface Engagement {
  markedExisting: Set<string>   // 去連字號 id
  visited:        Set<string>   // 去連字號 id（僅限傳入的有效客戶）
  engaged:        Set<string>
  visitedAvailable: boolean
}

const bare = (id: string) => id.replace(/-/g, '')

/** 對一批「有效客戶」算已往來集合。 */
export async function computeEngagement(activeCustomers: CustomerWithCode[]): Promise<Engagement> {
  const markedExisting = new Set(
    activeCustomers.filter((c) => (c.devStatus ?? []).includes('公司既有客戶')).map((c) => bare(c.id))
  )
  let visited = new Set<string>()
  let visitedAvailable = false
  try {
    const { loadMatchContext } = await import('@/lib/notion/match-context')
    const ctx = await loadMatchContext()
    visitedAvailable = ctx.visitedCustomers.size > 0
    const activeIds = new Set(activeCustomers.map((c) => bare(c.id)))
    visited = new Set(Array.from(ctx.visitedCustomers).filter((id) => activeIds.has(id)))
  } catch { /* 沒快取就只用標記 */ }
  const engaged = new Set<string>([...Array.from(markedExisting), ...Array.from(visited)])
  return { markedExisting, visited, engaged, visitedAvailable }
}

export interface UncontactedRow {
  id:          string
  name:        string
  type:        string
  city:        string
  district:    string
  status:      string
  devStage:    string
  /** 負責業務原值；空字串＝未分派 */
  salesperson: string
  /** 牙體技術師數＋牙體技術生數（0＝未填或無） */
  headcount:   number
  hasCode:     boolean
}

export interface UncontactedResult {
  items:            UncontactedRow[]
  activeTotal:      number   // 有效客戶總數（排除歇業／停業／撤銷）
  engagedTotal:     number
  visitedAvailable: boolean
}

export async function listUncontacted(): Promise<UncontactedResult> {
  const all = await getCustomersWithCodes()
  const active = all.filter((c) => !isInactiveCustomer(c.status))
  const { engaged, visitedAvailable } = await computeEngagement(active)
  const items: UncontactedRow[] = active
    .filter((c) => !engaged.has(bare(c.id)))
    .map((c) => ({
      id: c.id, name: c.name, type: c.type || '(未分類)', city: c.city, district: c.district,
      status: c.status, devStage: c.devStage, salesperson: c.salesperson ?? '',
      headcount: (c.technicianCount ?? 0) + (c.technicianTraineeCount ?? 0),
      hasCode: !!c.institutionCode?.trim(),
    }))
  return { items, activeTotal: active.length, engagedTotal: engaged.size, visitedAvailable }
}
