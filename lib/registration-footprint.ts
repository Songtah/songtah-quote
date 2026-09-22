/**
 * lib/registration-footprint.ts —— 客戶足跡（組合層：活動報名 × 活動 × 客戶主檔）
 *
 * 行銷活動整合（2026-09-15 使用者定案）：
 *   課程報名 → 外掛表單直接寫 Notion 報名 DB
 *   展會參與 → 現場 QR 簽到頁 /checkin 寫入同一個報名 DB
 *   歷史紀錄 → 活動管理「匯入歷史紀錄」（來源＝歷史匯入）
 *   驅動方式 → 成為「拜訪建議」的訊號，負責業務自動看到，不新增任何手動項目
 *
 * 本模組做三件事，都不需要人：
 *   1. createCustomerResolver：機構名稱 → 客戶（配對或依 BAS 建檔），排程與匯入預覽共用同一套判斷
 *   2. processRegistrations：補「活動」relation（依表單活動名稱）與「客戶配對」relation
 *   3. getEventFootprints：每家客戶最近一次的活動足跡，供拜訪建議評分
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
import { UNKNOWN_INSTITUTION } from '@/lib/event-import'

/** 足跡有效期：超過就不再當作拜訪訊號 */
export const FOOTPRINT_WINDOW_DAYS = 60
/** 自動配對回溯範圍（依報名建立時間）：表單可能晚幾週才補齊，放寬到 120 天 */
const PROCESS_WINDOW_DAYS = 120
/**
 * 單次執行最多自動建檔幾家：每家要打一次 BAS 詳細頁＋Notion 建檔與指派，
 * 一次匯入幾百筆歷史紀錄時不限制會超過函式時限。超過的留給下一輪（配對說明保持空白＝仍待處理）。
 */
const DEFAULT_MAX_CREATES = 25

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

// ── 2. 客戶解析（配對或依 BAS 建檔）────────────────────────────────

export type ResolveInput = { institution: string; city: string; district?: string; phone: string }

const sameCity = (a: string, b: string) => !!a && !!b && tw(a).slice(0, 2) === tw(b).slice(0, 2)
const sameDistrict = (a: string, b: string) => !!a && !!b && tw(a) === tw(b)

type InstitutionKind = 'lab' | 'clinic' | 'hospital' | 'company' | ''

/**
 * 從名稱看機構類別。名字字根相同但類別不同的不是同一家——
 * 實測（2025–2026 課程名單 345 筆）：「三口管理顧問股份有限公司」被配到三口牙技所、
 * 「品安牙技所」因為有 5 家品安牙醫診所而被判無法確定。
 * 名稱同時出現兩種類別（「高新牙醫診所-康新機技工所」）視為無法判斷，不過濾。
 */
function kindFromName(name: string): InstitutionKind {
  const s = name ?? ''
  const lab = /(牙體技術|牙技|技工|技術所|齒研|鑲牙)/.test(s)
  const clinic = /(牙醫|診所|牙科)/.test(s)
  const hospital = /醫院/.test(s)
  const company = /(公司|企業社|商行)/.test(s)
  const hits = [lab, clinic, hospital, company].filter(Boolean).length
  if (hits !== 1) return hospital && clinic && !lab ? 'hospital' : ''   // 「XX醫院牙科」算醫院
  return lab ? 'lab' : clinic ? 'clinic' : hospital ? 'hospital' : 'company'
}

function kindFromCustomerType(type: string): InstitutionKind {
  if (/(牙體技術所|鑲牙所)/.test(type)) return 'lab'
  if (/(牙醫診所|衛生所)/.test(type)) return 'clinic'
  if (/醫院/.test(type)) return 'hospital'
  if (/(公司|同業)/.test(type)) return 'company'
  return ''
}

function kindFromBas(kind: string): InstitutionKind {
  if (/(牙體技術所|鑲牙所)/.test(kind)) return 'lab'
  if (/(診所|衛生所)/.test(kind)) return 'clinic'
  return 'hospital'
}

/** 類別兩邊都看得出來且不同 → 不是同一家；任一邊看不出來就不排除 */
const kindCompatible = (a: InstitutionKind, b: InstitutionKind) => !a || !b || a === b

async function matchCustomer(
  reg: ResolveInput, customers: CustomerListItem[],
): Promise<{ customerId: string | null; note: string; notFound?: boolean }> {
  const name = reg.institution.trim()
  if (name === UNKNOWN_INSTITUTION) return { customerId: null, note: '未填所屬單位，無法對應客戶' }
  if (customerNameStem(name).length < 2) return { customerId: null, note: '機構名稱太短，無法比對' }

  const kind = kindFromName(name)
  let hits = customers.filter((c) =>
    !isInactiveCustomer(c.status) && isSameCustomerName(name, c.name) &&
    kindCompatible(kind, kindFromCustomerType(c.type) || kindFromName(c.name)))
  if (hits.length === 0) return { customerId: null, note: '客戶庫查無此機構', notFound: true }

  // ── 區域確認：有縣市（地址／地區）時，連「名稱唯一相符」也要區域一致才算同一家 ──
  // 名稱唯一不代表是同一家：客戶庫只收了其中一家分店時，別縣市的同名機構會被直接配上。
  // 客戶主檔沒填縣市／行政區的視為「無法排除」，不當作衝突。
  if (reg.city) {
    const area = reg.district ? `${reg.city}${reg.district}` : reg.city
    const inCity = hits.filter((c) => !c.city || sameCity(c.city, reg.city))
    if (inCity.length === 0) {
      // 同名的都在別的縣市＝不是同一家（實測「高登」在北市、高雄、桃園各有一家，報名者在新北）
      // → 視為客戶庫查無，交給 BAS 確認；BAS 那關仍要求區域一致、唯一相符且代碼不在客戶庫才建
      return { customerId: null, note: `客戶庫在${reg.city}查無此機構（同名者在其他縣市）`, notFound: true }
    }
    if (reg.district) {
      const inDistrict = inCity.filter((c) => c.city && c.district && sameDistrict(c.district, reg.district!))
      if (inDistrict.length === 1) return { customerId: inDistrict[0].id, note: `名稱＋地址區域相符：${inDistrict[0].name}（${area}）` }
      if (inDistrict.length > 1) hits = inDistrict
      else {
        const noDistrict = inCity.filter((c) => !c.city || !c.district)
        if (noDistrict.length === 0) {
          // 同縣市的同名者都在別的行政區：可能是不同分店，也可能客戶搬家——交給 BAS 以機構代碼確認
          return { customerId: null, note: `客戶庫在${area}查無此機構（同名者在同縣市其他行政區）`, notFound: true }
        }
        if (noDistrict.length === 1 && inCity.length === 1) {
          return { customerId: noDistrict[0].id, note: `名稱＋縣市相符（客戶主檔未填行政區，請留意）：${noDistrict[0].name}` }
        }
        hits = noDistrict
      }
    } else {
      if (inCity.length === 1) return { customerId: inCity[0].id, note: `名稱＋縣市相符：${inCity[0].name}` }
      hits = inCity
    }
  } else if (hits.length === 1) {
    return { customerId: hits[0].id, note: `名稱相符（未提供地區，未確認區域）：${hits[0].name}` }
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

type BasResolution =
  | { kind: 'none' | 'ambiguous'; note: string }
  | { kind: 'existing'; customerId: string; note: string }
  | { kind: 'create'; inst: BasInstitution }

function resolveViaBas(reg: ResolveInput, codes: Map<string, CustomerWithCode>): BasResolution {
  const kind = kindFromName(reg.institution)
  // 公司行號不在衛福部名單內，名稱再像也不建檔
  if (kind === 'company') return { kind: 'none', note: '公司行號，不在衛福部醫事機構名單內，未自動建檔' }
  let hits = loadOpenBasInstitutions().filter((b) =>
    isSameCustomerName(reg.institution, b.name) && kindCompatible(kind, kindFromBas(b.kind)))
  // 有區域就必須區域一致：不能因為衛福部名單裡剛好只有一家同名、在別的縣市，就在那裡建一筆客戶
  if (reg.city && hits.length) {
    const inCity = hits.filter((b) => sameCity(b.city, reg.city))
    if (!inCity.length) return { kind: 'none', note: `客戶庫與衛福部開業名單在${reg.city}皆查無此機構，未自動建檔` }
    hits = inCity
    if (reg.district) {
      const inDistrict = hits.filter((b) => sameDistrict(b.district, reg.district!))
      if (!inDistrict.length) return { kind: 'none', note: `客戶庫與衛福部開業名單在${reg.city}${reg.district}皆查無此機構，未自動建檔` }
      hits = inDistrict
    }
  }
  if (hits.length === 0) {
    return { kind: 'none', note: '客戶庫與衛福部開業名單皆查無（可能是錯字、個人、已歇業或非醫事機構），未自動建檔' }
  }
  if (hits.length > 1) {
    const list = hits.slice(0, 4).map((b) => `${b.name}（${b.city}${b.district}）`).join('、')
    return { kind: 'ambiguous', note: `衛福部開業名單同名 ${hits.length} 家，未自動建檔：${list}${reg.city ? '' : '（未填縣市）'}` }
  }
  const inst = hits[0]
  const existing = codes.get(inst.code)
  if (existing) return { kind: 'existing', customerId: existing.id, note: `機構代碼相符：${existing.name}（${inst.code}）` }
  return { kind: 'create', inst }
}

/** 轄區主人；轄區表與 BAS 的「台／臺」寫法可能不同，兩種都試 */
export function territoryOwner(ctx: ClaimContext, city: string, district: string): string {
  const forms = (s: string) => Array.from(new Set([s, s.replace(/台/g, '臺'), s.replace(/臺/g, '台')]))
  for (const c of forms(city)) for (const d of forms(district)) {
    const owner = ctx.ownerByTerritory.get(`${c}|${d}`)
    if (owner) return owner
  }
  return ''
}

export type CustomerResolution = {
  customerId: string | null
  note: string
  outcome: 'matched' | 'created' | 'unmatched' | 'deferred'
  create?: { code: string; name: string; area: string; assignTo: string }
}

/**
 * 建立一個解析器：同一批次內共用客戶清單、代碼表與轄區快照，並記住本批次新建的客戶，
 * 讓同一家的第二筆紀錄直接配到剛建的那筆（不重複建檔）。
 * dryRun 不寫任何東西，供匯入預覽與排程 dry-run 使用。
 */
export function createCustomerResolver(opts: { dryRun: boolean; maxCreates?: number; auditLabel?: string }) {
  let customers: CustomerListItem[] | null = null
  let codes: Map<string, CustomerWithCode> | null = null
  let claimCtx: ClaimContext | null = null
  let created = 0
  const maxCreates = opts.maxCreates ?? DEFAULT_MAX_CREATES

  return async function resolve(input: ResolveInput, refId = ''): Promise<CustomerResolution> {
    // 複製一份：本批次新建的客戶會加進來，不能改到共用快取
    customers ??= [...(await getAllSystemCustomers())]
    const matched = await matchCustomer(input, customers)
    if (matched.customerId) return { customerId: matched.customerId, note: matched.note, outcome: 'matched' }
    if (!matched.notFound) return { customerId: null, note: matched.note, outcome: 'unmatched' }

    codes ??= new Map((await getCustomersWithCodes()).filter((c) => c.institutionCode).map((c) => [c.institutionCode, c]))
    const bas = resolveViaBas(input, codes)
    if (bas.kind === 'existing') return { customerId: bas.customerId, note: bas.note, outcome: 'matched' }
    if (bas.kind !== 'create') return { customerId: null, note: bas.note, outcome: 'unmatched' }

    if (created >= maxCreates) return { customerId: null, note: '', outcome: 'deferred' }

    claimCtx ??= await loadClaimContext()
    const { inst } = bas
    const owner = territoryOwner(claimCtx, inst.city, inst.district)
    // canClaimBy 查不到視為不可承接（fail-closed，與認領一致）
    const assignTo = owner && claimCtx.canClaimBy.get(owner) === true ? owner : ''
    const ownerNote = assignTo ? `，依轄區指派 ${assignTo}`
      : owner ? `，轄區業務 ${owner} 不承接新客戶，待認領` : '，不在任何轄區，待認領'
    const note = `依衛福部開業名單自動建檔（${inst.code}）${ownerNote}`

    let customerId: string | null = null
    if (!opts.dryRun) {
      const page = await createCustomerFromBas(inst, '活動報名')
      if (assignTo) await assignSalesperson([page.id], assignTo)
      customerId = page.id
      logAuditEvent({
        module: 'crm', action: 'create', entityType: 'customer', entityId: page.id, entityTitle: inst.name,
        summary: `${opts.auditLabel ?? '活動報名自動建檔'}：${inst.name}（${inst.code}）${ownerNote}；紀錄填寫「${input.institution}」`,
        actor: { name: '系統自動（活動報名）', role: 'system' },
        after: { ...inst, salesperson: assignTo, refId },
      }).catch(() => {})
    }
    created++
    const id = customerId ?? `dryrun:${inst.code}`
    customers.push({ id, name: inst.name, city: inst.city, district: inst.district, type: '', salesperson: assignTo, status: '開業' })
    codes.set(inst.code, { id, name: inst.name, city: inst.city, district: inst.district, type: '', status: '開業', devStage: '線索', devStatus: [], salesperson: assignTo ?? '', institutionCode: inst.code })
    return {
      customerId, note, outcome: 'created',
      create: { code: inst.code, name: inst.name, area: `${inst.city}${inst.district}`, assignTo },
    }
  }
}

// ── 3. 報名處理 ─────────────────────────────────────────────────

export type ProcessResult = {
  scanned: number
  eventLinked: number
  customerMatched: number
  /** 客戶庫查無、經 BAS 確認後自動建檔 */
  customerCreated: number
  unmatched: number
  /** 超過單次建檔上限、留待下一輪的筆數 */
  deferred: number
  /** dryRun 時列出將寫入的內容（不寫 Notion） */
  planned?: {
    id: string; institution: string; patch: Record<string, unknown>
    create?: { code: string; name: string; area: string; assignTo: string }
  }[]
}

/**
 * 補齊近 120 天（建立時間）報名的活動關聯與客戶配對。冪等：已有值的欄位不重寫。
 *
 * 客戶配對要掃全客戶庫（冷啟動約 60 秒），每小時都重掃會拖垮 Notion 配額。所以：
 *   一般執行只處理「還沒試過配對」的新報名（配對說明為空）；
 *   retryUnmatched（每天第一輪排程、活動頁「立即重新配對」）才重試先前沒配到的——
 *   例如當時是新機構、之後被匯入客戶庫。
 */
export async function processRegistrations(params: {
  onlyIds?: string[]; dryRun?: boolean; retryUnmatched?: boolean; maxCreates?: number
} = {}): Promise<ProcessResult> {
  const only = params.onlyIds ? new Set(params.onlyIds) : null
  const regs = (await listRecentRegistrations(PROCESS_WINDOW_DAYS))
    .filter((r) => r.status !== '取消')
    .filter((r) => !only || only.has(r.id))
  const result: ProcessResult = {
    scanned: regs.length, eventLinked: 0, customerMatched: 0, customerCreated: 0, unmatched: 0, deferred: 0,
    ...(params.dryRun ? { planned: [] } : {}),
  }
  // 人工指定或人工取消配對的（配對說明以「人工」開頭）一律不自動重配，尊重人的判斷
  const needsCustomer = (r: EventRegistration) =>
    !r.customerId && !r.matchNote.startsWith('人工') && (params.retryUnmatched || !r.matchNote)
  const pending = regs.filter((r) => (!r.eventId && r.formEventName) || !r.source || needsCustomer(r))
  if (!pending.length) return result

  const events = pending.some((r) => !r.eventId && r.formEventName) ? await listAllEvents() : []
  const resolve = createCustomerResolver({ dryRun: !!params.dryRun, maxCreates: params.maxCreates })

  for (const reg of pending) {
    const patch: Parameters<typeof updateRegistrationLinks>[1] = {}
    let create: CustomerResolution['create']
    if (!reg.source) patch.source = '報名表單'   // 外掛表單寫入時通常不帶來源
    if (!reg.eventId && reg.formEventName) {
      const ev = matchEvent(reg.formEventName, events)
      if (ev) { patch.eventId = ev.id; result.eventLinked++ }
    }
    if (needsCustomer(reg)) {
      const r = await resolve(reg, reg.id)
      create = r.create
      if (r.outcome === 'matched') result.customerMatched++
      else if (r.outcome === 'created') result.customerCreated++
      else if (r.outcome === 'deferred') result.deferred++
      else result.unmatched++

      if (r.outcome === 'matched' || r.outcome === 'created') {
        if (r.customerId) patch.customerId = r.customerId
        patch.matchNote = r.note
      } else if (r.outcome === 'unmatched' && r.note !== reg.matchNote) {
        patch.matchNote = r.note
      }
      // deferred：不寫配對說明，保持「待處理」讓下一輪接手
    }
    if (!Object.keys(patch).length) continue
    if (params.dryRun) result.planned!.push({ id: reg.id, institution: reg.institution, patch, ...(create ? { create } : {}) })
    else await updateRegistrationLinks(reg.id, patch)
  }

  if (!params.dryRun && (result.customerMatched || result.customerCreated || result.eventLinked)) {
    invalidateEventFootprints()
  }
  return result
}

// ── 4. 足跡訊號 ─────────────────────────────────────────────────

export type EventFootprint = {
  /** 活動日（現場簽到則為實際簽到日），YYYY-MM-DD */
  date: string
  eventName: string
  eventType: string
  status: string          // 已到場／已確認／已報名
  source: string
}

const FOOTPRINTS_CACHE_KEY = 'event-footprints-v1'

/** 人工調整配對後呼叫，讓拜訪建議立即反映 */
export function invalidateEventFootprints() {
  deleteRedisValue(FOOTPRINTS_CACHE_KEY)
  deleteRedisValue('event-customers-v1')   // 首頁「課程／活動客戶」視窗（lib/event-customers）
}

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
        // 只有現場簽到的建立時間＝實際到場時間（多日展會第三天來的就是第三天）。
        // 歷史匯入的建立時間是匯入當天，必須用活動日，否則去年的課程會被當成今天的足跡。
        date: r.source === '展會簽到' && r.registeredAt
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
