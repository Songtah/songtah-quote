import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

const CITY_ORDER = [
  '臺北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '宜蘭縣',
  '苗栗縣', '臺中市', '彰化縣', '南投縣', '雲林縣', '嘉義市', '嘉義縣',
  '臺南市', '高雄市', '屏東縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣',
]
const INACTIVE = new Set(['已歇業', '停業', '撤銷'])

export const GET = withApiAuth({ module: 'clinic_monitor', action: 'view' }, async () => {
  try {
    const raw = await readFile(path.join(process.cwd(), 'data', 'clinic-snapshot.json'), 'utf8')
    const snapshot = JSON.parse(raw) as { fetchedAt?: string; codes?: Record<string, { address?: string; status?: string }> }
    const counts = new Map<string, { city: string; district: string; marketTotal: number }>()
    for (const item of Object.values(snapshot.codes ?? {})) {
      if (INACTIVE.has(item.status ?? '')) continue
      const address = item.address ?? ''
      const city = CITY_ORDER.find((name) => address.startsWith(name))
      if (!city) continue
      const district = address.slice(city.length).match(/^(.+?[區鄉鎮市])/)?.[1] ?? ''
      if (!district) continue
      const key = `${city}|${district}`
      const current = counts.get(key)
      if (current) current.marketTotal++
      else counts.set(key, { city, district, marketTotal: 1 })
    }
    const items = Array.from(counts.values()).sort((a, b) => {
      const cityDiff = CITY_ORDER.indexOf(a.city) - CITY_ORDER.indexOf(b.city)
      return cityDiff || a.district.localeCompare(b.district, 'zh-TW')
    })
    return NextResponse.json({ items, source: 'medical-snapshot', updatedAt: snapshot.fetchedAt ?? '' })
  } catch (error) {
    console.error('territory areas GET error:', error)
    return NextResponse.json({ error: '讀取轄區選項失敗' }, { status: 500 })
  }
})
