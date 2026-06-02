/**
 * GET /api/admin/medical-monitor
 *
 * 從 data/clinic-snapshot.json 與崧達客戶 DB 進行比對，回傳：
 *  - stats：統計資料（牙醫診所 / 牙體技術所 / 醫院分開）
 *  - newOpenings：在醫事資料庫但不在客戶 DB → 新開業機會
 *  - possibleClosures：客戶有機構代碼但在醫事資料庫找不到 → 可能歇業
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
  month:      string
  fetchedAt:  string
  totalClinics: number
  totalLabs:    number
  newCodes?:  string[]   // 本月相較上月新增的代碼（真正新開業）
  codes:      Record<string, SnapshotEntry>
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
  isNewThisMonth: boolean  // true = 本月快照才出現（真正新開業）；false = 以前就存在只是不是客戶
}

export interface PossibleClosure {
  customerId:      string
  customerName:    string
  customerCity:    string
  customerDistrict:string
  customerType:    string
  institutionCode: string
}

export interface MonitorStats {
  // 全台數量（快照）
  totalClinics:   number
  totalLabs:      number
  totalHospitals: number
  // 崧達客戶（有代碼）
  customerClinics:   number
  customerLabs:      number
  customerHospitals: number
  customerNoCode:    number
  customerMatched:   number  // 代碼有對應到
  // 比對結果（全部：尚未開發 + 本月新增）
  newOpeningClinics:   number
  newOpeningLabs:      number
  newOpeningHospitals: number
  // 其中本月快照才出現的（真正新開業）
  newThisMonthClinics:   number
  newThisMonthLabs:      number
  newThisMonthHospitals: number
  closureClinics:   number
  closureLabs:      number
  closureHospitals: number
}

export interface MonitorResult {
  stats:             MonitorStats
  newOpenings: {
    clinics:   NewOpening[]
    labs:      NewOpening[]
    hospitals: NewOpening[]
  }
  possibleClosures: {
    clinics:   PossibleClosure[]
    labs:      PossibleClosure[]
    hospitals: PossibleClosure[]
  }
  snapshotMonth:   string
  snapshotFetched: string
  hasSnapshot:     boolean
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const CLINIC_KINDS = new Set(['牙醫一般診所', '牙醫診所', '牙醫專科診所'])
const LAB_KINDS    = new Set(['牙體技術所'])
const CLINIC_TYPES_IN_DB = ['牙醫診所', '牙醫一般診所', '牙醫專科診所', '診所']
const LAB_TYPES_IN_DB    = ['牙體技術所', '技工所']
const HOSPITAL_TYPES_IN_DB = ['醫院', '醫學中心', '區域醫院', '地區醫院']

function getCategory(kind: string): InstitutionCategory {
  if (LAB_KINDS.has(kind))    return 'lab'
  if (CLINIC_KINDS.has(kind)) return 'clinic'
  return 'hospital'
}

function getCustomerCategory(type: string): InstitutionCategory | null {
  if (CLINIC_TYPES_IN_DB.some(t => type.includes(t))) return 'clinic'
  if (LAB_TYPES_IN_DB.some(t => type.includes(t)))    return 'lab'
  if (HOSPITAL_TYPES_IN_DB.some(t => type.includes(t))) return 'hospital'
  return null
}

/** 從地址字串擷取縣市、行政區 */
function parseAddress(address: string): { city: string; district: string } {
  const cityMatch = address.match(/^(.*?[市縣])/)
  const city = cityMatch ? cityMatch[1] : ''
  const distMatch = address.replace(city, '').match(/^(.*?[區鄉鎮市])/)
  const district = distMatch ? distMatch[1] : ''
  return { city, district }
}

// ── Handler ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  // 1. 讀快照
  const snapshotPath = path.join(process.cwd(), 'data', 'clinic-snapshot.json')
  let snapshot: Snapshot | null = null
  if (existsSync(snapshotPath)) {
    try {
      snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot
    } catch {
      snapshot = null
    }
  }

  if (!snapshot) {
    return NextResponse.json({
      hasSnapshot: false,
      stats: null, newOpenings: null, possibleClosures: null,
      snapshotMonth: '', snapshotFetched: '',
    })
  }

  const codes = snapshot.codes ?? {}

  // 本月相較上月新增的代碼集合（真正新開業）
  const newThisMonthSet = new Set(snapshot.newCodes ?? [])

  // 2. 載入崧達客戶
  const customers = await getCustomersWithCodes()

  // 建立客戶代碼查找表
  const customerByCode = new Map<string, typeof customers[0]>()
  const customersWithCode: typeof customers = []
  const customersNoCode: typeof customers = []

  for (const c of customers) {
    const code = c.institutionCode.trim()
    if (!code) {
      customersNoCode.push(c)
    } else {
      customersWithCode.push(c)
      customerByCode.set(code, c)
    }
  }

  // 3. 建立快照代碼查找表
  const snapshotByCode = new Map<string, SnapshotEntry & { code: string }>()
  for (const [code, entry] of Object.entries(codes)) {
    snapshotByCode.set(code, { ...entry, code })
  }

  // 4. 比對

  // 規則 1：在快照中但不在客戶 DB → 新開業（含本月新增 / 既有未開發兩種）
  const newOpenings: NewOpening[] = []
  for (const [code, entry] of Array.from(snapshotByCode)) {
    if (!customerByCode.has(code)) {
      const { city, district } = parseAddress(entry.address)
      newOpenings.push({
        code,
        name:           entry.name,
        kind:           entry.kind,
        category:       getCategory(entry.kind),
        city,
        district,
        address:        entry.address,
        specialty:      entry.specialty,
        isNewThisMonth: newThisMonthSet.has(code),
      })
    }
  }

  // 規則 2：客戶有代碼但快照找不到 → 可能歇業
  const possibleClosures: PossibleClosure[] = []
  for (const c of customersWithCode) {
    const code = c.institutionCode.trim()
    if (!snapshotByCode.has(code)) {
      possibleClosures.push({
        customerId:       c.id,
        customerName:     c.name,
        customerCity:     c.city,
        customerDistrict: c.district,
        customerType:     c.type,
        institutionCode:  code,
      })
    }
  }

  // 5. 分類統計
  const newClinic   = newOpenings.filter(n => n.category === 'clinic')
  const newLab      = newOpenings.filter(n => n.category === 'lab')
  const newHospital = newOpenings.filter(n => n.category === 'hospital')

  const closureClinic   = possibleClosures.filter(c => getCustomerCategory(c.customerType) === 'clinic')
  const closureLab      = possibleClosures.filter(c => getCustomerCategory(c.customerType) === 'lab')
  const closureHospital = possibleClosures.filter(c => {
    const cat = getCustomerCategory(c.customerType)
    return cat === 'hospital' || cat === null
  })

  // 客戶分類統計
  let customerClinics = 0, customerLabs = 0, customerHospitals = 0
  for (const c of customersWithCode) {
    const cat = getCustomerCategory(c.type)
    if (cat === 'clinic')        customerClinics++
    else if (cat === 'lab')      customerLabs++
    else                          customerHospitals++
  }

  const matched = customersWithCode.filter(c => snapshotByCode.has(c.institutionCode.trim())).length

  // 本月新開業（isNewThisMonth）分類統計
  const newThisMonthClinic   = newClinic.filter(n => n.isNewThisMonth)
  const newThisMonthLab      = newLab.filter(n => n.isNewThisMonth)
  const newThisMonthHospital = newHospital.filter(n => n.isNewThisMonth)

  const stats: MonitorStats = {
    totalClinics:   snapshot.totalClinics,
    totalLabs:      snapshot.totalLabs,
    totalHospitals: 0,  // 醫院資料暫未納入快照
    customerClinics,
    customerLabs,
    customerHospitals,
    customerNoCode:    customersNoCode.length,
    customerMatched:   matched,
    newOpeningClinics:   newClinic.length,
    newOpeningLabs:      newLab.length,
    newOpeningHospitals: newHospital.length,
    newThisMonthClinics:   newThisMonthClinic.length,
    newThisMonthLabs:      newThisMonthLab.length,
    newThisMonthHospitals: newThisMonthHospital.length,
    closureClinics:    closureClinic.length,
    closureLabs:       closureLab.length,
    closureHospitals:  closureHospital.length,
  }

  const result: MonitorResult = {
    hasSnapshot:     true,
    stats,
    newOpenings: {
      clinics:   newClinic.slice(0, 500),
      labs:      newLab.slice(0, 200),
      hospitals: newHospital.slice(0, 100),
    },
    possibleClosures: {
      clinics:   closureClinic,
      labs:      closureLab,
      hospitals: closureHospital,
    },
    snapshotMonth:   snapshot.month,
    snapshotFetched: snapshot.fetchedAt,
  }

  return NextResponse.json(result)
}
