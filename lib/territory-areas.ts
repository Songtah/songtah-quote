import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const TERRITORY_CUSTOMER_TYPES = ['牙醫診所', '牙體技術所', '醫院'] as const
export type TerritoryCustomerType = (typeof TERRITORY_CUSTOMER_TYPES)[number]

export type TerritoryArea = {
  city: string
  district: string
  marketTotal: number
  byType: Record<TerritoryCustomerType, number>
}

const CITY_ORDER = [
  '臺北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣',
  '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣',
  '臺南市', '高雄市', '屏東縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣',
]
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
    const city = CITY_ORDER.find((name) => address.startsWith(name))
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
    const cityDiff = CITY_ORDER.indexOf(a.city) - CITY_ORDER.indexOf(b.city)
    return cityDiff || a.district.localeCompare(b.district, 'zh-TW')
  })
  return { items, updatedAt: snapshot.fetchedAt ?? '' }
}
