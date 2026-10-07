'use client'

/**
 * components/TendersContent.tsx — 標案機會（/bd?tab=tender）
 *
 * 三個分頁：
 *   機會清單 — 系統每兩小時自動抓回來的牙科相關標案（含決標結果），列表**常駐**，
 *              開頁只讀已存的結果，不會重跑掃描；要不要手動抓由中央管理自己決定。
 *              卡片分層（2026-10-07 版面整理）：預設只露判斷要不要追的資訊，細節收在「詳情」。
 *   市場分析 — 得標廠商／採購機關／品類結構（TenderMarketPanel）
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
  已投標: 'bg-gold-50 text-gold-700', 得標: 'bg-emerald-50 text-emerald-700',
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
  const [limit, setLimit] = useState(60)
  const [statusFilter, setStatusFilter] = useState<string>('全部')
  const [onlyCustomer, setOnlyCustomer] = useState(false)
  const [onlyMine, setOnlyMine] = useState(false)
  const [onlySoon, setOnlySoon] = useState(false)
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
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  // 「進行中」＝還沒決標、而且還來得及投（沒寫截止日的就看公告日是不是近 30 天）
  const isLive = useCallback((r: Tender) => !/決標/.test(r.type) && (r.deadline ? r.deadline >= today : r.date >= monthAgo), [today, monthAgo])
  const isSoon = useCallback((r: Tender) => { const d = daysLeft(r.deadline); return isLive(r) && d !== null && d >= 0 && d <= 7 }, [isLive])

  const shown = useMemo(() => {
    const list = records.filter((r) => {
      const awarded = /決標/.test(r.type)
      if (stage === 'open' && !isLive(r)) return false
      if (stage === 'awarded' && !awarded) return false
      if (onlySoon && !isSoon(r)) return false
      if (year !== '全部' && !r.date.startsWith(year)) return false
      if (onlyCustomer && !r.customerId) return false
      if (statusFilter !== '全部' && (r.status || '待評估') !== statusFilter) return false
      if (onlyMine && r.customerSalesperson !== currentUser && r.owner !== currentUser) return false
      if (city !== '全部' && r.city !== city) return false
      if (q && !(r.title.includes(q) || r.unitName.includes(q) || r.jobNumber.includes(q)
        || r.customerName.includes(q) || r.winner.includes(q) || r.bidders.some((b) => b.includes(q)))) return false
      return true
    })
    // 進行中：最快截止的排最前（要先處理的在上面）；其餘維持公告日新→舊
    if (stage === 'open') list.sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'))
    return list
  }, [records, stage, year, onlyCustomer, onlyMine, onlySoon, statusFilter, city, q, currentUser, isLive, isSoon])

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

  const liveCount = records.filter(isLive).length
  const soonCount = records.filter(isSoon).length
  const matchedLive = records.filter((r) => isLive(r) && r.customerId).length

  const activeFilters = [year !== '全部', statusFilter !== '全部', onlyCustomer, onlyMine, onlySoon, city !== '全部', !!q].filter(Boolean).length
  function clearFilters() {
    setYear('全部'); setStatusFilter('全部'); setOnlyCustomer(false); setOnlyMine(false); setOnlySoon(false); setCity('全部'); setQ('')
  }

  return (
    <div className="space-y-4">
      {/* ── 頁首：分頁切換＋資料狀態（標題已在頁面上方，不重複）──────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full bg-stone-100 p-1">
          {([['list', '機會清單'], ['market', '市場分析'], ['search', '歷史查詢']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all active:scale-95 ${
                view === v ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>{label}</button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-stone-400"
          title={`每兩小時自動更新（08–20 時）${latestDate ? `；最新公告日 ${latestDate}` : ''}`}>
          {computedAt ? `更新於 ${new Date(computedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}` : '尚未有資料'}
        </span>
        {canManageAll && view === 'list' && (
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            title="平常不需要按：系統每兩小時自動抓一次"
            className="rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-stone-600 ring-1 ring-stone-200 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95 disabled:opacity-50"
          >{refreshing ? '抓取中…' : '抓新公告'}</button>
        )}
      </div>

      {staleDays > 7 && (
        <p className="rounded-xl bg-amber-50 px-4 py-2 text-xs text-amber-700">
          ⚠️ 最新公告已是 {staleDays} 天前——可能來源未更新或抓取被擋{canManageAll ? '，請按「抓新公告」確認' : '，請通知中央管理'}。
        </p>
      )}
      {err && <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{err}</div>}

      {view === 'search' ? (
        <TenderSearch canEdit={Boolean(currentUser)} onImported={() => load()} />
      ) : view === 'market' ? (
        <TenderMarketPanel
          records={records}
          onPick={(name) => { clearFilters(); setQ(name); setStage('all'); setView('list') }}
        />
      ) : (
        <>
          {/* ── 重點數字（點了直接套用篩選）──────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            {([
              ['進行中', liveCount, '還來得及投', stage === 'open' && !onlySoon && !onlyCustomer, () => { clearFilters(); setStage('open') }, 'text-stone-800'],
              ['7 天內截止', soonCount, '要先處理', onlySoon, () => { clearFilters(); setStage('open'); setOnlySoon(true) }, soonCount ? 'text-red-600' : 'text-stone-800'],
              ['機關是客戶', matchedLive, '進行中且已在客戶庫', onlyCustomer && stage === 'open', () => { clearFilters(); setStage('open'); setOnlyCustomer(true) }, 'text-brand-700'],
            ] as const).map(([label, n, sub, on, onClick, accent]) => (
              <button key={label} onClick={onClick}
                className={`card-soft card-soft-hover p-3 text-left transition-all active:scale-[0.98] ${on ? 'ring-2 ring-brand-300' : ''}`}>
                <span className="block text-xs text-stone-400">{label}</span>
                <span className={`block text-2xl font-bold tabular-nums ${accent}`}>{n}</span>
                <span className="hidden text-[11px] text-stone-400 sm:block">{sub}</span>
              </button>
            ))}
          </div>

          {/* ── 篩選：第一列階段＋搜尋，第二列細項 ───────────────────── */}
          <div className="card-soft space-y-3 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-full bg-stone-100 p-1">
                {([['open', '進行中'], ['awarded', '已決標'], ['all', '全部']] as const).map(([v, label]) => (
                  <button key={v} onClick={() => { setStage(v); if (v !== 'open') setOnlySoon(false) }}
                    className={`rounded-full px-3.5 py-1 text-sm font-medium transition-all active:scale-95 ${
                      stage === v ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>{label}</button>
                ))}
              </div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋標案、機關、案號或廠商"
                className="input-soft min-w-[180px] flex-1 rounded-full px-4 py-1.5 text-sm" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setOnlyCustomer((v) => !v)} className={chip(onlyCustomer)}>既有客戶</button>
              {currentUser && <button onClick={() => setOnlyMine((v) => !v)} className={chip(onlyMine)}>我的</button>}
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                className="select-soft rounded-full px-3 py-1 text-sm">
                {['全部', ...STATUSES].map((s) => <option key={s} value={s}>{s === '全部' ? '追蹤狀態' : s}</option>)}
              </select>
              <select value={city} onChange={(e) => setCity(e.target.value)}
                className="select-soft rounded-full px-3 py-1 text-sm">
                {cities.map((c) => <option key={c} value={c}>{c === '全部' ? '縣市' : c}</option>)}
              </select>
              <select value={year} onChange={(e) => setYear(e.target.value)}
                className="select-soft rounded-full px-3 py-1 text-sm">
                {years.map((y) => <option key={y} value={y}>{y === '全部' ? '年度' : `${y} 年`}</option>)}
              </select>
              <span className="ml-auto text-xs text-stone-400">
                {shown.length} 案
                {activeFilters > 0 && (
                  <button onClick={clearFilters} className="ml-2 text-brand-700 hover:underline">清除篩選</button>
                )}
              </span>
            </div>
          </div>

          {/* 得標廠商排行：預設收合，要看再展開（完整分析在「市場分析」） */}
          {winnerRank.length > 0 && (
            <details className="card-soft group p-4">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-stone-700">
                <span className="text-stone-400 transition-transform group-open:rotate-90">›</span>
                得標廠商排行
                <span className="text-xs font-normal text-stone-400">符合篩選的 {shown.filter((r) => r.winner).length} 件決標案</span>
              </summary>
              <ul className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {winnerRank.map(([name, v], i) => (
                  <li key={name} className="flex items-baseline gap-2 text-xs">
                    <span className="w-5 tabular-nums text-stone-400">{i + 1}.</span>
                    <button onClick={() => setQ(name)} className="truncate text-stone-700 underline decoration-stone-300 hover:text-brand-700">{name}</button>
                    <span className="ml-auto shrink-0 tabular-nums text-stone-500">{v.count} 件</span>
                    {v.amount > 0 && <span className="w-20 shrink-0 text-right tabular-nums text-stone-400">{(v.amount / 10000).toLocaleString(undefined, { maximumFractionDigits: 0 })} 萬</span>}
                  </li>
                ))}
              </ul>
            </details>
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
            <div className="py-12 text-center text-sm text-stone-400">
              沒有符合篩選的標案
              {activeFilters > 0 && <button onClick={clearFilters} className="ml-2 text-brand-700 hover:underline">清除篩選</button>}
            </div>
          ) : (
            <ul className="space-y-2">
              {shown.slice(0, limit).map((r) => (
                <TenderCard key={r.id} r={r} busy={busy === r.id} currentUser={currentUser} onTrack={(patch) => track(r, patch)} />
              ))}
            </ul>
          )}
          {shown.length > limit && (
            <button onClick={() => setLimit((v) => v + 100)}
              className="mx-auto block rounded-full bg-white px-5 py-2 text-sm font-medium text-stone-600 ring-1 ring-stone-200 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95">
              顯示更多（還有 {shown.length - limit} 案）
            </button>
          )}
        </>
      )}

      <details className="group text-[11px] leading-relaxed text-stone-400">
        <summary className="cursor-pointer list-none hover:text-stone-600">
          <span className="inline-block transition-transform group-open:rotate-90">›</span> 資料來源與收錄規則
        </summary>
        <p className="mt-1 pl-3">
          資料來源：行政院公共工程委員會政府電子採購網（web.pcc.gov.tw）公告查詢，每兩小時自動更新（08–20 時）。
          關鍵字分兩級：牙科、齒模、義齒等直接收；3D列印機、光固化、樹脂等設備耗材詞
          必須同時命中牙科情境（標題或機關有牙科字樣／標的分類屬醫療類／機關為醫院、衛生所、牙體技術科系）才收。
          官網只能用標案名稱查詢，標題沒寫關鍵字的案子（例如夾在綜合醫材開口合約裡的牙科品項）仍可能漏掉，可用「歷史查詢」自行補查。
        </p>
      </details>
    </div>
  )
}

/**
 * 一張標案卡：預設只露出判斷要不要追的資訊（標題、預算、機關、截止倒數、客戶、追蹤狀態），
 * 案號、聯絡人、決標細節、備註收在「詳情」裡。
 */
function TenderCard({ r, busy, currentUser, onTrack }: {
  r: Tender; busy: boolean; currentUser: string
  onTrack: (patch: { status?: string; owner?: string | null; note?: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const awarded = /決標/.test(r.type)
  const d = daysLeft(r.deadline)
  const status = r.status || '待評估'

  return (
    <li className="card-soft p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* 第一層：標題 */}
          <div className="flex items-start gap-2">
            {shortType(r.type) !== '招標' && (
              <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_BADGE(r.type)}`} title={r.type}>{shortType(r.type)}</span>
            )}
            <button onClick={() => setOpen((v) => !v)} className="line-clamp-2 text-left font-semibold leading-snug text-stone-800 hover:text-brand-700">
              {r.title || '（標案名稱未取得）'}
            </button>
          </div>
          {/* 第二層：機關、地區、截止／得標 */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
            <span className="truncate">{r.unitName}</span>
            {r.city && <span className="text-stone-400">· {r.city}{r.district}</span>}
            {!awarded && r.deadline && (
              <span className={`rounded-full px-2 py-0.5 tabular-nums ${
                d === null ? 'bg-amber-50 text-amber-700'
                  : d < 0 ? 'bg-stone-100 text-stone-400'
                    : d <= 7 ? 'bg-red-50 font-semibold text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                {d === null ? `截止 ${r.deadline}` : d < 0 ? '已截止' : d === 0 ? '今天截止' : `剩 ${d} 天`}
              </span>
            )}
            {awarded && r.winner && (
              <span className="text-stone-500">· 得標 <strong className="font-medium text-stone-700">{r.winner}</strong></span>
            )}
          </div>
          {/* 第三層：客戶 */}
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            {r.customerId ? (
              <a href={`/customers/${r.customerId}`} target="_blank" rel="noreferrer"
                className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700 hover:bg-brand-100">
                既有客戶{r.customerSalesperson ? ` · ${r.customerSalesperson}` : ''}
              </a>
            ) : r.matchNote && r.matchNote !== '尚未建檔' ? (
              // 「尚未建檔」是多數非客戶的常態，不顯示；同名多家等需要人確認的才標出
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">{r.matchNote}</span>
            ) : null}
            {r.weBid && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">崧達曾投標</span>}
            {r.note && !open && <span className="truncate text-stone-400">📝 {r.note}</span>}
          </div>
        </div>

        {/* 右欄：金額＋追蹤 */}
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="text-base font-semibold tabular-nums text-brand-700">
            {money(awarded && r.awardAmount ? r.awardAmount : r.budget, r.budgetText)}
          </span>
          <select
            value={status}
            disabled={busy}
            onChange={(e) => onTrack({ status: e.target.value })}
            aria-label="追蹤狀態"
            className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ring-1 ring-stone-900/[0.06] disabled:opacity-50 ${STATUS_STYLE[status] ?? 'bg-stone-100 text-stone-600'}`}
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {r.owner ? (
            <span className="text-[11px] text-stone-400">追蹤：{r.owner}</span>
          ) : currentUser && !awarded && (
            <button disabled={busy} onClick={() => onTrack({ owner: currentUser })}
              className="rounded-full bg-brand-500 px-3 py-1 text-xs font-medium text-white shadow-sm shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50">
              認領
            </button>
          )}
        </div>
      </div>

      {/* 詳情：要用時才展開 */}
      <button onClick={() => setOpen((v) => !v)}
        className="mt-2 text-[11px] text-stone-400 transition-colors hover:text-stone-600">
        {open ? '收起詳情 ▴' : '詳情 ▾'}
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-stone-100 pt-3 text-xs">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-stone-500 sm:grid-cols-[auto_1fr_auto_1fr]">
            <dt className="text-stone-400">案號</dt><dd className="tabular-nums">{r.jobNumber || '—'}</dd>
            <dt className="text-stone-400">公告日</dt><dd className="tabular-nums">{r.date || '—'}</dd>
            {r.deadline && <><dt className="text-stone-400">截止日</dt><dd className="tabular-nums">{r.deadline}</dd></>}
            <dt className="text-stone-400">預算</dt><dd className="tabular-nums">{money(r.budget, r.budgetText)}</dd>
            {r.contact && <><dt className="text-stone-400">聯絡人</dt><dd>{r.contact} {r.phone}</dd></>}
            {r.category && <><dt className="text-stone-400">標的分類</dt><dd>{r.category}</dd></>}
            {r.customerId && <><dt className="text-stone-400">客戶</dt><dd>{r.customerName}</dd></>}
            {r.tier === 2 && <><dt className="text-stone-400">收錄依據</dt><dd>設備／耗材關鍵字</dd></>}
            {!r.unitId && <><dt className="text-stone-400">明細</dt><dd>待補</dd></>}
          </dl>

          {r.winner && (
            <div className="rounded-xl bg-stone-50 px-3 py-2 text-stone-500">
              得標 <strong className="text-stone-700">{r.winner}</strong>
              {r.awardAmount && <> · 決標 <span className="tabular-nums text-stone-700">{money(r.awardAmount, '')}</span></>}
              {r.basePrice && <> · 底價 <span className="tabular-nums">{money(r.basePrice, '')}</span></>}
              {r.bidders.length > 1 && <div className="mt-0.5 text-stone-400">同場競標：{r.bidders.filter((b) => b !== r.winner).join('、')}</div>}
            </div>
          )}

          <input
            key={`${r.id}-note`}
            defaultValue={r.note ?? ''}
            placeholder="備註（例：已索取規格書）——離開欄位即儲存"
            onBlur={(e) => { if (e.target.value !== (r.note ?? '')) onTrack({ note: e.target.value }) }}
            className="input-soft w-full rounded-full px-3 py-1.5 text-xs"
          />

          <div className="flex flex-wrap items-center gap-2">
            {r.url && (
              <a href={r.url} target="_blank" rel="noreferrer"
                className="rounded-full bg-white px-3 py-1 font-medium text-stone-600 ring-1 ring-stone-200 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95">
                看公告原文 ↗
              </a>
            )}
            {r.owner === currentUser && currentUser && (
              <button disabled={busy} onClick={() => onTrack({ owner: null })}
                className="text-stone-400 underline hover:text-stone-600 disabled:opacity-50">取消認領</button>
            )}
          </div>
        </div>
      )}
    </li>
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
          直接查官網（每年最多 100 筆），按「加入追蹤」才會存進機會清單；點標題看公告原文。
        </p>
      </div>

      {err && <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600">{err}</div>}

      {rows && (rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-400">查無資料</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((h) => (
            <li key={h.url} className="card-soft flex items-start gap-3 p-4 text-xs">
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  {shortType(h.type) !== '招標' && (
                    <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_BADGE(h.type)}`} title={h.type}>{shortType(h.type)}</span>
                  )}
                  <a href={h.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-semibold leading-snug text-stone-800 hover:text-brand-700">
                    {h.title || '（標案名稱未取得）'}
                  </a>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-stone-400">
                  <span className="text-stone-500">{h.unitName}</span>
                  <span className="tabular-nums">· 公告 {h.date}</span>
                  {h.deadline && <span className="tabular-nums">· 截止 {h.deadline}</span>}
                  <span className="tabular-nums">· 案號 {h.jobNumber}</span>
                </div>
              </div>
              {h.inDb ? (
                <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-brand-700">已在清單</span>
              ) : canEdit && (
                <button onClick={() => add(h)} disabled={adding === h.url}
                  className="shrink-0 rounded-full bg-brand-500 px-3 py-1 font-medium text-white shadow-sm shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50">
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
