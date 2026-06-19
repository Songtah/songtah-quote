/**
 * GET /api/admin/medical-monitor
 *
 * 從 data/clinic-snapshot.json 與崧達客戶 DB 進行比對，回傳六種狀態：
 *
 * 狀態 1 — normalOperating   ：客戶有代碼，快照查到，資料一致，正常營業
 * 狀態 2 — newOpenings       ：快照有機構代碼，但公司客戶 DB 無此代碼 → 新開業候選
 * 狀態 3 — suspectedClosures ：客戶有代碼，但最新醫事資料查無該代碼 → 歇業候選
 *                              （不再用 NHI 特約終止判定；開業/歇業以衛福部開業狀態為準，
 *                                由前端「查衛福部」即時確認後人工更新）
 * 狀態 5 — selfManagedCustomers：客戶無機構代碼 → 未納入醫事監控
 * 狀態 6 — inconsistentData  ：代碼相符，但名稱/縣市有差異 → 提供人工確認
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getCustomersWithCodes } from '@/lib/system-notion'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SnapshotEntry {
  source:    'nhi' | 'bas'
  kind:      string
  name:      string
  address:   string
  specialty: string
  termDate:  string
}

export interface Snapshot {
  month:        string
  fetchedAt:    string
  totalClinics: number
  totalLabs:    number
  prevTotalClinics?: number   // 上月診所總數（供計算增減；由月排程寫入）
  prevTotalLabs?:    number   // 上月技工所總數
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
  normalOperating:     number
  newOpeningClinics:   number
  newOpeningLabs:      number
  newOpeningHospitals: number
  newThisMonthClinics:   number
  newThisMonthLabs:      number
  newThisMonthHospitals: number
  suspectedClosures:   number
  codeNotFound:        number
  inconsistentData:    number
}

export interface MonitorResult {
  hasSnapshot:    boolean
  stats:          MonitorStats
  newOpenings: {
    clinics:   NewOpening[]
    labs:      NewOpening[]
    hospitals: NewOpening[]
  }
  normalOperating:       NormalOperating[]
  suspectedClosures:     SuspectedClosure[]
  codeNotFound:          CodeNotFound[]
  selfManagedCustomers:  SelfManagedCustomer[]
  inconsistentData:      InconsistentData[]
  snapshotMonth:   string
  snapshotFetched: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const CLINIC_KINDS     = new Set(['牙醫一般診所', '牙醫診所', '牙醫專科診所'])
const LAB_KINDS        = new Set(['牙體技術所'])

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

/** 名稱正規化（移除通用詞，方便比對） */
function normalizeName(name: string): string {
  return name
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

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  // 1. 讀快照
  const snapshotPath = path.join(process.cwd(), 'data', 'clinic-snapshot.json')
  let snapshot: Snapshot | null = null
  if (existsSync(snapshotPath)) {
    try { snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot }
    catch { snapshot = null }
  }

  if (!snapshot) {
    return NextResponse.json({
      hasSnapshot: false,
      stats: null,
      newOpenings: { clinics: [], labs: [], hospitals: [] },
      normalOperating: [], suspectedClosures: [], codeNotFound: [],
      selfManagedCustomers: [], inconsistentData: [],
      snapshotMonth: '', snapshotFetched: '',
    })
  }

  const codes           = snapshot.codes ?? {}
  const newThisMonthSet = new Set(snapshot.newCodes ?? [])

  // 2. 載入崧達客戶（全部，含無代碼）
  const allCustomers = await getCustomersWithCodes()

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

  // ── 狀態 1/3/4/6：逐一處理有代碼的客戶 ───────────────────────────────────
  const normalOperating:   NormalOperating[]   = []
  const suspectedClosures: SuspectedClosure[]  = []
  const codeNotFound:      CodeNotFound[]      = []
  const inconsistentData:  InconsistentData[]  = []

  for (const c of customersWithCode) {
    const code  = c.institutionCode.trim()
    const entry = snapshotByCode.get(code)

    if (!entry) {
      // 狀態 3：歇業候選（機構代碼從醫事資料消失）— 待查衛福部開業狀態確認
      suspectedClosures.push({
        customerId: c.id, customerName: c.name,
        customerCity: c.city, customerDistrict: c.district,
        customerType: c.type, customerStatus: c.status,
        institutionCode: code, reason: 'code_vanished',
      })
    } else {
      const diffs = detectDiffs(c, entry)
      if (diffs.length > 0) {
        // 狀態 6：資料不一致（代碼相符但名稱/縣市有落差）
        inconsistentData.push({
          customerId: c.id, customerName: c.name,
          customerCity: c.city, customerDistrict: c.district,
          customerType: c.type, customerStatus: c.status,
          institutionCode: code, diffs,
          snapshotName: entry.name, snapshotKind: entry.kind,
          snapshotAddress: entry.address, snapshotTermDate: entry.termDate,
        })
      } else {
        // 狀態 1：既有正常營業
        normalOperating.push({
          customerId: c.id, customerName: c.name,
          customerCity: c.city, customerDistrict: c.district,
          customerType: c.type, customerStatus: c.status,
          institutionCode: code,
          snapshotName: entry.name, snapshotKind: entry.kind,
          snapshotAddress: entry.address, snapshotTermDate: entry.termDate,
        })
      }
    }
  }

  // ── 狀態 5：公司自建客戶（無機構代碼）────────────────────────────────────
  const selfManagedCustomers: SelfManagedCustomer[] = customersNoCode.map(c => ({
    customerId: c.id, customerName: c.name,
    customerCity: c.city, customerDistrict: c.district,
    customerType: c.type, customerStatus: c.status,
  }))

  // ── 狀態 2：新開業候選（快照有、客戶 DB 無）─────────────────────────────
  const newOpenings: NewOpening[] = []
  for (const [code, entry] of Array.from(snapshotByCode)) {
    if (!customerByCode.has(code)) {
      const { city, district } = parseAddress(entry.address)
      newOpenings.push({
        code, name: entry.name, kind: entry.kind,
        category:  getCategory(entry.kind),
        city, district, address: entry.address, specialty: entry.specialty,
        isNewThisMonth: newThisMonthSet.has(code),
      })
    }
  }

  // ── 分類統計 ───────────────────────────────────────────────────────────────
  const newClinic   = newOpenings.filter(n => n.category === 'clinic')
  const newLab      = newOpenings.filter(n => n.category === 'lab')
  const newHospital = newOpenings.filter(n => n.category === 'hospital')

  const stats: MonitorStats = {
    totalClinics:   snapshot.totalClinics,
    totalLabs:      snapshot.totalLabs,
    totalHospitals: 0,
    clinicDelta: typeof snapshot.prevTotalClinics === 'number' ? snapshot.totalClinics - snapshot.prevTotalClinics : null,
    labDelta:    typeof snapshot.prevTotalLabs    === 'number' ? snapshot.totalLabs    - snapshot.prevTotalLabs    : null,
    labsStale:   snapshot.labsStale === true,
    customerWithCode:    customersWithCode.length,
    customerNoCode:      customersNoCode.length,
    normalOperating:     normalOperating.length,
    newOpeningClinics:   newClinic.length,
    newOpeningLabs:      newLab.length,
    newOpeningHospitals: newHospital.length,
    newThisMonthClinics:   newClinic.filter(n => n.isNewThisMonth).length,
    newThisMonthLabs:      newLab.filter(n => n.isNewThisMonth).length,
    newThisMonthHospitals: newHospital.filter(n => n.isNewThisMonth).length,
    suspectedClosures:   suspectedClosures.length,
    codeNotFound:        0,
    inconsistentData:    inconsistentData.length,
  }

  const result: MonitorResult = {
    hasSnapshot: true,
    stats,
    newOpenings: {
      clinics:   newClinic.slice(0, 500),
      labs:      newLab.slice(0, 200),
      hospitals: newHospital.slice(0, 100),
    },
    normalOperating:      normalOperating.slice(0, 3000),
    suspectedClosures,
    codeNotFound:         [],
    selfManagedCustomers: selfManagedCustomers.slice(0, 2000),
    inconsistentData,
    snapshotMonth:   snapshot.month,
    snapshotFetched: snapshot.fetchedAt,
  }

  return NextResponse.json(result)
}
