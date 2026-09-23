'use client'

/**
 * components/TenderMarketPanel.tsx — 標案市場分析（/bd?tab=tender 的「市場分析」）
 *
 * 目的不是再看一次清單，而是回答三個問題：
 *   1. 商機從哪來——哪些機關固定在買牙科的東西、多久買一次、買什麼
 *   2. 競爭者的目標邏輯——每家得標廠商專攻哪種機關、哪個品類、哪個地區，殺價殺多兇
 *   3. 上下游關係——誰跟誰常在同一場標案碰頭，哪些得標者其實是我們的客戶或同業
 *
 * 全部從已載入的標案快照就地計算，不另外打 API；只有帶得標廠商的決標案才進統計
 * （招標公告沒有廠商與金額，算進去會失真）。
 */
import { useMemo, useState } from 'react'
import { classifyTender, classifyBuyer } from '@/lib/tender-source'

type Rec = {
  id: string; unitName: string; title: string; type: string; date: string; city: string
  budget: number | null; awardAmount: number | null; basePrice: number | null
  winner: string; bidders: string[]; customerId: string; customerName: string
}

const wan = (n: number) => `${(n / 10000).toLocaleString(undefined, { maximumFractionDigits: 0 })} 萬`
const pct = (n: number) => `${(n * 100).toFixed(0)}%`

/** 平均採購間隔（天）：同一機關兩次採購之間隔多久，用來預測下次 */
function avgGap(dates: string[]): number | null {
  if (dates.length < 2) return null
  const sorted = [...dates].sort()
  let sum = 0
  for (let i = 1; i < sorted.length; i++) {
    sum += (new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime()) / 86400_000
  }
  return Math.round(sum / (sorted.length - 1))
}

export default function TenderMarketPanel({ records, onPick }: { records: Rec[]; onPick: (q: string) => void }) {
  const [tab, setTab] = useState<'vendor' | 'buyer' | 'category'>('vendor')
  const [years, setYears] = useState(3)

  const since = useMemo(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - years)
    return d.toISOString().slice(0, 10)
  }, [years])

  /** 統計母體：有得標廠商的決標案（招標公告沒有金額與廠商） */
  const awarded = useMemo(
    () => records.filter((r) => r.winner && r.date >= since),
    [records, since])

  const vendors = useMemo(() => {
    type V = {
      count: number; amount: number; cities: Map<string, number>; buyers: Map<string, number>
      cats: Map<string, number>; rivals: Map<string, number>; ratios: number[]; last: string
    }

    const map = new Map<string, V>()
    for (const r of awarded) {
      const v: V = map.get(r.winner) ?? {
        count: 0, amount: 0, cities: new Map(), buyers: new Map(), cats: new Map(), rivals: new Map(), ratios: [], last: '',
      }
      v.count++
      v.amount += r.awardAmount ?? 0
      if (r.date > v.last) v.last = r.date
      const bump = (m: Map<string, number>, k: string) => { if (k) m.set(k, (m.get(k) ?? 0) + 1) }
      bump(v.cities, r.city)
      bump(v.buyers, classifyBuyer(r.unitName))
      bump(v.cats, classifyTender(r.title))
      for (const b of r.bidders) if (b && b !== r.winner) bump(v.rivals, b)
      // 成交價÷預算：越低代表殺價越兇。
      // 不用底價當分母——單價開口契約的底價是「單一品項」的，決標金額卻是全案總額，
      // 兩者不同基準，相除會出現 13 倍這種假數字；預算與決標金額才是同一個層級。
      if (r.awardAmount && r.budget) v.ratios.push(r.awardAmount / r.budget)
      map.set(r.winner, v)
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({
        name, ...v,
        top: (m: Map<string, number>) => Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—',
        ratio: v.ratios.length ? v.ratios.reduce((a, b) => a + b, 0) / v.ratios.length : null,
      }))
      .sort((a, b) => b.count - a.count || b.amount - a.amount)
  }, [awarded])

  const buyers = useMemo(() => {
    type B = {
      count: number; amount: number; dates: string[]; cats: Map<string, number>
      winners: Map<string, number>; city: string; customerId: string; customerName: string
    }
    const map = new Map<string, B>()
    for (const r of awarded) {
      const v: B = map.get(r.unitName) ?? {
        count: 0, amount: 0, dates: [], cats: new Map(), winners: new Map(),
        city: r.city, customerId: r.customerId, customerName: r.customerName,
      }
      v.count++
      v.amount += r.awardAmount ?? 0
      v.dates.push(r.date)
      v.cats.set(classifyTender(r.title), (v.cats.get(classifyTender(r.title)) ?? 0) + 1)
      if (r.winner) v.winners.set(r.winner, (v.winners.get(r.winner) ?? 0) + 1)
      if (r.customerId) { v.customerId = r.customerId; v.customerName = r.customerName }
      map.set(r.unitName, v)
    }
    return Array.from(map.entries()).map(([name, v]) => {
      const last = [...v.dates].sort().pop() ?? ''
      const gap = avgGap(v.dates)
      return {
        name, ...v, last, gap,
        nextGuess: gap && last ? new Date(new Date(last).getTime() + gap * 86400_000).toISOString().slice(0, 10) : '',
        topCat: Array.from(v.cats.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—',
        topWinner: Array.from(v.winners.entries()).sort((a, b) => b[1] - a[1])[0] ?? null,
      }
    }).sort((a, b) => b.count - a.count || b.amount - a.amount)
  }, [awarded])

  const categories = useMemo(() => {
    type C = { count: number; amount: number; vendors: Map<string, number> }
    const map = new Map<string, C>()
    for (const r of awarded) {
      const k = classifyTender(r.title)
      const v: C = map.get(k) ?? { count: 0, amount: 0, vendors: new Map() }
      v.count++; v.amount += r.awardAmount ?? 0
      if (r.winner) v.vendors.set(r.winner, (v.vendors.get(r.winner) ?? 0) + 1)
      map.set(k, v)
    }
    const total = awarded.length || 1
    return Array.from(map.entries()).map(([name, v]) => ({
      name, ...v, share: v.count / total,
      top3: Array.from(v.vendors.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3),
    })).sort((a, b) => b.count - a.count)
  }, [awarded])

  const totalAmount = awarded.reduce((a, r) => a + (r.awardAmount ?? 0), 0)
  const withPrice = awarded.filter((r) => r.awardAmount && r.budget)
  const avgRatio = withPrice.length
    ? withPrice.reduce((a, r) => a + (r.awardAmount! / r.budget!), 0) / withPrice.length : null
  const soloRate = awarded.length ? awarded.filter((r) => r.bidders.length <= 1).length / awarded.length : null
  const custRate = awarded.length ? awarded.filter((r) => r.customerId).length / awarded.length : null
  // 補齊度：這個區間的案子裡，有多少已經查到得標廠商（決標明細是逐案慢慢補的）
  const inWindow = records.filter((r) => r.date >= since).length
  const fillRate = inWindow ? awarded.length / inWindow : 0

  const tiles: [string, string, string][] = [
    ['決標總額', totalAmount ? wan(totalAmount) : '—', `${awarded.length} 件已查到得標廠商`],
    ['平均成交÷預算', avgRatio ? pct(avgRatio) : '—', '越低代表殺價越兇'],
    ['單一廠商投標', soloRate === null ? '—' : pct(soloRate), '只有一家投標的比例'],
    ['買主是既有客戶', custRate === null ? '—' : pct(custRate), '採購機關已在客戶庫'],
    ['資料補齊度', pct(fillRate), `近 ${years} 年共 ${inWindow} 案`],
  ]

  const chip = (on: boolean) =>
    `rounded-full px-3.5 py-1.5 text-sm font-medium transition-all active:scale-95 ${
      on ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-stone-500 hover:bg-stone-100'}`

  return (
    <div className="space-y-3">
      <div className="card-soft p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setTab('vendor')} className={chip(tab === 'vendor')}>得標廠商</button>
          <button onClick={() => setTab('buyer')} className={chip(tab === 'buyer')}>採購機關</button>
          <button onClick={() => setTab('category')} className={chip(tab === 'category')}>品類結構</button>
          <select value={years} onChange={(e) => setYears(Number(e.target.value))}
            className="select-soft ml-auto rounded-full px-3 py-1.5 text-sm">
            {[1, 2, 3, 5].map((y) => <option key={y} value={y}>近 {y} 年</option>)}
          </select>
        </div>
        <p className="mt-2 text-[11px] text-stone-400">
          母體：近 {years} 年已決標且查得到得標廠商的 {awarded.length} 案，決標總額 {wan(totalAmount)}
          {avgRatio && ``}
          　·　決標資料仍在逐案補齊中，數字會隨補齊而變動
        </p>
      </div>

      {awarded.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-400">還沒有決標資料可以分析（系統每三小時會補一批）</p>
      ) : tab === 'vendor' ? (
        <div className="card-soft overflow-x-auto p-4">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="text-stone-400">
              <tr className="text-left">
                <th className="pb-2 font-medium">得標廠商</th>
                <th className="pb-2 text-right font-medium">件數</th>
                <th className="pb-2 text-right font-medium">決標總額</th>
                <th className="pb-2 text-right font-medium">成交÷預算</th>
                <th className="pb-2 font-medium">主攻機關</th>
                <th className="pb-2 font-medium">主攻品類</th>
                <th className="pb-2 font-medium">主要地區</th>
                <th className="pb-2 font-medium">最常碰到的對手</th>
                <th className="pb-2 font-medium">最近得標</th>
              </tr>
            </thead>
            <tbody>
              {vendors.slice(0, 40).map((v) => (
                <tr key={v.name} className="border-t border-stone-100">
                  <td className="py-1.5 pr-2">
                    <button onClick={() => onPick(v.name)} className="text-left font-medium text-stone-700 underline decoration-stone-300 hover:text-brand-700">
                      {v.name}
                    </button>
                    {/崧達/.test(v.name) && <span className="ml-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">我們</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-stone-700">{v.count}</td>
                  <td className="py-1.5 text-right tabular-nums text-stone-600">{wan(v.amount)}</td>
                  <td className="py-1.5 text-right tabular-nums text-stone-500">{v.ratio ? pct(v.ratio) : '—'}</td>
                  <td className="py-1.5 text-stone-500">{v.top(v.buyers)}</td>
                  <td className="py-1.5 text-stone-500">{v.top(v.cats)}</td>
                  <td className="py-1.5 text-stone-500">{v.top(v.cities)}</td>
                  <td className="py-1.5 text-stone-400">{v.top(v.rivals)}</td>
                  <td className="py-1.5 tabular-nums text-stone-400">{v.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'buyer' ? (
        <div className="card-soft overflow-x-auto p-4">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="text-stone-400">
              <tr className="text-left">
                <th className="pb-2 font-medium">採購機關</th>
                <th className="pb-2 font-medium">類型</th>
                <th className="pb-2 text-right font-medium">件數</th>
                <th className="pb-2 text-right font-medium">決標總額</th>
                <th className="pb-2 font-medium">最近一次</th>
                <th className="pb-2 text-right font-medium">平均間隔</th>
                <th className="pb-2 font-medium">推估下次</th>
                <th className="pb-2 font-medium">主要品類</th>
                <th className="pb-2 font-medium">最常得標者</th>
              </tr>
            </thead>
            <tbody>
              {buyers.slice(0, 40).map((b) => (
                <tr key={b.name} className="border-t border-stone-100">
                  <td className="py-1.5 pr-2">
                    <button onClick={() => onPick(b.name)} className="text-left font-medium text-stone-700 underline decoration-stone-300 hover:text-brand-700">
                      {b.name}
                    </button>
                    {b.customerId && <span className="ml-1 rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] text-brand-700">既有客戶</span>}
                  </td>
                  <td className="py-1.5 text-stone-500">{classifyBuyer(b.name)}</td>
                  <td className="py-1.5 text-right tabular-nums text-stone-700">{b.count}</td>
                  <td className="py-1.5 text-right tabular-nums text-stone-600">{wan(b.amount)}</td>
                  <td className="py-1.5 tabular-nums text-stone-500">{b.last}</td>
                  <td className="py-1.5 text-right tabular-nums text-stone-500">{b.gap ? `${b.gap} 天` : '—'}</td>
                  <td className="py-1.5 tabular-nums text-amber-700">{b.nextGuess || '—'}</td>
                  <td className="py-1.5 text-stone-500">{b.topCat}</td>
                  <td className="py-1.5 text-stone-400">
                    {b.topWinner ? `${b.topWinner[0]}（${b.topWinner[1]}）` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card-soft p-4">
          <ul className="space-y-2">
            {categories.map((c) => (
              <li key={c.name} className="text-xs">
                <div className="flex items-baseline gap-2">
                  <span className="w-20 shrink-0 font-medium text-stone-700">{c.name}</span>
                  <span className="tabular-nums text-stone-500">{c.count} 件</span>
                  <span className="tabular-nums text-stone-400">{wan(c.amount)}</span>
                  <span className="ml-auto text-stone-400">
                    主要玩家：{c.top3.map(([n, k]) => `${n}(${k})`).join('、') || '—'}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full bg-brand-400" style={{ width: `${Math.max(c.share * 100, 1)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
