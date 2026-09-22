'use client'

/**
 * components/TendersContent.tsx — 標案機會（/bd?tab=tender）
 *
 * 政府電子採購網的牙科相關標案。
 * 第一期：清單、篩選、客戶比對標記（資料由每日排程抓取後存快取）。
 * 第二期：認領追蹤與狀態（待評估／投標中／已投標／得標／未得標／放棄）、備註、截止倒數。
 *   標案本身是外部事實（每天重抓），追蹤狀態是我們的決定（另存），重抓不會蓋掉人的操作。
 *   狀態轉為「投標中」且機關是既有客戶時，系統自動把開發階段推到「報價中」。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

type Tender = {
  id: string; unitName: string; title: string; type: string; date: string
  category: string; matched: string[]; tier: 1 | 2
  budget: number | null; budgetText: string; deadline: string
  address: string; city: string; district: string; contact: string; phone: string; url: string
  customerId: string; customerName: string; customerSalesperson: string; matchNote: string
}

const TYPE_BADGE = (t: string) =>
  /決標/.test(t) ? 'bg-stone-100 text-stone-600'
    : /無法決標|廢標/.test(t) ? 'bg-red-50 text-red-600'
      : /更正/.test(t) ? 'bg-amber-50 text-amber-700'
        : 'bg-brand-50 text-brand-700'

const money = (n: number | null, text: string) =>
  typeof n === 'number' ? `${(n / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 })} 萬` : (text || '—')

type Track = { tenderId: string; status: string; owner: string; note: string; updatedBy: string; updatedAt: string }
const STATUSES = ['待評估', '投標中', '已投標', '得標', '未得標', '放棄'] as const
const STATUS_STYLE: Record<string, string> = {
  待評估: 'bg-stone-100 text-stone-600', 投標中: 'bg-amber-50 text-amber-700',
  已投標: 'bg-blue-50 text-blue-700', 得標: 'bg-brand-50 text-emerald-700',
  未得標: 'bg-stone-100 text-stone-500', 放棄: 'bg-stone-100 text-stone-400',
}

/** 截止倒數：負數＝已過期 */
const daysLeft = (deadline: string) => {
  if (!deadline) return null
  const d = new Date(deadline.replace(/\//g, '-').slice(0, 10))
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400_000)
}

export default function TendersContent({ canManageAll = false, currentUser = '' }: {
  canManageAll?: boolean; currentUser?: string
}) {
  const [records, setRecords] = useState<Tender[]>([])
  const [tracks, setTracks] = useState<Record<string, Track>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('全部')
  const [computedAt, setComputedAt] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState('')

  const [stage, setStage] = useState<'open' | 'awarded' | 'all'>('open')
  const [onlyCustomer, setOnlyCustomer] = useState(false)
  const [onlyMine, setOnlyMine] = useState(false)
  const [city, setCity] = useState('全部')
  const [q, setQ] = useState('')

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true)
    setErr('')
    try {
      const res = await fetch(`/api/bd/tenders${refresh ? '?refresh=1' : ''}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '讀取失敗')
      setRecords(data.records ?? [])
      setTracks(data.tracks ?? {})
      setComputedAt(data.computedAt ?? '')
    } catch (e: any) {
      setErr(e?.message ?? '讀取失敗')
    } finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function track(r: Tender, patch: { status?: string; owner?: string | null; note?: string }) {
    setBusy(r.id); setErr('')
    try {
      const res = await fetch('/api/bd/tenders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenderId: r.id, customerId: r.customerId || undefined, ...patch }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? '更新失敗'); return }
      setTracks((prev) => ({ ...prev, [r.id]: data.track }))
    } catch (e: any) { setErr(e?.message ?? '更新失敗') }
    finally { setBusy(null) }
  }

  const cities = useMemo(
    () => ['全部', ...Array.from(new Set(records.map((r) => r.city).filter(Boolean))).sort()],
    [records])

  const shown = useMemo(() => records.filter((r) => {
    const awarded = /決標/.test(r.type)
    if (stage === 'open' && awarded) return false
    if (stage === 'awarded' && !awarded) return false
    if (onlyCustomer && !r.customerId) return false
    const t = tracks[r.id]
    if (statusFilter !== '全部' && (t?.status ?? '待評估') !== statusFilter) return false
    if (onlyMine && r.customerSalesperson !== currentUser && t?.owner !== currentUser) return false
    if (city !== '全部' && r.city !== city) return false
    if (q && !(r.title.includes(q) || r.unitName.includes(q) || r.customerName.includes(q))) return false
    return true
  }), [records, tracks, stage, onlyCustomer, onlyMine, statusFilter, city, q, currentUser])

  const matchedCount = records.filter((r) => r.customerId).length

  return (
    <div className="space-y-4">
      <div className="card-soft p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-base font-semibold text-stone-800">🏛️ 標案機會</h3>
          <span className="text-xs text-stone-400">
            政府電子採購網的牙科相關標案　共 {records.length} 案，其中 {matchedCount} 案的機關是我們的客戶
          </span>
          {canManageAll && (
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="ml-auto rounded-full bg-stone-50 px-4 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-stone-200 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95 disabled:opacity-50"
            >{refreshing ? '重抓中…（約 1 分鐘）' : '立即重抓'}</button>
          )}
        </div>
        {computedAt && (
          <p className="mt-1 text-[11px] text-stone-400">
            資料更新：{new Date(computedAt).toLocaleString('zh-TW', { hour12: false })}　·　每日自動更新
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {([['open', '招標中'], ['awarded', '已決標'], ['all', '全部']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setStage(v)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-all active:scale-95 ${
                stage === v ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-stone-500 hover:bg-stone-100'
              }`}>{label}</button>
          ))}
          <button onClick={() => setOnlyCustomer((v) => !v)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-all active:scale-95 ${
              onlyCustomer ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-stone-500 hover:bg-stone-100'
            }`}>只看既有客戶</button>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="select-soft text-sm py-1.5 px-3 rounded-full">
            {['全部', ...STATUSES].map((s2) => <option key={s2} value={s2}>{s2 === '全部' ? '全部狀態' : s2}</option>)}
          </select>
          {currentUser && (
            <button onClick={() => setOnlyMine((v) => !v)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-all active:scale-95 ${
                onlyMine ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-stone-500 hover:bg-stone-100'
              }`}>我的（客戶或我認領的）</button>
          )}
          <select value={city} onChange={(e) => setCity(e.target.value)} className="select-soft text-sm py-1.5 px-3 rounded-full">
            {cities.map((c) => <option key={c} value={c}>{c === '全部' ? '全部縣市' : c}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋標案或機關"
            className="input-soft ml-auto text-sm py-1.5 px-4 rounded-full min-w-[180px] flex-1" />
        </div>
      </div>

      {err && <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{err}</div>}

      {loading ? (
        <p className="py-12 text-center text-sm text-stone-400">載入中…</p>
      ) : records.length === 0 ? (
        <div className="card-soft p-8 text-center text-sm text-stone-400">
          <div className="mb-2 text-3xl">🏛️</div>
          <p>尚未產生標案清單</p>
          {canManageAll && <p className="mt-1 text-xs">點「立即重抓」建立第一份（之後每日自動更新）</p>}
        </div>
      ) : shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-stone-400">沒有符合篩選的標案</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={r.id} className="card-soft p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_BADGE(r.type)}`}>{r.type}</span>
                <span className="font-semibold text-stone-800">{r.title}</span>
                {r.tier === 2 && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-500">設備／耗材關鍵字</span>}
                <span className="ml-auto text-sm font-semibold tabular-nums text-brand-700">{money(r.budget, r.budgetText)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                <span>{r.unitName}</span>
                {r.city && <span className="text-stone-400">{r.city}{r.district}</span>}
                <span className="text-stone-400">公告 {r.date}</span>
                {r.deadline && (() => {
                  const d = daysLeft(r.deadline)
                  const cls = d === null ? 'text-amber-700' : d < 0 ? 'text-stone-400' : d <= 7 ? 'text-red-600 font-semibold' : 'text-amber-700'
                  return <span className={cls}>截止 {r.deadline}{d !== null && (d < 0 ? '（已過）' : d === 0 ? '（今天）' : `（剩 ${d} 天）`)}</span>
                })()}
                {r.contact && <span className="text-stone-400">{r.contact} {r.phone}</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {r.customerId ? (
                  <>
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">既有客戶</span>
                    <a href={`/customers/${r.customerId}`} target="_blank" rel="noreferrer"
                      className="text-stone-500 underline hover:text-stone-700">{r.customerName}</a>
                    {r.customerSalesperson && <span className="text-stone-400">負責：{r.customerSalesperson}</span>}
                  </>
                ) : (
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-500">{r.matchNote || '未配對客戶'}</span>
                )}
                {r.category && <span className="text-stone-400">{r.category}</span>}
                {r.url && (
                  <a href={r.url} target="_blank" rel="noreferrer"
                    className="ml-auto rounded-full bg-stone-50 px-3 py-1 font-medium text-stone-600 ring-1 ring-stone-200 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95">
                    看公告原文
                  </a>
                )}
              </div>

              {/* 追蹤列：認領、狀態、備註 */}
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-2 text-xs">
                {(() => {
                  const t = tracks[r.id]
                  const st = t?.status ?? '待評估'
                  return (
                    <>
                      <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[st] ?? 'bg-stone-100 text-stone-600'}`}>{st}</span>
                      <select
                        value={st}
                        disabled={busy === r.id}
                        onChange={(e) => track(r, { status: e.target.value })}
                        className="select-soft text-xs py-1 px-2.5 rounded-full disabled:opacity-50"
                      >
                        {STATUSES.map((s2) => <option key={s2} value={s2}>{s2}</option>)}
                      </select>
                      {t?.owner
                        ? (
                          <>
                            <span className="text-stone-500">追蹤：{t.owner}</span>
                            {t.owner === currentUser && (
                              <button disabled={busy === r.id} onClick={() => track(r, { owner: null })}
                                className="text-stone-400 underline hover:text-stone-600 disabled:opacity-50">取消認領</button>
                            )}
                          </>
                        )
                        : currentUser && (
                          <button disabled={busy === r.id} onClick={() => track(r, { owner: currentUser })}
                            className="rounded-full bg-brand-500 px-3 py-1 font-medium text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50">
                            認領追蹤
                          </button>
                        )}
                      <input
                        defaultValue={t?.note ?? ''}
                        placeholder="備註（例：已索取規格書）"
                        onBlur={(e) => { if (e.target.value !== (t?.note ?? '')) track(r, { note: e.target.value }) }}
                        className="input-soft ml-auto min-w-[160px] flex-1 rounded-full px-3 py-1 text-xs"
                      />
                      {t?.updatedAt && (
                        <span className="text-[10px] text-stone-300">
                          {t.updatedBy}·{t.updatedAt.slice(5, 10)}
                        </span>
                      )}
                    </>
                  )
                })()}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-stone-400">
        資料來源：行政院公共工程委員會政府電子採購網（經 g0v／openfun 標案 API 收集）。
        關鍵字分兩級：牙科、齒模、義齒等直接收；3D列印機、光固化、樹脂等設備耗材詞
        必須同時命中牙科情境（標題或機關有牙科字樣／標的分類屬醫療類／機關為醫院、衛生所、牙體技術科系）才收——
        實測「3D列印機」全站 1,185 案中只有 6% 與牙科有關。
      </p>
    </div>
  )
}
