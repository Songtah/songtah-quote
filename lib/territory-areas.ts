import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { TAIWAN_CITY_ORDER } from './taiwan-geography'

export const TERRITORY_CUSTOMER_TYPES = ['牙醫診所', '牙體技術所', '醫院'] as const
export type TerritoryCustomerType = (typeof TERRITORY_CUSTOMER_TYPES)[number]

export type TerritoryArea = {
  city: string
  district: string
  marketTotal: number
  byType: Record<TerritoryCustomerType, number>
}

const INACTIVE = new Set(['已歇業', '停業', '撤銷'])

export async function getTerritoryAreas(): Promise<{ items: TerritoryArea[]; updatedAt: string }> {
  const raw = await readFile(path.join(process.cwd(), 'data', 'clinic-snapshot.json'), 'utf8')
  const snapshot = JSON.parse(raw) as {
    fetchedAt?: string
    codes?: Record<string, { address?: string; status?: string; kind?: string }>
  }
  const counts = new Map<string, TerritoryArea>()
  for (const item of Object.values(snapshot.codes ?? {})) {
    if (INACTIVE.has(item.status ?? '')) continue
    const address = item.address ?? ''
    const city = TAIWAN_CITY_ORDER.find((name) => address.startsWith(name))
    if (!city) continue
    const district = address.slice(city.length).match(/^(.+?[區鄉鎮市])/)?.[1] ?? ''
    if (!district) continue
    const key = `${city}|${district}`
    let current = counts.get(key)
    if (!current) {
      current = {
        city, district, marketTotal: 0,
        byType: { '牙醫診所': 0, '牙體技術所': 0, '醫院': 0 },
      }
      counts.set(key, current)
    }
    current.marketTotal++
    if (TERRITORY_CUSTOMER_TYPES.includes(item.kind as TerritoryCustomerType)) {
      current.byType[item.kind as TerritoryCustomerType]++
    }
  }
  const items = Array.from(counts.values()).sort((a, b) => {
    const cityDiff = TAIWAN_CITY_ORDER.indexOf(a.city as (typeof TAIWAN_CITY_ORDER)[number]) - TAIWAN_CITY_ORDER.indexOf(b.city as (typeof TAIWAN_CITY_ORDER)[number])
    return cityDiff || a.district.localeCompare(b.district, 'zh-TW')
  })
  return { items, updatedAt: snapshot.fetchedAt ?? '' }
}
