/**
 * GET /api/admin/medical-monitor
 *
 * 從 data/clinic-snapshot.json 與崧達客戶 DB 進行比對，回傳：
 *
 * 條件 1 — matchedCustomers  ：客戶有代碼且在快照中找到
 * 條件 2 — suggestedMatches  ：客戶無代碼但名稱可比對到快照機構
 * 條件 3 — closureDetails    ：客戶有代碼但找不到（查無）或 NHI 特約已終止
 * 其他   — newOpenings       ：快照有、客戶 DB 沒有 → 業務開發機會
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

/** 條件 1：客戶有代碼且快照中找到 */
export interface MatchedCustomer {
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

/** 條件 2：客戶無代碼，名稱比對到快照候選 */
export interface SuggestedMatch {
  customerId:       string
  customerName:     string
  customerCity:     string
  customerDistrict: string
  customerType:     string
  customerStatus:   string
  suggestions: Array<{
    code:     string
    name:     string
    kind:     string
    city:     string
    district: string
    address:  string
    termDate: string
    score:    number   // 0–1
  }>
}

/** 條件 3：客戶有代碼但異常（查無 or NHI 特約終止） */
export interface ClosureDetail {
  customerId:        string
  customerName:      string
  customerCity:      string
  customerDistrict:  string
  customerType:      string
  customerStatus:    string
  institutionCode:   string
  reason:            'not_found' | 'nhi_terminated'
  snapshotName?:     string
  snapshotKind?:     string
  snapshotAddress?:  string
  snapshotTermDate?: string
}

export interface MonitorStats {
  totalClinics:   number
  totalLabs:      number
  totalHospitals: number
  customerClinics:   number
  customerLabs:      number
  customerHospitals: number
  customerNoCode:    number
  customerMatched:   number
  newOpeningClinics:   number
  newOpeningLabs:      number
  newOpeningHospitals: number
  newThisMonthClinics:   number
  newThisMonthLabs:      number
  newThisMonthHospitals: number
  closureClinics:    number
  closureLabs:       number
  closureHospitals:  number
  terminatedClinics:    number
  terminatedLabs:       number
  terminatedHospitals:  number
  suggestedMatchCount:  number
}

export interface MonitorResult {
  hasSnapshot:      boolean
  stats:            MonitorStats
  newOpenings: {
    clinics:   NewOpening[]
    labs:      NewOpening[]
    hospitals: NewOpening[]
  }
  matchedCustomers:  MatchedCustomer[]
  suggestedMatches:  SuggestedMatch[]
  closureDetails: {
    clinics:   ClosureDetail[]
    labs:      ClosureDetail[]
    hospitals: ClosureDetail[]
  }
  snapshotMonth:   string
  snapshotFetched: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const CLINIC_KINDS     = new Set(['牙醫一般診所', '牙醫診所', '牙醫專科診所'])
const LAB_KINDS        = new Set(['牙體技術所'])
const CLINIC_TYPES_DB  = ['牙醫診所', '牙醫一般診所', '牙醫專科診所', '診所']
const LAB_TYPES_DB     = ['牙體技術所', '技工所']
const HOSPITAL_TYPES_DB = ['醫院', '醫學中心', '區域醫院', '地區醫院']

function getCategory(kind: string): InstitutionCategory {
  if (LAB_KINDS.has(kind))    return 'lab'
  if (CLINIC_KINDS.has(kind)) return 'clinic'
  return 'hospital'
}

function getCustomerCategory(type: string): InstitutionCategory | null {
  if (CLINIC_TYPES_DB.some(t => type.includes(t)))   return 'clinic'
  if (LAB_TYPES_DB.some(t => type.includes(t)))      return 'lab'
  if (HOSPITAL_TYPES_DB.some(t => type.includes(t))) return 'hospital'
  return null
}

function parseAddress(address: string): { city: string; district: string } {
  const cityMatch = address.match(/^(.*?[市縣])/)
  const city      = cityMatch ? cityMatch[1] : ''
  const distMatch = address.replace(city, '').match(/^(.*?[區鄉鎮市])/)
  const district  = distMatch ? distMatch[1] : ''
  return { city, district }
}

/** NHI 特約終止日期（YYYYMMDD）是否已過期 */
function isNhiTerminated(termDate: string): boolean {
  if (!termDate || termDate === '0' || termDate.length < 8) return false
  const y = parseInt(termDate.slice(0, 4))
  const m = parseInt(termDate.slice(4, 6)) - 1
  const d = parseInt(termDate.slice(6, 8))
  if (isNaN(y) || isNaN(m) || isNaN(d)) return false
  return new Date(y, m, d) < new Date()
}

/** 名稱正規化（移除常見通用詞，方便模糊比對） */
function normalizeName(name: string): string {
  return name
    .replace(/牙醫|牙科|診所|醫院|專科|一般|牙體技術所|牙體|技術所|技工所|聯合|聯診|口腔|植牙|美齒|牙齒/g, '')
    .replace(/[（）()\s\-_]/g, '')
    .trim()
}

/** 0–1 名稱匹配分數；< 0.7 視為不相符 */
function nameScore(customerName: string, snapshotName: string): number {
  const cn = normalizeName(customerName)
  const sn = normalizeName(snapshotName)
  if (!cn || !sn || cn.length < 2 || sn.length < 2) return 0
  if (cn === sn)             return 1.0
  if (sn.includes(cn))       return 0.9
  if (cn.includes(sn))       return 0.8
  return 0
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
      stats: null, newOpenings: null,
      matchedCustomers: [], suggestedMatches: [], closureDetails: null,
      snapshotMonth: '', snapshotFetched: '',
    })
  }

  const codes           = snapshot.codes ?? {}
  const newThisMonthSet = new Set(snapshot.newCodes ?? [])

  // 2. 載入崧達客戶（全部，含無代碼）
  const allCustomers = await getCustomersWithCodes()

  const customerByCode     = new Map<string, typeof allCustomers[0]>()
  const customersWithCode: typeof allCustomers = []
  const customersNoCode:   typeof allCustomers = []

  for (const c of allCustomers) {
    const code = c.institutionCode.trim()
    if (!code) customersNoCode.push(c)
    else { customersWithCode.push(c); customerByCode.set(code, c) }
  }

  // 3. 快照查找表
  const snapshotByCode = new Map<string, SnapshotEntry & { code: string }>()
  for (const [code, entry] of Object.entries(codes)) {
    snapshotByCode.set(code, { ...entry, code })
  }

  // ── 條件 1：有代碼且快照找到（正常已對應）────────────────────────────────
  const matchedCustomers: MatchedCustomer[] = []
  for (const c of customersWithCode) {
    const entry = snapshotByCode.get(c.institutionCode.trim())
    if (!entry) continue
    matchedCustomers.push({
      customerId:       c.id,
      customerName:     c.name,
      customerCity:     c.city,
      customerDistrict: c.district,
      customerType:     c.type,
      customerStatus:   c.status,
      institutionCode:  c.institutionCode.trim(),
      snapshotName:     entry.name,
      snapshotKind:     entry.kind,
      snapshotAddress:  entry.address,
      snapshotTermDate: entry.termDate,
    })
  }

  // ── 條件 2：無代碼客戶，依名稱建議快照候選 ────────────────────────────────
  // 僅對牙醫診所/牙技所/醫院類型的客戶進行比對（跳過非牙科）
  const DENTAL_CUSTOMER_TYPES = [...CLINIC_TYPES_DB, ...LAB_TYPES_DB, ...HOSPITAL_TYPES_DB]
  const isDentalCustomer = (type: string) =>
    DENTAL_CUSTOMER_TYPES.some(t => type.includes(t))

  // 先建立快照的「正規名稱 → entries」索引，加速查找
  const snapshotByNorm = new Map<string, Array<{ code: string; entry: SnapshotEntry }>>()
  for (const [code, entry] of Object.entries(codes)) {
    const norm = normalizeName(entry.name)
    if (!norm) continue
    if (!snapshotByNorm.has(norm)) snapshotByNorm.set(norm, [])
    snapshotByNorm.get(norm)!.push({ code, entry })
  }

  const suggestedMatches: SuggestedMatch[] = []
  for (const c of customersNoCode) {
    if (!isDentalCustomer(c.type)) continue
    const normCustomer = normalizeName(c.name)
    if (!normCustomer || normCustomer.length < 2) continue

    const seen    = new Set<string>()
    const results: SuggestedMatch['suggestions'] = []

    // 精確正規名稱命中
    const exact = snapshotByNorm.get(normCustomer)
    if (exact) {
      for (const { code, entry } of exact) {
        if (seen.has(code)) continue
        seen.add(code)
        const { city, district } = parseAddress(entry.address)
        results.push({ code, name: entry.name, kind: entry.kind, city, district, address: entry.address, termDate: entry.termDate, score: 1.0 })
      }
    }

    // 包含關係（無精確命中才補充）
    if (results.length === 0) {
      for (const [norm, entries] of Array.from(snapshotByNorm)) {
        const sc = normCustomer === norm ? 1.0
                 : norm.includes(normCustomer) ? 0.9
                 : normCustomer.includes(norm) && norm.length >= 2 ? 0.8
                 : 0
        if (sc < 0.75) continue
        for (const { code, entry } of entries) {
          if (seen.has(code)) continue
          seen.add(code)
          const { city, district } = parseAddress(entry.address)
          results.push({ code, name: entry.name, kind: entry.kind, city, district, address: entry.address, termDate: entry.termDate, score: sc })
        }
      }
    }

    if (results.length === 0) continue
    suggestedMatches.push({
      customerId:       c.id,
      customerName:     c.name,
      customerCity:     c.city,
      customerDistrict: c.district,
      customerType:     c.type,
      customerStatus:   c.status,
      suggestions:      results.sort((a, b) => b.score - a.score).slice(0, 5),
    })
  }

  // ── 條件 3：有代碼但異常（查無 or NHI 特約終止）───────────────────────────
  const closureDetails: ClosureDetail[] = []
  for (const c of customersWithCode) {
    const code  = c.institutionCode.trim()
    const entry = snapshotByCode.get(code)

    if (!entry) {
      // 快照完全找不到代碼
      closureDetails.push({
        customerId: c.id, customerName: c.name, customerCity: c.city,
        customerDistrict: c.district, customerType: c.type, customerStatus: c.status,
        institutionCode: code, reason: 'not_found',
      })
    } else if (isNhiTerminated(entry.termDate)) {
      // 代碼在快照，但 NHI 特約已終止
      closureDetails.push({
        customerId: c.id, customerName: c.name, customerCity: c.city,
        customerDistrict: c.district, customerType: c.type, customerStatus: c.status,
        institutionCode: code, reason: 'nhi_terminated',
        snapshotName:     entry.name,
        snapshotKind:     entry.kind,
        snapshotAddress:  entry.address,
        snapshotTermDate: entry.termDate,
      })
    }
  }

  // ── 新開業：快照有、客戶 DB 無 ─────────────────────────────────────────────
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

  const closureClinic   = closureDetails.filter(c => getCustomerCategory(c.customerType) === 'clinic')
  const closureLab      = closureDetails.filter(c => getCustomerCategory(c.customerType) === 'lab')
  const closureHospital = closureDetails.filter(c => {
    const cat = getCustomerCategory(c.customerType)
    return cat === 'hospital' || cat === null
  })

  const terminatedClinic   = closureClinic.filter(c => c.reason === 'nhi_terminated')
  const terminatedLab      = closureLab.filter(c => c.reason === 'nhi_terminated')
  const terminatedHospital = closureHospital.filter(c => c.reason === 'nhi_terminated')

  const newThisMonthClinic   = newClinic.filter(n => n.isNewThisMonth)
  const newThisMonthLab      = newLab.filter(n => n.isNewThisMonth)
  const newThisMonthHospital = newHospital.filter(n => n.isNewThisMonth)

  let customerClinics = 0, customerLabs = 0, customerHospitals = 0
  for (const c of customersWithCode) {
    const cat = getCustomerCategory(c.type)
    if (cat === 'clinic')   customerClinics++
    else if (cat === 'lab') customerLabs++
    else                    customerHospitals++
  }

  const stats: MonitorStats = {
    totalClinics:   snapshot.totalClinics,
    totalLabs:      snapshot.totalLabs,
    totalHospitals: 0,
    customerClinics, customerLabs, customerHospitals,
    customerNoCode:  customersNoCode.length,
    customerMatched: matchedCustomers.length,
    newOpeningClinics:    newClinic.length,
    newOpeningLabs:       newLab.length,
    newOpeningHospitals:  newHospital.length,
    newThisMonthClinics:  newThisMonthClinic.length,
    newThisMonthLabs:     newThisMonthLab.length,
    newThisMonthHospitals: newThisMonthHospital.length,
    closureClinics:    closureClinic.length,
    closureLabs:       closureLab.length,
    closureHospitals:  closureHospital.length,
    terminatedClinics:    terminatedClinic.length,
    terminatedLabs:       terminatedLab.length,
    terminatedHospitals:  terminatedHospital.length,
    suggestedMatchCount:  suggestedMatches.length,
  }

  const result: MonitorResult = {
    hasSnapshot:     true,
    stats,
    newOpenings: {
      clinics:   newClinic.slice(0, 500),
      labs:      newLab.slice(0, 200),
      hospitals: newHospital.slice(0, 100),
    },
    matchedCustomers: matchedCustomers.slice(0, 2000),
    suggestedMatches: suggestedMatches.slice(0, 500),
    closureDetails: {
      clinics:   closureClinic,
      labs:      closureLab,
      hospitals: closureHospital,
    },
    snapshotMonth:   snapshot.month,
    snapshotFetched: snapshot.fetchedAt,
  }

  return NextResponse.json(result)
}
