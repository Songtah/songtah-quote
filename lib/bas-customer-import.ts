/**
 * lib/bas-customer-import.ts —— 以衛福部 BAS 資料建立客戶（醫事監控匯入與活動報名自動建檔共用）
 *
 * 同一件事只能有一套寫法：兩個入口都走 createCustomerFromBas，欄位與 BAS 詳細頁帶入規則一致
 * （地址/電話/健保特約/三個衛福部連結/人員數），差別只在「開發來源」。
 */
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { createSystemCustomer } from '@/lib/notion/customers'
import { fetchBasFull } from '@/lib/mohw-bas.mjs'

export const KIND_TO_TYPE: Record<string, string> = {
  '牙醫一般診所': '牙醫診所',
  '牙醫診所':     '牙醫診所',
  '牙醫專科診所': '牙醫診所',
  '牙體技術所':   '牙體技術所',
}

export type BasInstitution = {
  code: string; name: string; kind: string; city: string; district: string; address: string
}

let seqByCodeCache: Map<string, { basSeq: string; zoneSeq: string }> | null = null

/** bas-cache.json：code → { basSeq, zoneSeq }（cache key 為 basSeq__zoneSeq） */
function loadBasSeqByCode(): Map<string, { basSeq: string; zoneSeq: string }> {
  if (seqByCodeCache) return seqByCodeCache
  const map = new Map<string, { basSeq: string; zoneSeq: string }>()
  try {
    const p = path.join(process.cwd(), 'data', 'bas-cache.json')
    if (existsSync(p)) {
      const cache = JSON.parse(readFileSync(p, 'utf8')) as Record<string, { code?: string }>
      for (const [key, v] of Object.entries(cache)) {
        if (!v?.code) continue
        const [basSeq, zoneSeq] = key.split('__')
        if (basSeq && zoneSeq) map.set(v.code, { basSeq, zoneSeq })
      }
    }
  } catch { /* 無 cache 則退回只寫基本欄位 */ }
  seqByCodeCache = map
  return map
}

function parseAddress(address: string): { city: string; district: string } {
  const city = address.match(/^(.*?[市縣])/)?.[1] ?? ''
  const district = address.replace(city, '').match(/^(.*?[區鄉鎮市])/)?.[1] ?? ''
  return { city, district }
}

function isExpired(termDate?: string): boolean {
  if (!termDate || termDate === '0' || termDate.length < 8) return false
  const d = new Date(+termDate.slice(0, 4), +termDate.slice(4, 6) - 1, +termDate.slice(6, 8))
  return !isNaN(d.getTime()) && d < new Date()
}

let snapshotCache: BasInstitution[] | null = null

/** BAS 快照中「開業中、未終止」的機構（data/clinic-snapshot.json，每月排程更新） */
export function loadOpenBasInstitutions(): BasInstitution[] {
  if (snapshotCache) return snapshotCache
  const out: BasInstitution[] = []
  try {
    const p = path.join(process.cwd(), 'data', 'clinic-snapshot.json')
    const snap = JSON.parse(readFileSync(p, 'utf8')) as { codes?: Record<string, { kind: string; name: string; address: string; termDate?: string; status?: string }> }
    for (const [code, e] of Object.entries(snap.codes ?? {})) {
      if (e.status && e.status !== '開業') continue
      if (isExpired(e.termDate)) continue
      out.push({ code, name: e.name, kind: e.kind, address: e.address, ...parseAddress(e.address) })
    }
  } catch { /* 無快照＝無法以 BAS 建檔 */ }
  snapshotCache = out
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function createCustomerFromBas(inst: BasInstitution, devSource: string): Promise<{ id: string }> {
  const seq = loadBasSeqByCode().get(inst.code)
  let full: any = null
  if (seq) {
    try { full = await fetchBasFull(seq); await sleep(200) } catch { full = null }
  }
  return createSystemCustomer({
    name:            inst.name,
    city:            inst.city,
    district:        inst.district,
    address:         full?.address || inst.address,   // 優先用 BAS 完整街道地址
    phone:           full?.phone || undefined,
    institutionCode: inst.code,
    type:            KIND_TO_TYPE[inst.kind] ?? inst.kind,
    status:          '開業',
    nhiContract:     full ? full.nhi : undefined,
    infoUrl:         full?.infoUrl,
    personnelUrl:    full?.personnelUrl,
    deptUrl:         full?.deptUrl,
    devStage:        '線索',
    devSource,
    dentistCount:           full?.dentistCount,
    technicianCount:        full?.technicianCount,
    technicianTraineeCount: full?.technicianTraineeCount,
  })
}
