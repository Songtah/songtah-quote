'use client'

/**
 * components/TendersContent.tsx — 標案機會（/bd?tab=tender）
 *
 * 兩個分頁：
 *   機會清單 — 系統每兩小時自動抓回來的牙科相關標案（含決標結果），列表**常駐**，
 *              開頁只讀已存的結果，不會重跑掃描；要不要手動抓由中央管理自己決定。
 *   歷史查詢 — 人主動查「以前有沒有這種標案」，直接查政府電子採購網官網，
 *              查到的案子可以一鍵加入追蹤。
 *
 * 標案本身是外部事實（排程重抓），追蹤狀態是我們的決定（另存），重抓不會蓋掉人的操作。
 * 狀態轉為「投標中」且機關是既有客戶時，系統自動把開發階段推到「報價中」。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import TenderMarketPanel from './TenderMarketPanel'

type Tender = {
  id: string; pageId: string; status: string; owner: string; note: string; weBid: boolean
  unitId: string; jobNumber: string
  unitName: string; title: string; type: string; date: string
  category: string; matched: string[]; tier: 1 | 2
  budget: number | null; budgetText: string; deadline: string
  address: string; city: string; district: string; contact: string; phone: string; url: string
  winner: string; awardAmount: number | null; basePrice: number | null; bidders: string[]
  customerId: string; customerName: string; customerSalesperson: string; matchNote: string
}

type SearchHit = {
  url: string; unitName: string; jobNumber: string; title: string
  type: string; date: string; deadline: string; inDb: boolean
}

const TYPE_BADGE = (t: string) =>
  /無法決標|廢標/.test(t) ? 'bg-red-50 text-red-600'
    : /決標/.test(t) ? 'bg-stone-100 text-stone-600'
      : /更正/.test(t) ? 'bg-amber-50 text-amber-700'
        : 'bg-brand-50 text-brand-700'

/** 公告類型字串很長（「經公開評選或公開徵求之限制性招標更正公告」），標籤只取要點 */
const shortType = (t: string) =>
  /無法決標/.test(t) ? '無法決標' : /決標/.test(t) ? '決標' : /更正/.test(t) ? '更正公告' : '招標'

const money = (n: number | null, text: string) =>
  typeof n === 'number' ? `${(n / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 })} 萬` : (text || '—')

const STATUSES = ['待評估', '投標中', '已投標', '得標', '未得標', '放棄'] as const
const STATUS_STYLE: Record<string, string> = {
  待評估: 'bg-stone-100 text-stone-600', 投標中: 'bg-amber-50 text-amber-700',
  已投標: 'bg-blue-50 text-blue-700', 得標: 'bg-emerald-50 text-emerald-700',
  未得標: 'bg-stone-100 text-stone-500', 放棄: 'bg-stone-100 text-stone-400',
}

/** 截止倒數：負數＝已過期 */
const daysLeft = (deadline: string) => {
  if (!deadline) return null
  const d = new Date(deadline.replace(/\//g, '-').slice(0, 10))
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86400_000)
}

const chip = (on: boolean) =>
  `rounded-full px-3.5 py-1.5 text-sm font-medium transition-all active:scale-95 ${
    on ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-stone-500 hover:bg-stone-100'}`

export default function TendersContent({ canManageAll = false, currentUser = '' }: {
  canManageAll?: boolean; currentUser?: string
}) {
  const [view, setView] = useState<'list' | 'market' | 'search'>('list')

  const [records, setRecords] = useState<Tender[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [computedAt, setComputedAt] = useState('')
  const [latestDate, setLatestDate] = useState('')
  const [staleDays, setStaleDays] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState('')

  const [stage, setStage] = useState<'open' | 'awarded' | 'all'>('open')
  const [year, setYear] = useState('全部')
  const [limit, setLimit] = useState(150)
  const [statusFilter, setStatusFilter] = useState<string>('全部')
  const [onlyCustomer, setOnlyCustomer] = useState(false)
  const [onlyMine, setOnlyMine] = useState(false)
  const [city, setCity] = useState('全部')
  const [q, setQ] = useState('')

  /** 開頁只讀已存結果；refresh=true 才會去抓新公告（中央管理限定） */
  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true)
    setErr('')
    try {
      const res = await fetch(`/api/bd/tenders${refresh ? '?refresh=1' : ''}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '讀取失敗')
      setRecords(data.records ?? [])
      setComputedAt(data.computedAt ?? '')
      setLatestDate(data.latestAnnouncementDate ?? '')
      setStaleDays(data.staleDays ?? 0)
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
        body: JSON.stringify({ pageId: r.pageId, customerId: r.customerId || undefined, ...patch }),
      })
      const data = await res.json()
      if (!res.ok) { setErr(data.error ?? '更新失敗'); return }
      setRecords((prev) => prev.map((x) => x.id === r.id ? {
        ...x,
        status: patch.status ?? x.status,
        owner: patch.owner === null ? '' : (patch.owner ?? x.owner),
        note: patch.note ?? x.note,
      } : x))
    } catch (e: any) { setErr(e?.message ?? '更新失敗') }
    finally { setBusy(null) }
  }

  const cities = useMemo(
    () => ['全部', ...Array.from(new Set(records.map((r) => r.city).filter(Boolean))).sort()],
    [records])

  const years = useMemo(
    () => ['全部', ...Array.from(new Set(records.map((r) => r.date.slice(0, 4)).filter(Boolean))).sort().reverse()],
    [records])

  const today = new Date().toISOString().slice(0, 10)
  const shown = useMemo(() => records.filter((r) => {
    const awarded = /決標/.test(r.type)
    // 「進行中」＝還沒決標、而且還來得及投（沒寫截止日的就看公告日是不是近 30 天）
    const live = !awarded && (r.deadline ? r.deadline >= today : r.date >= new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10))
    if (stage === 'open' && !live) return false
    if (stage === 'awarded' && !awarded) return false
    if (year !== '全部' && !r.date.startsWith(year)) return false
    if (onlyCustomer && !r.customerId) return false
    if (statusFilter !== '全部' && (r.status || '待評估') !== statusFilter) return false
    if (onlyMine && r.customerSalesperson !== currentUser && r.owner !== currentUser) return false
    if (city !== '全部' && r.city !== city) return false
    if (q && !(r.title.includes(q) || r.unitName.includes(q) || r.jobNumber.includes(q)
      || r.customerName.includes(q) || r.winner.includes(q) || r.bidders.some((b) => b.includes(q)))) return false
    return true
  }), [records, stage, year, onlyCustomer, onlyMine, statusFilter, city, q, currentUser, today])

  /** 已決標檢視的廠商排行：這是我們唯一能看到競爭對手實績的地方 */
  const winnerRank = useMemo(() => {
    if (stage !== 'awarded') return []
    const map = new Map<string, { count: number; amount: number }>()
    for (const r of shown) {
      if (!r.winner) continue
      const cur = map.get(r.winner) ?? { count: 0, amount: 0 }
      cur.count++; cur.amount += r.awardAmount ?? 0
      map.set(r.winner, cur)
    }
    return Array.from(map.entries()).sort((a, b) => b[1].count - a[1].count || b[1].amount - a[1].amount).slice(0, 10)
  }, [shown, stage])

  const matchedCount = records.filter((r) => r.customerId).length
  const liveCount = records.filter((r) => !/決標/.test(r.type)
    && (r.deadline ? r.deadline >= today : r.date >= new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10))).length

  return (
    <div className="space-y-4">
      {/* ── 頁首：資料狀態與分頁切換 ───────────────────────────── */}
      <div className="card-soft p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-base font-semibold text-stone-800">🏛️ 標案機會</h3>
          <span className="text-xs text-stone-400">
            政府電子採購網的牙科相關標案　共 {records.length} 案（進行中 {liveCount}）·　{matchedCount} 案的機關是我們的客戶
          </span>
          {canManageAll && view === 'list' && (
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              title="平常不需要按：系統每兩小時自動抓一次"
              className="ml-auto rounded-full bg-stone-50 px-4 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-stone-200 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95 disabled:opacity-50"
            >{refreshing ? '抓取中…（約 1 分鐘）' : '手動抓新公告'}</button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-stone-400">
          {computedAt ? `清單更新：${new Date(computedAt).toLocaleString('zh-TW', { hour12: false })}` : '尚未有資料'}
          {latestDate && `　·　最新公告日：${latestDate}`}
          　·　每兩小時自動更新（08–20 時），結果常駐，開頁不會重跑
        </p>
        {staleDays > 7 && (
          <p className="mt-1 rounded-xl bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
            ⚠️ 最新公告已是 {staleDays} 天前——可能來源未更新或抓取被擋，請按「手動抓新公告」確認。
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => setView('list')} className={chip(view === 'list')}>機會清單</button>
          <button onClick={() => setView('market')} className={chip(view === 'market')}>市場分析</button>
          <button onClick={() => setView('search')} className={chip(view === 'search')}>歷史查詢</button>
        </div>
      </div>

      {err && <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{err}</div>}

      {view === 'search' ? (
        <TenderSearch canEdit={Boolean(currentUser)} onImported={() => load()} />
      ) : view === 'market' ? (
        <TenderMarketPanel
          records={records}
          onPick={(name) => { setQ(name); setStage('all'); setView('list') }}
        />
      ) : (
        <>
          {/* ── 篩選 ───────────────────────────── */}
          <div className="card-soft p-4">
            <div className="flex flex-wrap items-center gap-2">
              {([['open', '進行中'], ['awarded', '已決標'], ['all', '全部']] as const).map(([v, label]) => (
                <button key={v} onClick={() => setStage(v)} className={chip(stage === v)}>{label}</button>
              ))}
              <span className="mx-1 h-5 w-px bg-stone-200" />
              <button onClick={() => setOnlyCustomer((v) => !v)} className={chip(onlyCustomer)}>只看既有客戶</button>
              {currentUser && (
                <button onClick={() => setOnlyMine((v) => !v)} className={chip(onlyMine)}>我的</button>
              )}
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="select-soft rounded-full px-3 py-1.5 text-sm">
                {['全部', ...STATUSES].map((s) => <option key={s} value={s}>{s === '全部' ? '全部狀態' : s}</option>)}
              </select>
              <select value={city} onChange={(e) => setCity(e.target.value)}
                className="select-soft rounded-full px-3 py-1.5 text-sm">
                {cities.map((c) => <option key={c} value={c}>{c === '全部' ? '全部縣市' : c}</option>)}
              </select>
              <select value={year} onChange={(e) => setYear(e.target.value)}
                className="select-soft rounded-full px-3 py-1.5 text-sm">
                {years.map((y) => <option key={y} value={y}>{y === '全部' ? '全部年度' : `${y} 年`}</option>)}
              </select>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋標案、機關、案號或廠商"
                className="input-soft ml-auto min-w-[200px] flex-1 rounded-full px-4 py-1.5 text-sm" />
            </div>
            <p className="mt-2 text-[11px] text-stone-400">
              符合 {shown.length} 案 / 全部 {records.length} 案{shown.length > limit && `（先顯示前 ${limit} 案）`}
            </p>
          </div>

          {/* 得標廠商排行：看同業在這些標案拿走多少，是唯一能量化競爭對手的地方 */}
          {winnerRank.length > 0 && (
            <div className="card-soft p-4">
              <h4 className="text-sm font-semibold text-stone-800">得標廠商排行（符合篩選的 {shown.filter((r) => r.winner).length} 件決標案）</h4>
              <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {winnerRank.map(([name, v], i) => (
                  <li key={name} className="flex items-baseline gap-2 text-xs">
                    <span className="w-5 tabular-nums text-stone-400">{i + 1}.</span>
                    <button onClick={() => setQ(name)} className="truncate text-stone-700 underline decoration-stone-300 hover:text-brand-700">{name}</button>
                    <span className="ml-auto shrink-0 tabular-nums text-stone-500">{v.count} 件</span>
                    {v.amount > 0 && <span className="w-20 shrink-0 text-right tabular-nums text-stone-400">{(v.amount / 10000).toLocaleString(undefined, { maximumFractionDigits: 0 })} 萬</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {loading ? (
            <p className="py-12 text-center text-sm text-stone-400">載入中…</p>
          ) : records.length === 0 ? (
            <div className="card-soft p-8 text-center text-sm text-stone-400">
              <div className="mb-2 text-3xl">🏛️</div>
              <p>還沒有標案資料</p>
              <p className="mt-1 text-xs">排程每兩小時會自動抓一次；也可以用「歷史查詢」先找舊案子</p>
            </div>
          ) : shown.length === 0 ? (
            <p className="py-12 text-center text-sm text-stone-400">沒有符合篩選的標案</p>
          ) : (
            <ul className="space-y-2">
              {shown.slice(0, limit).map((r) => (
                <li key={r.id} className="card-soft p-4">
                  {/* 標題列 */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_BADGE(r.type)}`}
                      title={r.type}>{shortType(r.type)}</span>
                    <span className="font-semibold text-stone-800">{r.title || '（標案名稱未取得）'}</span>
                    {r.tier === 2 && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-500">設備／耗材關鍵字</span>}
                    {r.weBid && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">崧達曾投標</span>}
                    <span className="ml-auto text-sm font-semibold tabular-nums text-brand-700">{money(r.budget, r.budgetText)}</span>
                  </div>

                  {/* 事實列 */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                    <span>{r.unitName}</span>
                    {r.city && <span className="text-stone-400">{r.city}{r.district}</span>}
                    <span className="text-stone-400 tabular-nums">案號 {r.jobNumber}</span>
                    <span className="text-stone-400 tabular-nums">公告 {r.date}</span>
                    {r.deadline && (() => {
                      const d = daysLeft(r.deadline)
                      const cls = d === null ? 'text-amber-700' : d < 0 ? 'text-stone-400' : d <= 7 ? 'font-semibold text-red-600' : 'text-amber-700'
                      return <span className={cls}>截止 {r.deadline}{d !== null && (d < 0 ? '（已過）' : d === 0 ? '（今天）' : `（剩 ${d} 天）`)}</span>
                    })()}
                    {r.contact && <span className="text-stone-400">{r.contact} {r.phone}</span>}
                    {!r.unitId && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] text-stone-400">明細待補</span>}
                  </div>

                  {/* 決標結果：得標廠商、決標金額、底價、同場競標（競爭對手情報） */}
                  {r.winner && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-stone-50 px-3 py-1.5 text-xs">
                      <span className="text-stone-500">得標：<strong className="text-stone-700">{r.winner}</strong></span>
                      {r.awardAmount && <span className="text-stone-500">決標 <span className="tabular-nums text-stone-700">{money(r.awardAmount, '')}</span></span>}
                      {r.basePrice && <span className="text-stone-400">底價 <span className="tabular-nums">{money(r.basePrice, '')}</span></span>}
                      {r.bidders.length > 1 && (
                        <span className="text-stone-400">同場競標：{r.bidders.filter((b) => b !== r.winner).join('、')}</span>
                      )}
                    </div>
                  )}

                  {/* 客戶配對 */}
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

                  {/* 追蹤列：狀態、認領、備註 */}
                  <div className="mt-2 space-y-2 border-t border-stone-100 pt-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[r.status || '待評估'] ?? 'bg-stone-100 text-stone-600'}`}>
                        {r.status || '待評估'}
                      </span>
                      <select
                        value={r.status || '待評估'}
                        disabled={busy === r.id}
                        onChange={(e) => track(r, { status: e.target.value })}
                        className="select-soft rounded-full px-2.5 py-1 text-xs disabled:opacity-50"
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      {r.owner ? (
                        <>
                          <span className="text-stone-500">追蹤：{r.owner}</span>
                          {r.owner === currentUser && (
                            <button disabled={busy === r.id} onClick={() => track(r, { owner: null })}
                              className="text-stone-400 underline hover:text-stone-600 disabled:opacity-50">取消認領</button>
                          )}
                        </>
                      ) : currentUser && (
                        <button disabled={busy === r.id} onClick={() => track(r, { owner: currentUser })}
                          className="rounded-full bg-brand-500 px-3 py-1 font-medium text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50">
                          認領追蹤
                        </button>
                      )}
                    </div>
                    <input
                      key={`${r.id}-note`}
                      defaultValue={r.note ?? ''}
                      placeholder="備註（例：已索取規格書）"
                      onBlur={(e) => { if (e.target.value !== (r.note ?? '')) track(r, { note: e.target.value }) }}
                      className="input-soft w-full rounded-full px-3 py-1 text-xs"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {shown.length > limit && (
            <button onClick={() => setLimit((v) => v + 300)}
              className="mx-auto block rounded-full bg-stone-50 px-5 py-2 text-sm font-medium text-stone-600 ring-1 ring-stone-200 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95">
              顯示更多（還有 {shown.length - limit} 案）
            </button>
          )}
        </>
      )}

      <p className="text-[11px] leading-relaxed text-stone-400">
        資料來源：行政院公共工程委員會政府電子採購網（web.pcc.gov.tw）公告查詢。
        自動抓取的關鍵字分兩級：牙科、齒模、義齒等直接收；3D列印機、光固化、樹脂等設備耗材詞
        必須同時命中牙科情境（標題或機關有牙科字樣／標的分類屬醫療類／機關為醫院、衛生所、牙體技術科系）才收——
        實測「3D列印機」全站 1,185 案中只有 6% 與牙科有關。官網只能用標案名稱查詢，
        標題沒寫關鍵字的案子（例如夾在綜合醫材開口合約裡的牙科品項）仍可能漏掉，可用「歷史查詢」自行補查。
      </p>
    </div>
  )
}

/** 歷史查詢：直接問官網，查到的案子可一鍵加入追蹤 */
function TenderSearch({ canEdit, onImported }: { canEdit: boolean; onImported: () => void }) {
  const thisRoc = new Date().getFullYear() - 1911
  const [keyword, setKeyword] = useState('牙科')
  const [kind, setKind] = useState<'招標' | '決標'>('招標')
  const [year, setYear] = useState(thisRoc)
  const [rows, setRows] = useState<SearchHit[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState<string | null>(null)

  async function run() {
    if (!keyword.trim()) return
    setLoading(true); setErr(''); setRows(null)
    try {
      const res = await fetch(`/api/bd/tenders/search?q=${encodeURIComponent(keyword.trim())}&kind=${kind}&year=${year}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '查詢失敗')
      setRows(data.results ?? [])
    } catch (e: any) { setErr(e?.message ?? '查詢失敗') }
    finally { setLoading(false) }
  }

  async function add(hit: SearchHit) {
    setAdding(hit.url); setErr('')
    try {
      const res = await fetch('/api/bd/tenders/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(hit),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '加入失敗')
      setRows((prev) => prev?.map((x) => x.url === hit.url ? { ...x, inDb: true } : x) ?? prev)
      onImported()
    } catch (e: any) { setErr(e?.message ?? '加入失敗') }
    finally { setAdding(null) }
  }

  return (
    <div className="space-y-3">
      <div className="card-soft p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run() }}
            placeholder="標案名稱關鍵字（例：牙科、義齒、口腔）"
            className="input-soft min-w-[220px] flex-1 rounded-full px-4 py-1.5 text-sm"
          />
          <select value={kind} onChange={(e) => setKind(e.target.value as '招標' | '決標')}
            className="select-soft rounded-full px-3 py-1.5 text-sm">
            <option value="招標">招標公告</option>
            <option value="決標">決標公告</option>
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="select-soft rounded-full px-3 py-1.5 text-sm">
            {Array.from({ length: 6 }, (_, i) => thisRoc - i).map((y) => (
              <option key={y} value={y}>民國 {y} 年</option>
            ))}
          </select>
          <button onClick={run} disabled={loading}
            className="rounded-full bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50">
            {loading ? '查詢中…' : '查詢'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-stone-400">
          直接查官網，依公告日新到舊最多 100 筆／年。查詢結果不會自動進系統——按「加入追蹤」才會存進標案清單。
        </p>
      </div>

      {err && <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{err}</div>}

      {rows && (rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-400">查無資料</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((h) => (
            <li key={h.url} className="card-soft flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-xs">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_BADGE(h.type)}`} title={h.type}>
                {shortType(h.type)}
              </span>
              <span className="text-sm font-medium text-stone-800">{h.title || '（標案名稱未取得）'}</span>
              <span className="text-stone-500">{h.unitName}</span>
              <span className="text-stone-400 tabular-nums">案號 {h.jobNumber}</span>
              <span className="text-stone-400 tabular-nums">{h.date}</span>
              {h.deadline && <span className="text-stone-400 tabular-nums">截止 {h.deadline}</span>}
              <a href={h.url} target="_blank" rel="noreferrer"
                className="ml-auto rounded-full bg-stone-50 px-3 py-1 font-medium text-stone-600 ring-1 ring-stone-200 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95">
                看公告原文
              </a>
              {h.inDb ? (
                <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-700">已在清單</span>
              ) : canEdit && (
                <button onClick={() => add(h)} disabled={adding === h.url}
                  className="rounded-full bg-brand-500 px-3 py-1 font-medium text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50">
                  {adding === h.url ? '加入中…' : '加入追蹤'}
                </button>
              )}
            </li>
          ))}
        </ul>
      ))}
    </div>
  )
}
