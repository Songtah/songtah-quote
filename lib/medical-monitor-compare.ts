/**
 * 醫事比對核心（由 /api/admin/medical-monitor 與業務個人頁共用）
 *
 * 從 data/clinic-snapshot.json 與崧達客戶 DB 進行比對，回傳六種狀態：
 *
 * 狀態 1 — normalOperating   ：客戶有代碼，快照查到，資料一致，正常營業
 * 狀態 2 — newOpenings       ：快照有機構代碼，但公司客戶 DB 無此代碼 → 新開業候選
 * 狀態 3 — suspectedClosures ：客戶有可比對的代碼，但最新醫事資料查無該代碼且快照也無同名同區資料 → 歇業候選
 *                              （不再用 NHI 特約終止判定；開業/歇業以衛福部開業狀態為準，
 *                                由前端「查衛福部」即時確認後人工更新）
 * 狀態 5 — selfManagedCustomers：客戶無機構代碼 → 未納入醫事監控
 * 狀態 6 — inconsistentData  ：代碼相符，但名稱/縣市有差異 → 提供人工確認
 * 狀態 7 — academicInstitutions：學術機構（校名命中名錄／客戶類型=學術機構／4 碼學術代碼）
 *                              → 不在 BAS 體系，永遠不做歇業判定
 * 狀態 8 — invalidCodes      ：機構代碼不是代碼（如「未立案」）→ 代碼待補正，不是歇業
 *
 * 判定順序（先中先出局）：學術機構 → 代碼待補正 → 代碼命中快照 → 同名同區 fallback
 *                        → 換照新碼 → 已人工結案 → 醫院待確認 → 歇業候選
 */

import { getCustomersWithCodes, pushMonitorHistory } from '@/lib/system-notion'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { isInactiveCustomer } from '@/lib/customer-status'
import { classifyInstitutionCode } from '@/lib/institution-code'
import { dismissKeyOf, type MonitorDismissEntry } from '@/lib/notion/monitor-dismiss'
export type { MonitorDismissEntry } from '@/lib/notion/monitor-dismiss'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SnapshotEntry {
  source:    'nhi' | 'bas' | 'mohw'
  kind:      string
  name:      string
  address:   string
  specialty: string
  termDate:  string
  status?:   string   // BAS 開業狀態（開業/停業/歇業…）；snapshot 只收開業者
}

export interface Snapshot {
  month:        string
  fetchedAt:    string
  totalClinics: number
  totalLabs:    number
  totalHospitals?:   number   // 有牙科的醫院總數
  prevTotalClinics?: number   // 上月診所總數（供計算增減；由月排程寫入）
  prevTotalLabs?:    number   // 上月技工所總數
  prevTotalHospitals?: number // 上月有牙科醫院總數
  labsStale?:   boolean       // true = 本次牙技所抓取不完整、沿用上月資料
  newCodes?:    string[]
  codes:        Record<string, SnapshotEntry>
}

export type InstitutionCategory = 'clinic' | 'lab' | 'hospital'

export interface NewOpening {
  code:           string
  name:           string
  kind:           string
  category:       InstitutionCategory
  city:           string
  district:       string
  address:        string
  specialty:      string
  isNewThisMonth: boolean
}

/** 狀態 1：既有正常營業 */
export interface NormalOperating {
  customerId:       string
  customerName:     string
  customerCity:     string
  customerDistrict: string
  customerType:     string
  customerStatus:   string
  institutionCode:  string
  snapshotName:     string
  snapshotKind:     string
  snapshotAddress:  string
  snapshotTermDate: string
}

/** 狀態 3：歇業候選 — 機構代碼已從醫事資料消失，待查衛福部開業狀態確認 */
export interface SuspectedClosure {
  customerId:       string
  customerName:     string
  customerCity:     string
  customerDistrict: string
  customerType:     string
  customerStatus:   string
  institutionCode:  string
  reason:           'code_vanished'
}

/** 更換代碼：客戶持舊碼，同名+縣市+行政區 有不同的現行代碼（換照）→ 建議更新代碼 */
export interface CodeChanged {
  customerId:       string
  customerName:     string
  customerCity:     string
  customerDistrict: string
  customerType:     string
  customerStatus:   string
  oldCode:          string   // 客戶現有（舊）代碼
  newCode:          string   // 醫事資料現行代碼
  snapshotName:     string
  snapshotAddress:  string
}

/** 醫院待確認：醫院類客戶代碼不在 BAS 開業清單。醫院多半仍營業，只是牙科未登記為
 *  「牙醫一般科」而不在 A+51 清單 → 不當歇業候選，改提示逐筆查衛福部確認牙科現況。 */
export interface HospitalUnverified {
  customerId:       string
  customerName:     string
  customerCity:     string
  customerDistrict: string
  customerType:     string
  customerStatus:   string
  institutionCode:  string
}

/**
 * 狀態 9：同縣市有同名機構（2026-09-21 新增）
 * 客戶代碼在 BAS 查不到，但**同一個縣市內**仍有同名且現行的機構（且不只一家，
 * 唯一一家的情形已由「更換代碼」處理）→ 這家很可能只是換照或分院重編，不是歇業。
 * 鐵則：比對範圍限原縣市，**不得跨縣市**——跨縣市同名多半是不同家（菜市場名）。
 */
export interface SameCityCandidate {
  customerId:       string
  customerName:     string
  customerCity:     string
  customerDistrict: string
  customerType:     string
  customerStatus:   string
  institutionCode:  string
  candidates:       { code: string; name: string; address: string }[]
}

/**
 * 狀態 11：疑似復業（2026-09-22 新增）
 *
 * 客戶主檔標成已歇業／停業／撤銷，但機構代碼**仍在衛福部開業名冊上**。
 * 可能是當初誤標、也可能真的復業了。原本全頁統計把這些客戶整批排除，
 * 於是這個方向的錯誤永遠不會被發現——歇業與復業是同一件事的兩個方向，
 * 必須放在同一套對帳流程裡（使用者 2026-09-22 定調）。
 */
export interface SuspectedReopen {
  customerId:       string
  customerName:     string
  customerCity:     string
  customerDistrict: string
  customerType:     string
  customerStatus:   string
  institutionCode:  string
  snapshotName:     string
  snapshotAddress:  string
}

/**
 * 狀態 10：未在衛福部登錄（2026-09-21 新增，取代原本由監控日誌推導的「查無代碼」）
 *
 * 客戶有填機構代碼，但該代碼**從來沒有**在 BAS 出現過（不在目前快照、也不在歷次抓取的代碼快取）。
 * 這類多是未立案機構自編的號碼（技工所為大宗），與「曾經登錄、後來消失」的歇業候選本質不同：
 * 歇業要追、未立案不用追，混在一起會讓歇業清單永遠清不完。
 * 本資料庫以合法立案者為管理主體，故獨立區隔、不納入歇業判定。
 */
export interface UnregisteredInstitution {
  customerId:       string
  customerName:     string
  customerCity:     string
  customerDistrict: string
  customerType:     string
  customerStatus:   string
  institutionCode:  string
}

/** 狀態 4：查無機構代碼（已合併至 已歇業；保留型別供向下相容） */
export interface CodeNotFound {
  customerId:       string
  customerName:     string
  customerCity:     string
  customerDistrict: string
  customerType:     string
  customerStatus:   string
  institutionCode:  string
}

/** 狀態 5：公司自建客戶 — 無機構代碼，未納入醫事監控 */
export interface SelfManagedCustomer {
  customerId:       string
  customerName:     string
  customerCity:     string
  customerDistrict: string
  customerType:     string
  customerStatus:   string
}

/** 狀態 6：資料不一致 — 代碼相符但名稱/縣市有落差，提供人工確認 */
export interface InconsistentData {
  customerId:       string
  customerName:     string
  customerCity:     string
  customerDistrict: string
  customerType:     string
  customerStatus:   string
  institutionCode:  string
  snapshotName:     string
  snapshotKind:     string
  snapshotAddress:  string
  snapshotTermDate: string
  diffs: Array<{ field: string; customerValue: string; snapshotValue: string }>
}

export interface MonitorStats {
  totalClinics:   number
  totalLabs:      number
  totalHospitals: number
  clinicDelta:    number | null   // 較上月增減（null = 無上月資料）
  labDelta:       number | null
  labsStale:      boolean          // true = 牙技所為上月沿用資料（本次未完整抓取）
  customerWithCode:    number
  customerNoCode:      number
  /**
   * 已往來客戶數（2026-09-22 改為實證判斷）：標記「公司既有客戶」∪ 有客情紀錄。
   * 舊定義是「營業中且開發階段不是線索/已接觸/流失」——但開發階段 96% 空白，
   * 等於把全部 BAS 匯入的名單都算成往來客戶（9,867），完全不能用。
   */
  customerEngaged:     number
  engagedMarked:       number   // 其中：標記公司既有客戶
  engagedVisited:      number   // 其中：有客情紀錄
  engagedBoth:         number   // 兩者皆有
  engagedNoContact:    number   // 兩者皆無（純名單，未曾往來）
  normalOperating:     number
  newOpeningClinics:   number
  newOpeningLabs:      number
  newOpeningHospitals: number
  newThisMonthClinics:   number
  newThisMonthLabs:      number
  newThisMonthHospitals: number
  newOpeningExcludedExisting: number   // 名稱＋地區已是現有客戶而被排除的「新開業」數
  suspectedClosures:   number
  sameCityCandidates:  number
  unregistered:        number   // 代碼從未在 BAS 出現過（未立案），不納入歇業判定
  suspectedReopens:    number   // 主檔標歇業、但代碼仍在 BAS 開業名冊
  dismissed:           number   // 人工排除、不再列出的筆數
  inactiveExcluded:    number   // 已歇業／停業／撤銷而未納入任何統計的客戶數
  codeNotFound:        number
  inconsistentData:    number
  codeChanged:         number
  hospitalUnverified:  number
  academicInstitutions: number
  invalidCodes:        number
}

/** 學術機構：不在 BAS 體系，列出供確認歸類是否正確，不做歇業判定 */
export interface AcademicInstitution {
  customerId: string; customerName: string
  customerCity: string; customerDistrict: string
  customerType: string; customerStatus: string
  institutionCode: string
  matchedBy: 'schoolDirectory' | 'customerType' | 'academicCode'
}

/** 代碼待補正：機構代碼欄填的不是代碼，無法比對 */
export interface InvalidCode {
  customerId: string; customerName: string
  customerCity: string; customerDistrict: string
  customerType: string; customerStatus: string
  institutionCode: string
  /** BAS 同名同區查到的代碼，可直接補上（沒查到就是空字串） */
  suggestedCode: string
  suggestedName: string
  suggestedAddress: string
}

export interface MonitorResult {
  hasSnapshot:    boolean
  stats:          MonitorStats
  newOpenings: {
    clinics:   NewOpening[]
    labs:      NewOpening[]
    hospitals: NewOpening[]
  }
  suspectedClosures:     SuspectedClosure[]
  sameCityCandidates:    SameCityCandidate[]
  unregistered:          UnregisteredInstitution[]
  suspectedReopens:      SuspectedReopen[]
  /** 人工排除清單（可復原）；排除只影響顯示與統計，不改客戶主檔 */
  dismissed:             MonitorDismissEntry[]
  codeNotFound:          CodeNotFound[]
  selfManagedCustomers:  SelfManagedCustomer[]
  inconsistentData:      InconsistentData[]
  codeChanged:           CodeChanged[]
  hospitalUnverified:    HospitalUnverified[]
  academicInstitutions:  AcademicInstitution[]
  invalidCodes:          InvalidCode[]
  snapshotMonth:   string
  snapshotFetched: string
  computedAt:      string   // 本結果計算時間（ISO）；供「上次比對」顯示，伺服器端共用
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** 讀人工排除清單；Redis 不可用時回空陣列（寧可多顯示，也不要讓比對整個失敗） */
async function listDismissedSafe(): Promise<MonitorDismissEntry[]> {
  try {
    const { listDismissed } = await import('@/lib/notion/monitor-dismiss')
    return await listDismissed()
  } catch {
    return []
  }
}

const CLINIC_KINDS     = new Set(['牙醫一般診所', '牙醫診所', '牙醫專科診所', '衛生所'])
const LAB_KINDS        = new Set(['牙體技術所', '鑲牙所'])
// 「已往來客戶數」判斷：排除歇業/停業/撤銷的機構，以及還沒真正互動過的純線索
const LEAD_ONLY_STAGE   = new Set(['線索', '已接觸', '流失'])

function getCategory(kind: string): InstitutionCategory {
  if (LAB_KINDS.has(kind))    return 'lab'
  if (CLINIC_KINDS.has(kind)) return 'clinic'
  return 'hospital'
}

function parseAddress(address: string): { city: string; district: string } {
  const cityMatch = address.match(/^(.*?[市縣])/)
  const city      = cityMatch ? cityMatch[1] : ''
  const distMatch = address.replace(city, '').match(/^(.*?[區鄉鎮市])/)
  const district  = distMatch ? distMatch[1] : ''
  return { city, district }
}

// 常見異體字摺疊（同字異寫視為相同，避免名稱誤判不一致）
// 例：峯=峰、臺=台、羣=群、裏=裡、卽=即、爲=為、衞=衛、刼=劫
const VARIANT_MAP: Record<string, string> = {
  '峯': '峰', '臺': '台', '羣': '群', '裏': '裡', '卽': '即',
  '爲': '為', '衞': '衛', '甯': '寧', '喆': '哲', '昇': '升',
  '陞': '升', '勛': '勳', '麪': '麵', '凴': '憑', '銹': '鏽',
}
function foldVariants(s: string): string {
  return s.replace(/[峯臺羣裏卽爲衞甯喆昇陞勛麪凴銹]/g, (ch) => VARIANT_MAP[ch] ?? ch)
}

/** 臺/台 互換正規化 */
const tw = (s: string) => (s ?? '').replace(/臺/g, '台')

/** 特約終止/歇業日（YYYYMMDD）是否已過 → 該筆為舊（已終止）紀錄 */
function isExpired(termDate?: string): boolean {
  if (!termDate || termDate === '0' || termDate.length < 8) return false
  const y = +termDate.slice(0, 4), m = +termDate.slice(4, 6) - 1, d = +termDate.slice(6, 8)
  if (isNaN(y) || isNaN(m) || isNaN(d)) return false
  return new Date(y, m, d) < new Date()
}

/** 地區比對 key：名稱(正規化/摺疊異體字) + 縣市 + 行政區 */
function areaKeyOf(name: string, city: string, district: string): string {
  return `${normalizeName(name)}|${tw(city)}|${tw(district)}`
}

/** 學校名稱 key：取校名（－/科系 之前），摺疊異體字、去空白 → 比對教育部名錄用 */
function schoolNameKey(name: string): string {
  return foldVariants(name).split(/[－—\-]/)[0].replace(/[（）()\s]/g, '').trim()
}

/** 完整機構名稱 key：保留「牙醫診所／牙體技術所」等詞，避免不同機構被過度合併 */
function institutionNameKey(name: string): string {
  return foldVariants(name)
    .replace(/[（）()\s\-_]/g, '')
    .trim()
}

/** 名稱正規化（摺疊異體字 + 移除通用詞，方便比對） */
function normalizeName(name: string): string {
  return foldVariants(name)
    .replace(/牙醫|牙科|診所|醫院|專科|一般|牙體技術所|牙體|技術所|技工所|聯合|聯診|口腔|植牙|美齒|牙齒/g, '')
    .replace(/[（）()\s\-_]/g, '')
    .trim()
}

/**
 * 比較客戶 DB 資料與快照資料，找出有意義的落差。
 * 目前比對：名稱（正規化後無重疊）、縣市（臺/台 互換後不符）。
 */
function detectDiffs(
  customer: { name: string; city: string; district: string },
  entry: SnapshotEntry
): Array<{ field: string; customerValue: string; snapshotValue: string }> {
  const diffs: Array<{ field: string; customerValue: string; snapshotValue: string }> = []

  // 名稱：正規化後兩者完全無包含關係才算不一致（形態 3）
  const normC = normalizeName(customer.name)
  const normS = normalizeName(entry.name)
  if (normC.length >= 2 && normS.length >= 2) {
    const noOverlap = normC !== normS && !normC.includes(normS) && !normS.includes(normC)
    if (noOverlap) {
      diffs.push({ field: '名稱', customerValue: customer.name, snapshotValue: entry.name })
    }
  }

  // 地址：臺/台 互換後比對（形態 4）
  const tw = (s: string) => s.replace(/臺/g, '台')
  const custCity = tw(customer.city)
  const custDist = tw(customer.district ?? '')
  const snapAddr = tw(entry.address)
  const cityMatches = custCity && snapAddr.includes(custCity)
  if (custCity && snapAddr && !cityMatches) {
    // 縣市不符
    diffs.push({ field: '縣市', customerValue: customer.city, snapshotValue: snapAddr.slice(0, 6) })
  } else if (cityMatches && custDist && !snapAddr.includes(custDist)) {
    // 縣市相符但行政區不符（同代碼遷址或地址有誤）
    diffs.push({
      field: '地址（行政區）',
      customerValue: `${customer.city}${customer.district}`,
      snapshotValue: snapAddr.slice(0, 12),
    })
  }

  return diffs
}

// ── Handler ────────────────────────────────────────────────────────────────────


export async function computeMonitor(): Promise<MonitorResult> {
  // 1. 讀快照
  const snapshotPath = path.join(process.cwd(), 'data', 'clinic-snapshot.json')
  let snapshot: Snapshot | null = null
  if (existsSync(snapshotPath)) {
    try { snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot }
    catch { snapshot = null }
  }

  if (!snapshot) {
    return {
      hasSnapshot: false,
      stats: null as any,
      newOpenings: { clinics: [], labs: [], hospitals: [] },
      suspectedClosures: [], sameCityCandidates: [], unregistered: [], suspectedReopens: [], dismissed: [], codeNotFound: [], academicInstitutions: [], invalidCodes: [],
      selfManagedCustomers: [], inconsistentData: [], codeChanged: [], hospitalUnverified: [],
      snapshotMonth: '', snapshotFetched: '', computedAt: new Date().toISOString(),
    }
  }

  const codes           = snapshot.codes ?? {}
  const newThisMonthSet = new Set(snapshot.newCodes ?? [])

  // 1b. 載入學校靜態參照（教育部名錄）：學校客戶機構代碼＝4 碼學校代碼
  type SchoolRef = { name: string; city: string; address: string; kind: string }
  // 註：崧達客戶的學校代碼與「統計處名錄」代碼非同系統，故以「校名」比對，不靠代碼
  const schoolByName = new Map<string, SchoolRef>()   // 校名 key → 名錄資料
  let totalSchools = 0                                  // 全台學校數（教育部名錄）
  try {
    const sp = path.join(process.cwd(), 'data', 'schools.json')
    if (existsSync(sp)) {
      const s = JSON.parse(readFileSync(sp, 'utf8')) as { schools?: Record<string, SchoolRef> }
      totalSchools = Object.keys(s.schools ?? {}).length
      for (const v of Object.values(s.schools ?? {})) {
        const nk = schoolNameKey(v.name)
        if (nk && !schoolByName.has(nk)) schoolByName.set(nk, v)
      }
    }
  } catch { /* 無學校參照不影響其他比對 */ }

  // 1c. 歷次 BAS 代碼快取：用來分辨「曾登錄後消失（歇業候選）」與「從未登錄（未立案）」
  const everKnownCodes = new Set<string>()
  try {
    const cp = path.join(process.cwd(), 'data', 'bas-cache.json')
    if (existsSync(cp)) {
      const cacheJson = JSON.parse(readFileSync(cp, 'utf8')) as Record<string, { code?: string }>
      for (const v of Object.values(cacheJson)) if (v?.code) everKnownCodes.add(v.code)
    }
  } catch { /* 沒有快取就退回原行為：一律當歇業候選 */ }

  // 2. 載入崧達客戶（全部，含無代碼）
  const allCustomersRaw = await getCustomersWithCodes()

  /**
   * 本頁所有統計一律排除「已歇業／停業／撤銷」的客戶（使用者 2026-09-21 定調）——
   * 這些是已結案的機構，留在分母裡會讓覆蓋率、客戶數、各類候選數全部失真。
   * 但「已是現有客戶」的去重判斷仍用完整名單（allCustomersRaw），
   * 否則歇業客戶的地址會被當成全新機構、重複列入待開發並可能被重新匯入。
   */
  const allCustomers = allCustomersRaw.filter((c) => !isInactiveCustomer(c.status))
  const inactiveExcluded = allCustomersRaw.length - allCustomers.length

  const customerByCode:   Map<string, typeof allCustomers[0]> = new Map()
  const customersWithCode: typeof allCustomers = []
  const customersNoCode:   typeof allCustomers = []

  for (const c of allCustomers) {
    const code = c.institutionCode.trim()
    if (!code) customersNoCode.push(c)
    else { customersWithCode.push(c); customerByCode.set(code, c) }
  }

  // 3. 快照查找表（只含有效 10 位代碼）
  // NHI 診所代碼：10 位純數字；BAS 牙技所代碼：英數混合（如 2Y07110045）
  // fallback key 含雙底線，排除
  const isValidCode = (code: string) => /^[A-Za-z0-9]{5,20}$/.test(code) && !code.includes('__')
  const snapshotByCode = new Map<string, SnapshotEntry & { code: string }>()
  for (const [code, entry] of Object.entries(codes)) {
    if (isValidCode(code)) snapshotByCode.set(code, { ...entry, code })
  }

  // 地區索引：areaKey（名稱|縣市|行政區）→ [{code, entry, expired}]（換照找新碼用）
  // 另建縣市索引：cityKey（名稱|縣市）→ [...]，供「同名同縣市跨行政區」的換照偵測
  const areaIndex = new Map<string, { code: string; entry: SnapshotEntry; expired: boolean }[]>()
  const cityIndex = new Map<string, { code: string; entry: SnapshotEntry; expired: boolean }[]>()
  for (const [code, entry] of Array.from(snapshotByCode)) {
    const { city, district } = parseAddress(entry.address)
    const rec = { code, entry, expired: isExpired(entry.termDate) }
    const ak = areaKeyOf(entry.name, city, district)
    ;(areaIndex.get(ak) ?? areaIndex.set(ak, []).get(ak)!).push(rec)
    const ck = `${normalizeName(entry.name)}|${tw(city)}`
    ;(cityIndex.get(ck) ?? cityIndex.set(ck, []).get(ck)!).push(rec)
  }

  // BAS 牙技所偶爾會抓到列表資料、但詳細頁取不到機構代碼；此時快照會用
  // 「名稱__縣市__區」保留資料。若客戶同名同區仍在 BAS 列表中，不應列為歇業候選。
  const fallbackByArea = new Map<string, SnapshotEntry>()
  for (const [key, entry] of Object.entries(codes)) {
    if (isValidCode(key)) continue
    const { city, district } = parseAddress(entry.address)
    const areaKey = areaKeyOf(entry.name, city, district)
    fallbackByArea.set(areaKey, entry)
  }

  /**
   * 同縣市同名且現行的機構（不含自己）。**查詢範圍限原縣市，不得跨縣市**——
   * 使用者 2026-09-21 定調：跨縣市同名多為不同家，比對到只會造成誤判。
   */
  const sameCityOpen = (name: string, city: string, excludeCode: string) =>
    (cityIndex.get(`${normalizeName(name)}|${tw(city)}`) ?? [])
      .filter((x) => x.code !== excludeCode && !x.expired)

  // 換照找新碼：先比「同名＋縣市＋行政區」；找不到再放寬到「同名＋同縣市」（跨行政區遷址），
  // 但同縣市需「唯一」一個現行同名碼才採信，避免菜市場名誤判。跨縣市不放寬（多為不同家）。
  const findReplacement = (name: string, city: string, district: string, excludeCode: string) => {
    const sameArea = (areaIndex.get(areaKeyOf(name, city, district)) ?? [])
      .find((x) => x.code !== excludeCode && !x.expired)
    if (sameArea) return sameArea
    const ck = `${normalizeName(name)}|${tw(city)}`
    const cands = (cityIndex.get(ck) ?? []).filter((x) => x.code !== excludeCode && !x.expired)
    return cands.length === 1 ? cands[0] : null
  }

  // ── 逐一處理有代碼的客戶 ───────────────────────────────────────────────
  const normalOperating:   NormalOperating[]   = []
  const suspectedClosures: SuspectedClosure[]  = []
  const sameCityCandidates: SameCityCandidate[] = []
  const unregistered: UnregisteredInstitution[] = []
  const codeNotFound:      CodeNotFound[]      = []
  const inconsistentData:  InconsistentData[]  = []
  const codeChanged:       CodeChanged[]       = []
  const hospitalUnverified: HospitalUnverified[] = []
  const academicInstitutions: AcademicInstitution[] = []
  const invalidCodes:      InvalidCode[]       = []
  // 醫院豁免以「客戶類型」為準；名稱只在類型空白時當備援。
  // 原本無條件 /醫院/.test(name) 會讓任何名字帶「醫院」的客戶都跳過歇業判定
  // （目前資料剛好 0 筆，但這是等著發生的誤放）。
  const isHospital = (c: { type: string; name: string }) =>
    c.type === '醫院' || (!c.type && /醫院/.test(c.name))

  for (const c of customersWithCode) {
    const code  = c.institutionCode.trim()
    const codeKind = classifyInstitutionCode(code)

    // ① 學術機構：不在 BAS 體系，永遠不做歇業判定。
    //    三種認定任一成立即可——校名命中教育部名錄／客戶類型=學術機構／4 碼學術代碼。
    //    原本只靠名錄比對，「國防醫學大學－牙醫學系」不在名錄就被誤判成歇業。
    const namedSchool = schoolByName.get(schoolNameKey(c.name))
    const academicBy: AcademicInstitution['matchedBy'] | null =
      namedSchool ? 'schoolDirectory'
      : c.type === '學術機構' ? 'customerType'
      : codeKind === 'academic' ? 'academicCode'
      : null
    if (academicBy) {
      academicInstitutions.push({
        customerId: c.id, customerName: c.name,
        customerCity: c.city, customerDistrict: c.district,
        customerType: c.type, customerStatus: c.status,
        institutionCode: code, matchedBy: academicBy,
      })
      continue
    }

    // ② 代碼待補正：欄位填的不是代碼（如「未立案」），比對不可能成立，不是歇業。
    //    順便用同名同區找出 BAS 的正確代碼給人工補（這筆資訊原本掛在「更換代碼」，
    //    語意不對但確實有用，搬過來時不能弄丟）。
    if (codeKind === 'invalid') {
      const guess = findReplacement(c.name, c.city, c.district, code)
      invalidCodes.push({
        customerId: c.id, customerName: c.name,
        customerCity: c.city, customerDistrict: c.district,
        customerType: c.type, customerStatus: c.status,
        institutionCode: code,
        suggestedCode: guess?.code ?? '',
        suggestedName: guess?.entry.name ?? '',
        suggestedAddress: guess?.entry.address ?? '',
      })
      continue
    }

    const entry = snapshotByCode.get(code)
    const currentValid = entry && !isExpired(entry.termDate)

    if (currentValid) {
      const diffs = detectDiffs(c, entry!)
      if (diffs.length > 0) {
        // 資料不一致（代碼相符但名稱/地址有落差）
        inconsistentData.push({
          customerId: c.id, customerName: c.name,
          customerCity: c.city, customerDistrict: c.district,
          customerType: c.type, customerStatus: c.status,
          institutionCode: code, diffs,
          snapshotName: entry!.name, snapshotKind: entry!.kind,
          snapshotAddress: entry!.address, snapshotTermDate: entry!.termDate,
        })
      } else {
        // 既有正常營業
        normalOperating.push({
          customerId: c.id, customerName: c.name,
          customerCity: c.city, customerDistrict: c.district,
          customerType: c.type, customerStatus: c.status,
          institutionCode: code,
          snapshotName: entry!.name, snapshotKind: entry!.kind,
          snapshotAddress: entry!.address, snapshotTermDate: entry!.termDate,
        })
      }
      continue
    }

    const fallbackEntry = fallbackByArea.get(areaKeyOf(c.name, c.city, c.district))
    if (fallbackEntry && !isExpired(fallbackEntry.termDate)) {
      const diffs = detectDiffs(c, fallbackEntry)
      if (diffs.length > 0) {
        inconsistentData.push({
          customerId: c.id, customerName: c.name,
          customerCity: c.city, customerDistrict: c.district,
          customerType: c.type, customerStatus: c.status,
          institutionCode: code, diffs,
          snapshotName: fallbackEntry.name, snapshotKind: fallbackEntry.kind,
          snapshotAddress: fallbackEntry.address, snapshotTermDate: fallbackEntry.termDate,
        })
      } else {
        normalOperating.push({
          customerId: c.id, customerName: c.name,
          customerCity: c.city, customerDistrict: c.district,
          customerType: c.type, customerStatus: c.status,
          institutionCode: code,
          snapshotName: fallbackEntry.name, snapshotKind: fallbackEntry.kind,
          snapshotAddress: fallbackEntry.address, snapshotTermDate: fallbackEntry.termDate,
        })
      }
      continue
    }

    // 客戶碼查不到 或 已終止 → 先找換照新碼（同名+縣市+行政區、不同且現行）
    const repl = findReplacement(c.name, c.city, c.district, code)
    if (repl) {
      // 更換代碼（換照）：建議更新為新碼，非歇業
      codeChanged.push({
        customerId: c.id, customerName: c.name,
        customerCity: c.city, customerDistrict: c.district,
        customerType: c.type, customerStatus: c.status,
        oldCode: code, newCode: repl.code,
        snapshotName: repl.entry.name, snapshotAddress: repl.entry.address,
      })
    } else if (/停業|歇業|撤銷/.test(c.status)) {
      // 已人工確認結案（機構狀態已標停業/已歇業/撤銷）→ 不再列為候選
      continue
    } else if (isHospital(c)) {
      // 醫院待確認：醫院多半仍營業，只是牙科未登記為「牙醫一般科」而不在 BAS A+51 清單，
      // 故不列歇業候選，改提示逐筆查衛福部確認牙科現況。
      hospitalUnverified.push({
        customerId: c.id, customerName: c.name,
        customerCity: c.city, customerDistrict: c.district,
        customerType: c.type, customerStatus: c.status,
        institutionCode: code,
      })
    } else if (everKnownCodes.size > 0 && !everKnownCodes.has(code) && !snapshotByCode.has(code)) {
      // 代碼從未在 BAS 出現過 → 未立案，不是歇業（歇業是「曾經登錄後消失」）
      unregistered.push({
        customerId: c.id, customerName: c.name,
        customerCity: c.city, customerDistrict: c.district,
        customerType: c.type, customerStatus: c.status,
        institutionCode: code,
      })
    } else if (sameCityOpen(c.name, c.city, code).length > 0) {
      // 同縣市有同名且現行的機構（不只一家，唯一者已走「更換代碼」）→ 很可能是換照／分院重編，
      // 不列歇業候選，交人工從候選碼中挑。**只查原縣市，不跨縣市**（跨縣市同名多為不同家）。
      sameCityCandidates.push({
        customerId: c.id, customerName: c.name,
        customerCity: c.city, customerDistrict: c.district,
        customerType: c.type, customerStatus: c.status,
        institutionCode: code,
        candidates: sameCityOpen(c.name, c.city, code)
          .slice(0, 5)
          .map((x) => ({ code: x.code, name: x.entry.name, address: x.entry.address })),
      })
    } else {
      // 歇業候選（代碼消失、同地區無替代碼、同縣市也查無同名）
      suspectedClosures.push({
        customerId: c.id, customerName: c.name,
        customerCity: c.city, customerDistrict: c.district,
        customerType: c.type, customerStatus: c.status,
        institutionCode: code, reason: 'code_vanished',
      })
    }
  }

  // ── 狀態 5：公司自建客戶（無機構代碼）────────────────────────────────────
  const selfManagedCustomers: SelfManagedCustomer[] = customersNoCode.map(c => ({
    customerId: c.id, customerName: c.name,
    customerCity: c.city, customerDistrict: c.district,
    customerType: c.type, customerStatus: c.status,
  }))

  // ── 狀態 2：待開發機構（BAS 有、崧達客戶 DB 無）─────────────────────────
  // 列出「BAS 開業清單中、但還不是崧達客戶」的全部機構＝客戶 DB 與 BAS 的差異/開發機會。
  // 每筆標 isNewThisMonth（本月相較上月 BAS 快照新出現者），前端可切「全部／本月新增／既有未開發」。
  // 排除「代碼已是客戶」與「名稱＋縣市＋行政區已是現有客戶」者（避免 CRM 代碼未同步/換照/同名同區誤列）。
  const customerAreaSet = new Set(
    allCustomersRaw.filter((c) => c.name).map((c) => areaKeyOf(c.name, c.city, c.district))
  )
  const customerNameCitySet = new Set(
    allCustomersRaw
      .filter((c) => c.name && c.city)
      .map((c) => `${institutionNameKey(c.name)}|${tw(c.city)}`)
  )
  const customerLooseNameSet = new Set(
    allCustomersRaw
      .filter((c) => c.name && (!c.city || !c.district))
      .map((c) => institutionNameKey(c.name))
  )

  const newOpenings: NewOpening[] = []
  let excludedExisting = 0
  const allCustomerCodes = new Set(allCustomersRaw.map((c) => c.institutionCode.trim()).filter(Boolean))
  for (const [code, entry] of Array.from(snapshotByCode)) {
    if (isExpired(entry.termDate)) continue
    if (allCustomerCodes.has(code)) continue   // 含已歇業客戶：代碼已在庫，不是待開發
    const { city, district } = parseAddress(entry.address)
    const nameKey = institutionNameKey(entry.name)
    // 已是現有客戶 → 不列入新開業；補強 city/name 與資料缺漏情境，避免 CRM 代碼未同步時漏排。
    const alreadyCustomer =
      customerAreaSet.has(areaKeyOf(entry.name, city, district)) ||
      (city && customerNameCitySet.has(`${nameKey}|${tw(city)}`)) ||
      customerLooseNameSet.has(nameKey)
    if (alreadyCustomer) {
      excludedExisting++
      continue
    }
    newOpenings.push({
      code, name: entry.name, kind: entry.kind,
      category:  getCategory(entry.kind),
      city, district, address: entry.address, specialty: entry.specialty,
      isNewThisMonth: newThisMonthSet.has(code),
    })
  }

  // ── 已往來客戶：要有實證，不能靠「開發階段沒填」反推 ─────────────────────
  // 兩種實證任一成立即算：①主檔開發狀態標「公司既有客戶」 ②客情紀錄裡出現過。
  // 客情紀錄集合由夜間排程算好放快取（全掃拜訪庫，不能在請求路徑做）；
  // 拿不到快取時退回只用①，並在 stats 標明。
  const markedExisting = new Set(
    allCustomers.filter((c) => (c.devStatus ?? []).includes('公司既有客戶')).map((c) => c.id.replace(/-/g, ''))
  )
  let visitedSet = new Set<string>()
  try {
    const { loadMatchContext } = await import('@/lib/notion/match-context')
    const ctx = await loadMatchContext()
    const activeIds = new Set(allCustomers.map((c) => c.id.replace(/-/g, '')))
    visitedSet = new Set(Array.from(ctx.visitedCustomers).filter((id) => activeIds.has(id)))
  } catch { /* 沒快取就只用標記 */ }
  const engaged = new Set<string>([...Array.from(markedExisting), ...Array.from(visitedSet)])

  // ── 疑似復業：主檔標歇業／停業／撤銷，但代碼仍在開業名冊上 ────────────────
  // 這批客戶被全頁統計排除，若不另外掃一次，誤標或真復業永遠不會浮現。
  const suspectedReopens: SuspectedReopen[] = []
  for (const c of allCustomersRaw) {
    if (!isInactiveCustomer(c.status)) continue
    const code = c.institutionCode.trim()
    if (!code || !isValidCode(code)) continue
    const entry = snapshotByCode.get(code)
    if (!entry || isExpired(entry.termDate)) continue
    suspectedReopens.push({
      customerId: c.id, customerName: c.name,
      customerCity: c.city, customerDistrict: c.district,
      customerType: c.type, customerStatus: c.status,
      institutionCode: code,
      snapshotName: entry.name, snapshotAddress: entry.address,
    })
  }

  // ── 套用人工排除（略過）──────────────────────────────────────────────────
  // 排除鍵含當下代碼，代碼一變就自動失效、該筆會重新出現（見 lib/notion/monitor-dismiss）。
  const dismissedList = await listDismissedSafe()
  const dismissedKeys = new Set(dismissedList.map((d) => d.key))
  const keep = <T extends { customerId: string }>(
    category: Parameters<typeof dismissKeyOf>[0], list: T[], codeOf: (x: T) => string,
  ) => list.filter((x) => !dismissedKeys.has(dismissKeyOf(category, x.customerId, codeOf(x))))

  const suspectedClosuresKept = keep('closure', suspectedClosures, (x) => x.institutionCode)
  const codeChangedKept       = keep('codechange', codeChanged, (x) => x.oldCode)
  const hospitalKept          = keep('hospital', hospitalUnverified, (x) => x.institutionCode)
  const inconsistentKept      = keep('inconsistent', inconsistentData, (x) => x.institutionCode)
  const invalidKept           = keep('invalidcode', invalidCodes, (x) => x.institutionCode)
  const sameCityKept          = keep('samecity', sameCityCandidates, (x) => x.institutionCode)
  const unregisteredKept      = keep('unregistered', unregistered, (x) => x.institutionCode)
  const reopensKept           = keep('reopen', suspectedReopens, (x) => x.institutionCode)
  const dismissedActive = dismissedList.length

  // ── 分類統計 ───────────────────────────────────────────────────────────────
  const newClinic   = newOpenings.filter(n => n.category === 'clinic')
  const newLab      = newOpenings.filter(n => n.category === 'lab')
  const newHospital = newOpenings.filter(n => n.category === 'hospital')

  const stats: MonitorStats = {
    totalClinics:   snapshot.totalClinics,
    totalLabs:      snapshot.totalLabs,
    totalHospitals: snapshot.totalHospitals ?? 0,
    // 差額只在「有有效上月基準」時計算。prev 為 0／undefined 代表上月根本沒抓到該類別
    // （非真的歸零），此時顯示差額會把「全台總數」誤當成本月暴增（曾出現牙技所 ▲1093）。
    clinicDelta: snapshot.prevTotalClinics ? snapshot.totalClinics - snapshot.prevTotalClinics : null,
    labDelta:    snapshot.prevTotalLabs    ? snapshot.totalLabs    - snapshot.prevTotalLabs    : null,
    labsStale:   snapshot.labsStale === true,
    customerWithCode:    customersWithCode.length,
    customerNoCode:      customersNoCode.length,
    customerEngaged:     engaged.size,
    engagedMarked:       markedExisting.size,
    engagedVisited:      visitedSet.size,
    engagedBoth:         Array.from(markedExisting).filter((id) => visitedSet.has(id)).length,
    engagedNoContact:    allCustomers.length - engaged.size,
    normalOperating:     normalOperating.length,
    newOpeningClinics:   newClinic.length,
    newOpeningLabs:      newLab.length,
    newOpeningHospitals: newHospital.length,
    newThisMonthClinics:   newClinic.filter(n => n.isNewThisMonth).length,
    newThisMonthLabs:      newLab.filter(n => n.isNewThisMonth).length,
    newThisMonthHospitals: newHospital.filter(n => n.isNewThisMonth).length,
    newOpeningExcludedExisting: excludedExisting,
    suspectedClosures:   suspectedClosuresKept.length,
    sameCityCandidates:  sameCityKept.length,
    unregistered:        unregisteredKept.length,
    suspectedReopens:    reopensKept.length,
    dismissed:           dismissedActive,
    inactiveExcluded,
    academicInstitutions: academicInstitutions.length,
    invalidCodes:        invalidKept.length,
    codeNotFound:        0,
    inconsistentData:    inconsistentKept.length,
    codeChanged:         codeChangedKept.length,
    hospitalUnverified:  hospitalKept.length,
  }

  const result: MonitorResult = {
    hasSnapshot: true,
    stats,
    newOpenings: {
      clinics:   newClinic.slice(0, 500),
      labs:      newLab.slice(0, 200),
      hospitals: newHospital.slice(0, 100),
    },
    suspectedClosures:    suspectedClosuresKept,
    sameCityCandidates:   sameCityKept,
    unregistered:         unregisteredKept,
    suspectedReopens:     reopensKept,
    dismissed:            dismissedList,
    academicInstitutions,
    invalidCodes:         invalidKept,
    codeNotFound:         [],
    selfManagedCustomers: selfManagedCustomers.slice(0, 2000),
    inconsistentData:     inconsistentKept,
    codeChanged:          codeChangedKept,
    hospitalUnverified:   hospitalKept,
    snapshotMonth:   snapshot.month,
    snapshotFetched: snapshot.fetchedAt,
    computedAt:      new Date().toISOString(),
  }

  // 崧達客戶各類型數量（供儀表板「客戶」線）
  //
  // 兩個口徑要分開記，混用會出現「客戶數 > 全台總數」這種不可能的畫面（實測診所 7,281 > 全台 7,149）：
  //   cust*      ＝ 客戶主檔中該類型的**全部**客戶（含已歇業、無代碼、未立案）
  //   cust*InBas ＝ 其中**代碼命中 BAS 開業清單**者，才與「全台（BAS 開業數）」同口徑
  let custClinics = 0, custLabs = 0, custHospitals = 0, custSchools = 0
  for (const c of allCustomers) {
    const t = c.type || ''
    if (t === '牙醫診所' || t === '衛生所')        custClinics++
    else if (t === '牙體技術所' || t === '鑲牙所') custLabs++
    else if (t === '醫院')                         custHospitals++
    else if (t === '學術機構')                     custSchools++
  }
  // 分類一律用「命中的 BAS 機構類別」，不用客戶主檔的客戶類型——
  // 用客戶類型會和「全台」的分母對不起來（實測技工所 1,136 > 全台 1,103、醫院 193 > 188，
  // 因為主檔把鑲牙所、醫院附設牙科等歸類方式與 BAS 不同）。
  // 分桶規則必須與快照宣告的三個總數**逐字對齊**，否則分母對不起來：
  //   totalClinics 7,149 ＝ 牙醫診所 7,127 ＋ 衛生所 22
  //   totalLabs    1,103 ＝ 牙體技術所（**不含**鑲牙所 26）
  //   totalHospitals 188 ＝ 醫院
  // 所以這裡用命中的 BAS kind 嚴格比對，鑲牙所與未知 kind 一律不計入三桶
  //（用客戶主檔的「客戶類型」分桶會讓技工所 1,136 > 全台 1,103、醫院 192 > 188）。
  // 以**機構代碼去重**：客戶主檔存在多筆共用同一代碼的重複客戶（實測技工所 7 組、醫院 4 組），
  // 逐筆計數會讓客戶數超過全台總數。
  const inBasCodes = { clinic: new Set<string>(), lab: new Set<string>(), hospital: new Set<string>() }
  let duplicateCodeCustomers = 0
  for (const c of [...normalOperating, ...inconsistentData]) {
    const kind = c.snapshotKind || ''
    const bucket = kind === '牙體技術所' ? inBasCodes.lab
      : (kind === '牙醫診所' || kind === '衛生所' || kind === '診所') ? inBasCodes.clinic
        : kind === '醫院' ? inBasCodes.hospital : null
    if (!bucket) continue
    if (bucket.has(c.institutionCode)) duplicateCodeCustomers++
    bucket.add(c.institutionCode)
  }
  const custClinicsInBas = inBasCodes.clinic.size
  const custLabsInBas = inBasCodes.lab.size
  const custHospitalsInBas = inBasCodes.hospital.size

  // 記一筆每月比對紀錄（依快照月份去重、伺服器端持久），供趨勢對照
  await pushMonitorHistory({
    month: snapshot.month, computedAt: result.computedAt,
    totalClinics: stats.totalClinics, totalLabs: stats.totalLabs, totalHospitals: stats.totalHospitals, totalSchools,
    custClinics, custLabs, custHospitals, custSchools,
    custClinicsInBas, custLabsInBas, custHospitalsInBas,
    customerWithCode: stats.customerWithCode,
    inBasOpen: stats.normalOperating,
    toDevelop: newClinic.length + newLab.length + newHospital.length,
    suspectedClosures: stats.suspectedClosures,
    hospitalUnverified: stats.hospitalUnverified,
    codeChanged: stats.codeChanged,
    inconsistentData: stats.inconsistentData,
  }).catch(() => {})

  return result
}
