/**
 * lib/registration-footprint.ts —— 客戶足跡（組合層：活動報名 × 活動 × 客戶主檔）
 *
 * 行銷活動整合（2026-09-15 使用者定案）：
 *   課程報名 → 外掛表單直接寫 Notion 報名 DB
 *   展會參與 → 現場 QR 簽到頁 /checkin 寫入同一個報名 DB
 *   驅動方式 → 成為「拜訪建議」的訊號，負責業務自動看到，不新增任何手動項目
 *
 * 本模組做兩件事，都不需要人：
 *   1. processRegistrations：補「活動」relation（依表單活動名稱）與「客戶配對」relation
 *   2. getEventFootprints：每家客戶最近一次的活動足跡，供拜訪建議評分
 *
 * 配對寧可漏、不可錯掛（與 LINE 客情自動關聯同標準）：
 *   名稱字根唯一相符 → 配對；多家同名 → 用縣市、再用電話末 8 碼縮小；仍不唯一 → 不配對，寫明原因。
 * 已經有客戶配對的（人工或先前自動）一律不覆寫。
 *
 * 客戶庫查無 → 比照醫事監控匯入自動建檔（2026-09-15 使用者定案「比照」）：
 *   以衛福部 BAS 開業名單確認是真實機構（名稱唯一相符，縣市縮小）才建，查不到或不唯一就不建——
 *   報名表的機構名稱是訪客手打的，不能讓錯字、個人、公司行號灌進客戶主檔。
 *   BAS 機構代碼已在客戶庫 → 直接配對那家（名稱寫法不同但同一家）。
 *   建檔：開發階段＝線索、開發來源＝活動報名，資料由 BAS 詳細頁帶入（lib/bas-customer-import）；
 *   所在行政區有轄區且該業務可承接新客戶 → 指派負責業務（只寫空白，比照轄區內自動認領）。
 */
import {
  listRecentRegistrations, updateRegistrationLinks, listAllEvents,
  type EventItem, type EventRegistration,
} from '@/lib/notion/events'
import {
  getAllSystemCustomers, getSystemCustomerById, getCustomersWithCodes, assignSalesperson,
  type CustomerListItem, type CustomerWithCode,
} from '@/lib/notion/customers'
import { loadClaimContext, type ClaimContext } from '@/lib/notion/visit-claim'
import { loadOpenBasInstitutions, createCustomerFromBas, type BasInstitution } from '@/lib/bas-customer-import'
import { logAuditEvent } from '@/lib/audit'
import { getRedisValue, setRedisValue, deleteRedisValue } from '@/lib/notion/shared'
import { isSameCustomerName, customerNameStem } from '@/lib/customer-name-match'
import { isInactiveCustomer } from '@/lib/customer-status'

/** 足跡有效期：超過就不再當作拜訪訊號 */
export const FOOTPRINT_WINDOW_DAYS = 60
/** 自動配對回溯範圍：表單可能晚幾週才補齊，放寬到 120 天 */
const PROCESS_WINDOW_DAYS = 120

const tw = (s: string) => (s ?? '').replace(/臺/g, '台').trim()
const phoneTail = (s: string) => (s ?? '').replace(/\D/g, '').replace(/^886/, '0').slice(-8)

// ── 1. 活動關聯 ─────────────────────────────────────────────────

function matchEvent(formName: string, events: EventItem[]): EventItem | null {
  const key = formName.replace(/\s/g, '')
  if (!key) return null
  const exact = events.filter((e) => e.name.replace(/\s/g, '') === key)
  if (exact.length === 1) return exact[0]
  const partial = events.filter((e) => {
    const n = e.name.replace(/\s/g, '')
    return n && (n.includes(key) || key.includes(n))
  })
  return partial.length === 1 ? partial[0] : null
}

// ── 2. 客戶配對 ─────────────────────────────────────────────────

async function matchCustomer(
  reg: EventRegistration, customers: CustomerListItem[],
): Promise<{ customerId: string | null; note: string; notFound?: boolean }> {
  const name = reg.institution.trim()
  if (customerNameStem(name).length < 2) return { customerId: null, note: '機構名稱太短，無法比對' }

  let hits = customers.filter((c) => !isInactiveCustomer(c.status) && isSameCustomerName(name, c.name))
  if (hits.length === 0) return { customerId: null, note: '客戶庫查無此機構', notFound: true }
  if (hits.length === 1) return { customerId: hits[0].id, note: `名稱相符：${hits[0].name}` }

  if (reg.city) {
    const inCity = hits.filter((c) => tw(c.city).startsWith(tw(reg.city).slice(0, 2)))
    if (inCity.length === 1) return { customerId: inCity[0].id, note: `名稱＋縣市相符：${inCity[0].name}` }
    if (inCity.length > 1) hits = inCity
    // 同名的都在別的縣市＝不是同一家（實測「高登」在北市、高雄、桃園各有一家，報名者在新北）
    // → 視為客戶庫查無，交給 BAS 確認；BAS 那關仍要求唯一相符且代碼不在客戶庫才建
    else return { customerId: null, note: `客戶庫在${reg.city}查無此機構`, notFound: true }
  }

  const tail = phoneTail(reg.phone)
  if (tail.length === 8 && hits.length <= 8) {
    const details = await Promise.all(hits.map((c) => getSystemCustomerById(c.id)))
    const byPhone = details.filter((d) => d && phoneTail(d.phone) === tail)
    if (byPhone.length === 1) return { customerId: byPhone[0]!.id, note: `名稱＋電話相符：${byPhone[0]!.name}` }
  }

  return {
    customerId: null,
    note: `同名機構 ${hits.length} 家無法確定：${hits.slice(0, 4).map((c) => `${c.name}（${c.city}${c.district}）`).join('、')}`,
  }
}

// ── 2b. 客戶庫查無 → 以 BAS 確認後自動建檔 ─────────────────────────

const sameCity = (a: string, b: string) => !!a && !!b && tw(a).slice(0, 2) === tw(b).slice(0, 2)

type BasResolution =
  | { kind: 'none' | 'ambiguous'; note: string }
  | { kind: 'existing'; customerId: string; note: string }
  | { kind: 'create'; inst: BasInstitution }

function resolveViaBas(reg: EventRegistration, codes: Map<string, CustomerWithCode>): BasResolution {
  let hits = loadOpenBasInstitutions().filter((b) => isSameCustomerName(reg.institution, b.name))
  if (reg.city && hits.length > 1) {
    const inCity = hits.filter((b) => sameCity(b.city, reg.city))
    if (inCity.length) hits = inCity
  }
  if (hits.length === 0) {
    return { kind: 'none', note: '客戶庫與衛福部開業名單皆查無（可能是錯字、個人或非醫事機構），未自動建檔' }
  }
  if (hits.length > 1) {
    const list = hits.slice(0, 4).map((b) => `${b.name}（${b.city}${b.district}）`).join('、')
    return { kind: 'ambiguous', note: `衛福部開業名單同名 ${hits.length} 家，未自動建檔：${list}${reg.city ? '' : '（報名未填縣市）'}` }
  }
  const inst = hits[0]
  const existing = codes.get(inst.code)
  if (existing) return { kind: 'existing', customerId: existing.id, note: `機構代碼相符：${existing.name}（${inst.code}）` }
  return { kind: 'create', inst }
}

/** 轄區主人；轄區表與 BAS 的「台／臺」寫法可能不同，兩種都試 */
function territoryOwner(ctx: ClaimContext, city: string, district: string): string {
  const forms = (s: string) => Array.from(new Set([s, s.replace(/台/g, '臺'), s.replace(/臺/g, '台')]))
  for (const c of forms(city)) for (const d of forms(district)) {
    const owner = ctx.ownerByTerritory.get(`${c}|${d}`)
    if (owner) return owner
  }
  return ''
}

export type ProcessResult = {
  scanned: number
  eventLinked: number
  customerMatched: number
  /** 客戶庫查無、經 BAS 確認後自動建檔 */
  customerCreated: number
  unmatched: number
  /** dryRun 時列出將寫入的內容（不寫 Notion） */
  planned?: {
    id: string; institution: string; patch: Record<string, unknown>
    create?: { code: string; name: string; area: string; assignTo: string }
  }[]
}

/**
 * 補齊近 120 天報名的活動關聯與客戶配對。冪等：已有值的欄位不重寫。
 *
 * 客戶配對要掃全客戶庫（冷啟動約 60 秒），每小時都重掃會拖垮 Notion 配額。所以：
 *   一般執行只處理「還沒試過配對」的新報名（配對說明為空）；
 *   retryUnmatched（每天第一輪排程、活動頁「立即重新配對」）才重試先前沒配到的——
 *   例如當時是新機構、之後被匯入客戶庫。
 */
export async function processRegistrations(params: { onlyIds?: string[]; dryRun?: boolean; retryUnmatched?: boolean } = {}): Promise<ProcessResult> {
  const regs = (await listRecentRegistrations(PROCESS_WINDOW_DAYS))
    .filter((r) => r.status !== '取消')
    .filter((r) => !params.onlyIds || params.onlyIds.includes(r.id))
  const result: ProcessResult = {
    scanned: regs.length, eventLinked: 0, customerMatched: 0, customerCreated: 0, unmatched: 0,
    ...(params.dryRun ? { planned: [] } : {}),
  }
  const needsCustomer = (r: EventRegistration) => !r.customerId && (params.retryUnmatched || !r.matchNote)
  const pending = regs.filter((r) => (!r.eventId && r.formEventName) || !r.source || needsCustomer(r))
  if (!pending.length) return result

  const [events, cachedCustomers] = await Promise.all([
    pending.some((r) => !r.eventId) ? listAllEvents() : Promise.resolve([] as EventItem[]),
    pending.some(needsCustomer) ? getAllSystemCustomers() : Promise.resolve([] as CustomerListItem[]),
  ])
  // 複製一份：同一輪新建的客戶會加進來，不能改到共用快取
  const customers = [...cachedCustomers]
  // BAS 建檔需要的資料只在真的遇到「客戶庫查無」時才載入
  let codes: Map<string, CustomerWithCode> | null = null
  let claimCtx: ClaimContext | null = null

  for (const reg of pending) {
    const patch: Parameters<typeof updateRegistrationLinks>[1] = {}
    let create: { code: string; name: string; area: string; assignTo: string } | undefined
    if (!reg.source) patch.source = '報名表單'   // 外掛表單寫入時通常不帶來源
    if (!reg.eventId && reg.formEventName) {
      const ev = matchEvent(reg.formEventName, events)
      if (ev) { patch.eventId = ev.id; result.eventLinked++ }
    }
    if (needsCustomer(reg)) {
      const matched = await matchCustomer(reg, customers)
      let customerId = matched.customerId
      let note = matched.note

      if (!customerId && matched.notFound) {
        codes ??= new Map((await getCustomersWithCodes()).filter((c) => c.institutionCode).map((c) => [c.institutionCode, c]))
        const bas = resolveViaBas(reg, codes)
        if (bas.kind === 'existing') {
          customerId = bas.customerId
          note = bas.note
        } else if (bas.kind === 'create') {
          claimCtx ??= await loadClaimContext()
          const { inst } = bas
          const owner = territoryOwner(claimCtx, inst.city, inst.district)
          // canClaimBy 查不到視為不可承接（fail-closed，與認領一致）
          const assignTo = owner && claimCtx.canClaimBy.get(owner) === true ? owner : ''
          const ownerNote = assignTo ? `，依轄區指派 ${assignTo}`
            : owner ? `，轄區業務 ${owner} 不承接新客戶，待認領` : '，不在任何轄區，待認領'
          note = `依衛福部開業名單自動建檔（${inst.code}）${ownerNote}`
          create = { code: inst.code, name: inst.name, area: `${inst.city}${inst.district}`, assignTo }

          if (!params.dryRun) {
            const created = await createCustomerFromBas(inst, '活動報名')
            if (assignTo) await assignSalesperson([created.id], assignTo)
            customerId = created.id
            logAuditEvent({
              module: 'crm', action: 'create', entityType: 'customer', entityId: created.id, entityTitle: inst.name,
              summary: `活動報名自動建檔：${inst.name}（${inst.code}）${ownerNote}；報名填寫「${reg.institution}」`,
              actor: { name: '系統自動（活動報名）', role: 'system' },
              after: { ...inst, salesperson: assignTo, registrationId: reg.id },
            }).catch(() => {})
          }
          // 同一輪後面若有同一家的報名，直接配到這筆，不重複建
          const id = customerId ?? `dryrun:${inst.code}`
          customers.push({ id, name: inst.name, city: inst.city, district: inst.district, type: '', salesperson: assignTo, status: '開業' })
          codes.set(inst.code, { id, name: inst.name, city: inst.city, district: inst.district, type: '', status: '開業', devStage: '線索', institutionCode: inst.code })
          result.customerCreated++
        } else {
          note = bas.note
        }
      }

      if (customerId || create) {
        if (customerId) patch.customerId = customerId
        patch.matchNote = note
        if (!create) result.customerMatched++
      } else {
        result.unmatched++
        if (note !== reg.matchNote) patch.matchNote = note
      }
    }
    if (!Object.keys(patch).length) continue
    if (params.dryRun) result.planned!.push({ id: reg.id, institution: reg.institution, patch, ...(create ? { create } : {}) })
    else await updateRegistrationLinks(reg.id, patch)
  }

  if (!params.dryRun && (result.customerMatched || result.customerCreated || result.eventLinked)) await deleteRedisValue(FOOTPRINTS_CACHE_KEY)
  return result
}

// ── 3. 足跡訊號 ─────────────────────────────────────────────────

export type EventFootprint = {
  /** 活動日（無活動日則為報名日），YYYY-MM-DD */
  date: string
  eventName: string
  eventType: string
  status: string          // 已到場／已確認／已報名
  source: string
}

const FOOTPRINTS_CACHE_KEY = 'event-footprints-v1'

/** 客戶 id（去 dash）→ 最近一次足跡。已到場優先於報名。快取 1 小時，配對寫入時清除。 */
export async function getEventFootprints(): Promise<Record<string, EventFootprint>> {
  const cached = await getRedisValue<Record<string, EventFootprint>>(FOOTPRINTS_CACHE_KEY)
  if (cached) return cached

  const regs = (await listRecentRegistrations(FOOTPRINT_WINDOW_DAYS + 90))
    .filter((r) => r.customerId && r.status !== '取消')
  const out: Record<string, EventFootprint> = {}
  if (regs.length) {
    const events = new Map((await listAllEvents()).map((e) => [e.id, e]))
    const rank = (s: string) => (s === '已到場' ? 2 : 1)
    for (const r of regs) {
      const ev = events.get(r.eventId)
      const fp: EventFootprint = {
        // 現場簽到以實際簽到日為準（多日展會第三天來的就是第三天）；報名以活動日為準
        date: r.status === '已到場' && r.registeredAt
          ? new Date(new Date(r.registeredAt).getTime() + 8 * 3600_000).toISOString().slice(0, 10)
          : (ev?.date || r.registeredAt || '').slice(0, 10),
        eventName: ev?.name || r.formEventName || '活動',
        eventType: ev?.type ?? '',
        status: r.status,
        source: r.source,
      }
      const key = r.customerId.replace(/-/g, '')
      const prev = out[key]
      if (!prev || fp.date > prev.date || (fp.date === prev.date && rank(fp.status) > rank(prev.status))) out[key] = fp
    }
  }
  await setRedisValue(FOOTPRINTS_CACHE_KEY, out, 60 * 60_000)
  return out
}
