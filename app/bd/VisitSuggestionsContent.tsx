'use client'

/**
 * 拜訪建議 — 選業務+鄉鎮市區,產出三組建議(A 商品興趣追蹤/B 例行拜訪/C 陌生開發)。
 * 定位:出門前的彈藥清單。理由+撥號+導航+複製拜訪單;不做拜訪量 KPI,配比為軟性建議。
 */
import { useEffect, useMemo, useState } from 'react'

type Suggestion = {
  id: string; name: string; type: string; status: string
  address: string; phone: string; salesperson: string; devStage: string
  group: 'A' | 'B' | 'C'; reason: string; lastVisit: string | null
}
type SuggestionResult = {
  groups: { A: Suggestion[]; B: Suggestion[]; C: Suggestion[] }
  more: { B: number; C: number }
  mapsBuiltAt: string
}
type RegionRow = { city: string; district: string; salesperson: string; count: number }
type AdoptionStats = {
  totalCopies: number; totalSuggested: number; totalVisited: number; rate: number
  byGroup: Record<'A' | 'B' | 'C', { suggested: number; visited: number }>
}

const GROUP_META = {
  A: { title: '商品興趣追蹤', icon: '🔥', hint: '有明確事由,優先跑' },
  B: { title: '例行拜訪', icon: '🤝', hint: '活躍客戶,別冷掉' },
  C: { title: '陌生開發', icon: '🌱', hint: '填空檔,跑完可認領' },
} as const

function telHref(phone: string): string {
  return 'tel:' + phone.replace(/[^\d+]/g, '')
}
function mapHref(name: string, address: string): string {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address || name)
}

export default function VisitSuggestionsContent({ currentUser }: { currentUser?: string }) {
  const [rows, setRows] = useState<RegionRow[]>([])
  const [sp, setSp] = useState('')
  const [city, setCity] = useState('')
  const [district, setDistrict] = useState('')
  const [data, setData] = useState<SuggestionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const [adoption, setAdoption] = useState<AdoptionStats | null>(null)

  const loadAdoption = () => {
    fetch('/api/bd/visit-suggestions/adoption?mine=1&days=30')
      .then((r) => r.json())
      .then((d) => { if (!d.error) setAdoption(d) })
      .catch(() => {})
  }
  useEffect(() => { loadAdoption() }, [])

  // 區域/業務選項:吃區域統計快取(即時)
  useEffect(() => {
    fetch('/api/customers/region-stats')
      .then((r) => r.json())
      .then((d) => setRows(d.rows ?? []))
      .catch(() => setError('讀取區域清單失敗'))
  }, [])

  const salespersons = useMemo(
    () => Array.from(new Set(rows.map((r) => r.salesperson).filter((s) => s && s !== '公司' && s !== '盤商'))).sort(),
    [rows])

  // 預設業務 = 登入者(若在名單中)
  useEffect(() => {
    if (sp || !salespersons.length) return
    setSp(currentUser && salespersons.includes(currentUser) ? currentUser : salespersons[0])
  }, [salespersons, currentUser, sp])

  // 該業務轄區(有客戶的區)排前面,其餘區照筆數排
  const districtOptions = useMemo(() => {
    const mine = new Map<string, number>()   // 'city|district' → 該業務客戶數
    const all = new Map<string, number>()
    for (const r of rows) {
      if (r.city.startsWith('(') || r.district.startsWith('(')) continue
      const k = r.city + '|' + r.district
      all.set(k, (all.get(k) ?? 0) + r.count)
      if (r.salesperson === sp) mine.set(k, (mine.get(k) ?? 0) + r.count)
    }
    const opts = Array.from(all.keys()).map((k) => {
      const [c, d] = k.split('|')
      return { city: c, district: d, mineCount: mine.get(k) ?? 0, total: all.get(k) ?? 0 }
    })
    opts.sort((a, b) => b.mineCount - a.mineCount || b.total - a.total)
    return opts
  }, [rows, sp])

  // 預設區 = 該業務客戶最多的區
  // 必須等業務確定(sp 有值)才設,否則會被「業務未定前的全域最大區」搶先鎖住 city,
  // 之後 districtOptions 換成該業務轄區也因 city 已有值而不再修正(race)。
  useEffect(() => {
    if (city || !sp || !districtOptions.length) return
    const top = districtOptions[0]
    setCity(top.city); setDistrict(top.district)
  }, [districtOptions, city, sp])

  useEffect(() => {
    if (!sp || !city || !district) return
    setLoading(true); setError(''); setData(null); setChecked(new Set())
    const q = new URLSearchParams({ city, district, salesperson: sp })
    fetch('/api/bd/visit-suggestions?' + q)
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || '讀取失敗')
        setData(d)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [sp, city, district])

  const allItems = useMemo(
    () => data ? [...data.groups.A, ...data.groups.B, ...data.groups.C] : [],
    [data])

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const copyPlan = async () => {
    const picked = allItems.filter((x) => checked.size === 0 || checked.has(x.id))
    const today = new Date().toISOString().slice(0, 10)
    const lines = [
      `📋 拜訪單 ${city}${district}｜${sp}｜${today}`,
      ...picked.map((x, i) =>
        `${i + 1}. ${GROUP_META[x.group].icon} ${x.name}\n   ${x.reason}${x.phone ? `\n   ☎ ${x.phone}` : ''}${x.address ? `\n   📍 ${x.address}` : ''}`),
    ]
    const text = lines.join('\n')
    // 記錄這批建議被複製(可追溯用):失敗不擋複製動作,純背景記錄。
    fetch('/api/bd/visit-suggestions/adoption', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city, district, items: picked.map((x) => ({ id: x.id, group: x.group })) }),
    }).then(loadAdoption).catch(() => {})
    // clipboard API 在手機 webview / 非 HTTPS / 權限受限時會拋錯,需 fallback,
    // 否則使用者點了沒反應、按鈕也不變「已複製」,會誤以為壞掉。
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 2000) }
    try {
      await navigator.clipboard.writeText(text)
      done()
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.focus(); ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        done()
      } catch {
        setError('複製失敗,請手動長按選取拜訪單文字')
      }
    }
  }

  const total = allItems.length
  const pickedCount = checked.size

  return (
    <div className="space-y-6">
      {/* 條件列 */}
      <div className="card-soft p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[auto_auto_1fr] items-end gap-4">
        <div className="min-w-0">
          <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400">業務</label>
          <select className="select-soft mt-1 block w-full" value={sp} onChange={(e) => { setSp(e.target.value); setCity(''); setDistrict('') }}>
            {salespersons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="min-w-0">
          <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400">鄉鎮市區(轄區優先)</label>
          <select
            className="select-soft mt-1 block w-full sm:min-w-[220px]"
            value={city && district ? city + '|' + district : ''}
            onChange={(e) => { const [c, d] = e.target.value.split('|'); setCity(c); setDistrict(d) }}
          >
            {districtOptions.map((o) => (
              <option key={o.city + '|' + o.district} value={o.city + '|' + o.district}>
                {o.city}{o.district}{o.mineCount ? `(持有 ${o.mineCount})` : ''}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-stone-400 sm:col-span-2 xl:col-span-1 xl:ml-auto xl:self-center">
          建議一日 8 家上下,依現場彈性調整;資料每晚更新{data ? `(${data.mapsBuiltAt.slice(0, 10)})` : ''}
        </p>
      </div>

      {/* 建議採納率(近30天,可追溯:複製建議後這些客戶事後有沒有真的被拜訪) */}
      {adoption && adoption.totalSuggested > 0 && (
        <p className="text-xs text-stone-400 -mt-2">
          📊 近 30 天你複製了 {adoption.totalCopies} 次拜訪單,建議的 {adoption.totalSuggested} 家中有 {adoption.totalVisited} 家事後真的拜訪了(採納率 {(adoption.rate * 100).toFixed(0)}%)
        </p>
      )}

      {error && <div className="card-soft p-4 text-sm text-red-600">{error}</div>}
      {loading && (
        <div className="card-soft p-8 text-center text-sm text-stone-400">
          正在整理 {city}{district} 的拜訪機會…(首次載入需建快取,約 1 分鐘)
        </div>
      )}

      {data && !loading && (
        <>
          {(['A', 'B', 'C'] as const).map((g) => {
            const items = data.groups[g]
            const meta = GROUP_META[g]
            const more = g === 'B' ? data.more.B : g === 'C' ? data.more.C : 0
            if (!items.length && !more) return null
            return (
              <section key={g} className="card-soft overflow-hidden">
                <header className="px-5 py-3.5 flex items-baseline gap-3 border-b border-stone-900/[0.06] bg-brand-50/40">
                  <h3 className="font-bold text-stone-800">{meta.icon} {meta.title}</h3>
                  <span className="text-xs text-stone-400">{meta.hint}</span>
                  <span className="ml-auto text-xs text-stone-400">{items.length} 家{more > 0 ? `,另有 ${more} 家未列` : ''}</span>
                </header>
                <ul className="divide-y divide-stone-900/[0.04]">
                  {items.map((x) => (
                    <li key={x.id} className="px-4 sm:px-5 py-4 flex items-start gap-3 hover:bg-brand-50/50 transition-colors">
                      <input
                        type="checkbox"
                        className="mt-1.5 accent-[#b8956a] cursor-pointer"
                        checked={checked.has(x.id)}
                        onChange={() => toggle(x.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-stone-800">{x.name}</span>
                          {x.type && <span className="chip text-[11px]">{x.type}</span>}
                          {x.devStage && <span className="chip text-[11px]">{x.devStage}</span>}
                          {x.lastVisit && <span className="text-[11px] text-stone-400">上次拜訪 {x.lastVisit}</span>}
                        </div>
                        <p className="mt-1 text-sm text-stone-600 leading-relaxed">{x.reason}</p>
                      </div>
                      <div className="flex flex-col sm:flex-row shrink-0 gap-2 self-center">
                        {x.phone && (
                          <a href={telHref(x.phone)}
                             className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all">
                            撥號
                          </a>
                        )}
                        <a href={mapHref(x.name, x.address)} target="_blank" rel="noreferrer"
                           className="px-3.5 py-1.5 rounded-full text-xs font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:border-stone-300 active:scale-95 transition-all">
                          導航
                        </a>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}

          {total === 0 ? (
            <div className="card-soft p-8 text-center text-sm text-stone-400">
              {city}{district} 目前沒有可建議的拜訪對象(已排除歇業、公司戶、盤商與其他業務的客戶)
            </div>
          ) : (
            <div className="glass-bar sticky bottom-20 md:bottom-4 rounded-3xl md:rounded-full px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 shadow-lg">
              <span className="text-sm text-stone-600">
                共 {total} 家建議{pickedCount > 0 ? `,已勾選 ${pickedCount} 家` : '(未勾選=全部帶走)'}
              </span>
              <button onClick={copyPlan}
                      className="w-full sm:w-auto sm:ml-auto min-h-11 px-5 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all">
                {copied ? '✓ 已複製' : '複製拜訪單'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
