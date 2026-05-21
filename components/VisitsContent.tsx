'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import type { Visit } from '@/lib/system-notion'
import type { OverviewAnalysis } from '@/app/api/ai/analyze/route'

// Legacy 拜訪性質 badge colors (for old records)
const LEGACY_STATUS_COLORS: Record<string, string> = {
  初次拜訪: 'bg-blue-100 text-blue-700',
  例行拜訪: 'bg-green-100 text-green-700',
  重點追蹤: 'bg-orange-100 text-orange-700',
  展覽: 'bg-purple-100 text-purple-700',
  電話拜訪: 'bg-slate-100 text-slate-600',
  視訊拜訪: 'bg-cyan-100 text-cyan-700',
  其他: 'bg-gray-100 text-gray-600',
}

// 互動類型 badge colors
const INTERACTION_TYPE_COLORS: Record<string, string> = {
  拜訪: 'bg-blue-100 text-blue-700',
  電話: 'bg-slate-100 text-slate-600',
  LINE: 'bg-green-100 text-green-700',
  展會: 'bg-purple-100 text-purple-700',
  課程: 'bg-cyan-100 text-cyan-700',
  維修: 'bg-orange-100 text-orange-700',
  報價: 'bg-amber-100 text-amber-700',
  售後: 'bg-rose-100 text-rose-700',
}

// 客戶反應 badge colors
const REACTION_COLORS: Record<string, string> = {
  有興趣: 'bg-emerald-100 text-emerald-700',
  觀望: 'bg-yellow-100 text-yellow-700',
  拒絕: 'bg-red-100 text-red-600',
  需內部討論: 'bg-indigo-100 text-indigo-700',
  已購買: 'bg-teal-100 text-teal-700',
}

type CustomerSuggestion = {
  id: string
  name: string
  city: string
  district: string
  address: string
  type: string
}

type VisitForm = {
  customerName: string
  customerId: string
  date: string
  salesperson: string
  status: string  // legacy, kept for backward compat but not shown in form
  content: string
  address: string
  city: string
  district: string
  tags: string[]
  competitorEquipment: string[]
  interestedProductIds: string[]
  interactionType: string
  interactionPurpose: string
  customerReaction: string
  followUpAction: string
  needsFollowUp: boolean
  nextFollowUpDate: string
}

type SalespersonOption = {
  value: string
  label: string
}

function formatDate(d: string) {
  if (!d) return '—'
  return d.slice(0, 10).replace(/-/g, '/')
}

function InteractionBadge({ interactionType, fallbackStatus }: { interactionType: string; fallbackStatus: string }) {
  const label = interactionType || fallbackStatus
  const cls = INTERACTION_TYPE_COLORS[interactionType] ?? LEGACY_STATUS_COLORS[fallbackStatus] ?? 'bg-gray-100 text-gray-600'
  return label
    ? <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{label}</span>
    : <span className="text-xs text-stone-300">—</span>
}

function ReactionBadge({ reaction }: { reaction: string }) {
  if (!reaction) return null
  const cls = REACTION_COLORS[reaction] ?? 'bg-gray-100 text-gray-600'
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{reaction}</span>
}

export default function VisitsContent() {
  const router = useRouter()
  const [visits, setVisits] = useState<Visit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState('')
  const [filterSalesperson, setFilterSalesperson] = useState('')  // server-side filter
  const [filterCity, setFilterCity] = useState('')               // client-side filter
  const [salespersonFilterOptions, setSalespersonFilterOptions] = useState<string[]>([])
  const [showModal, setShowModal] = useState(false)
  const [editingVisit, setEditingVisit] = useState<Visit | null>(null)
  const [viewingVisit, setViewingVisit] = useState<Visit | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const CACHE_KEY = 'bd-visits-v2'   // v2 = new paginated format
  const CACHE_TTL = 2 * 60 * 1000

  // Build query string from current server-side filters (salesperson)
  const buildQuery = useCallback((opts: { salesperson?: string; cursor?: string } = {}) => {
    const p = new URLSearchParams()
    const sp = opts.salesperson ?? filterSalesperson
    if (sp)          p.set('salesperson', sp)
    if (opts.cursor) p.set('cursor', opts.cursor)
    return p.toString() ? `?${p}` : ''
  }, [filterSalesperson])

  // Initial / refresh load — replaces the list
  const loadVisits = useCallback((opts: { salesperson?: string; silent?: boolean } = {}) => {
    const sp = opts.salesperson ?? filterSalesperson

    // Show sessionStorage cache instantly on first (non-silent, no-filter) load
    if (!opts.silent && !sp) {
      try {
        const raw = sessionStorage.getItem(CACHE_KEY)
        if (raw) {
          const { items, hasMore: hm, nextCursor: nc, ts } = JSON.parse(raw)
          if (Array.isArray(items) && Date.now() - ts < CACHE_TTL) {
            setVisits(items)
            setHasMore(hm ?? false)
            setNextCursor(nc ?? null)
            setLoading(false)
          }
        }
      } catch {}
    }

    const qs = new URLSearchParams()
    if (sp) qs.set('salesperson', sp)
    const url = `/api/visits${qs.toString() ? `?${qs}` : ''}`

    fetch(url)
      .then((r) => {
        if (r.status === 401) {
          try { sessionStorage.removeItem(CACHE_KEY) } catch {}
          router.push('/login')
          return null
        }
        return r.json()
      })
      .then((data) => {
        if (!data || typeof data !== 'object') return
        const { items, hasMore: hm, nextCursor: nc } = data as { items: Visit[]; hasMore: boolean; nextCursor: string | null }
        if (!Array.isArray(items)) return
        setVisits(items)
        setHasMore(hm ?? false)
        setNextCursor(nc ?? null)
        // Cache only the default (no filter) first page
        if (!sp) {
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ items, hasMore: hm, nextCursor: nc, ts: Date.now() })) } catch {}
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [filterSalesperson, router, buildQuery])

  // Load next page and append to list
  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    const qs = new URLSearchParams()
    qs.set('cursor', nextCursor)
    if (filterSalesperson) qs.set('salesperson', filterSalesperson)
    fetch(`/api/visits?${qs}`)
      .then((r) => {
        if (r.status === 401) { router.push('/login'); return null }
        return r.json()
      })
      .then((data) => {
        if (!data || typeof data !== 'object') return
        const { items, hasMore: hm, nextCursor: nc } = data as { items: Visit[]; hasMore: boolean; nextCursor: string | null }
        if (!Array.isArray(items)) return
        setVisits((prev) => [...prev, ...items])
        setHasMore(hm ?? false)
        setNextCursor(nc ?? null)
      })
      .catch(console.error)
      .finally(() => setLoadingMore(false))
  }, [nextCursor, loadingMore, filterSalesperson, router])

  useEffect(() => { loadVisits() }, [])  // mount only

  // Fetch salesperson options for filter dropdown (cached in Redis, fast)
  useEffect(() => {
    fetch('/api/visits/options')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.salespersons)) setSalespersonFilterOptions(data.salespersons)
      })
      .catch(() => {})
  }, [])

  // When salesperson filter changes: reload from page 1 with new filter
  const handleSalespersonFilter = useCallback((sp: string) => {
    setFilterSalesperson(sp)
    setFilterCity('')
    setSearch('')
    setLoading(true)
    setVisits([])
    setHasMore(false)
    setNextCursor(null)
    loadVisits({ salesperson: sp })
  }, [loadVisits])

  const handleDelete = async (id: string) => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/visits/${id}`, { method: 'DELETE' })
      if (res.status === 401) { try { sessionStorage.removeItem(CACHE_KEY) } catch {}; router.push('/login'); return }
      setDeleteConfirmId(null)
      try { sessionStorage.removeItem(CACHE_KEY) } catch {}
      setFilterSalesperson('')
      loadVisits({ silent: true })
    } finally {
      setDeleting(false)
    }
  }

  // City options derived from currently loaded records
  const cityOptions = Array.from(new Set(visits.map((v) => v.city).filter(Boolean))).sort()

  const keyword = search.trim().toLowerCase()
  const clientFiltered = filterCity || keyword  // whether client-side filters are active

  const filteredVisits = visits.filter((v) => {
    if (filterCity && v.city !== filterCity) return false
    if (keyword) {
      return [v.customerName, v.city, v.district, v.salesperson, v.status, v.content, v.address,
              v.interactionType, v.interactionPurpose, v.customerReaction, v.followUpAction]
        .some((field) => field?.toLowerCase().includes(keyword))
    }
    return true
  })

  const isFiltered = keyword || filterSalesperson || filterCity

  function clearAll() {
    if (filterSalesperson) {
      handleSalespersonFilter('')
    } else {
      setSearch('')
      setFilterCity('')
    }
  }

  // ── AI 商機分析 ───────────────────────────────────────────────
  const [aiAnalysis, setAiAnalysis] = useState<OverviewAnalysis | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [showAiPanel, setShowAiPanel] = useState(false)

  const runAiAnalysis = useCallback(async () => {
    if (visits.length === 0) return
    setAiLoading(true)
    setAiError('')
    setShowAiPanel(true)
    setAiAnalysis(null)
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'overview', visits }),
      })
      if (res.status === 401) { router.push('/login'); return }
      const data = await res.json()
      if (!res.ok) { setAiError(data.error ?? 'AI 分析失敗'); return }
      setAiAnalysis(data as OverviewAnalysis)
    } catch {
      setAiError('網路錯誤，請重試')
    } finally {
      setAiLoading(false)
    }
  }, [visits, router])

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-800">客情拜訪紀錄</h2>
          <p className="text-xs text-stone-400 mt-0.5">記錄每日客戶拜訪情況</p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={runAiAnalysis}
            disabled={aiLoading || visits.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:border-violet-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="text-base leading-none">✦</span>
            {aiLoading ? 'AI 分析中…' : 'AI 商機分析'}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="button-primary px-4 py-2 rounded-full text-sm font-medium"
          >
            + 新增拜訪
          </button>
        </div>
      </div>

      {/* Search + Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        {/* Search */}
        <div className="relative flex-1">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋客戶名稱、拜訪性質、內容…"
            className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-brand-200/60 bg-white text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition"
            >
              ✕
            </button>
          )}
        </div>

        {/* Salesperson filter (server-side) */}
        <select
          value={filterSalesperson}
          onChange={(e) => handleSalespersonFilter(e.target.value)}
          className={`py-2.5 px-3 rounded-xl border text-sm transition focus:outline-none focus:ring-2 focus:ring-brand-400 ${
            filterSalesperson
              ? 'border-brand-400 bg-brand-50 text-brand-700 font-medium'
              : 'border-brand-200/60 bg-white text-stone-500'
          }`}
        >
          <option value="">全部業務</option>
          {salespersonFilterOptions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* City filter */}
        <select
          value={filterCity}
          onChange={(e) => setFilterCity(e.target.value)}
          className={`py-2.5 px-3 rounded-xl border text-sm transition focus:outline-none focus:ring-2 focus:ring-brand-400 ${
            filterCity
              ? 'border-brand-400 bg-brand-50 text-brand-700 font-medium'
              : 'border-brand-200/60 bg-white text-stone-500'
          }`}
        >
          <option value="">全部縣市</option>
          {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Clear all */}
        {isFiltered && (
          <button
            onClick={clearAll}
            className="px-3 py-2.5 rounded-xl border border-brand-200/60 bg-white text-xs text-stone-400 hover:text-stone-600 hover:border-brand-300 transition whitespace-nowrap"
          >
            清除篩選
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-brand-200/40 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-stone-400">載入中…</div>
        ) : visits.length === 0 ? (
          <div className="p-10 text-center text-sm text-stone-400 border-2 border-dashed border-brand-200/40 rounded-2xl m-4">
            尚無拜訪紀錄，點擊「新增拜訪」開始記錄。
          </div>
        ) : filteredVisits.length === 0 ? (
          <div className="p-10 text-center text-sm text-stone-400">
            找不到符合條件的拜訪紀錄
          </div>
        ) : (
          <>
            {isFiltered && (
              <div className="px-4 py-2.5 border-b border-brand-100/40 bg-cream-50/60 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs text-stone-500">
                  篩選結果：<span className="font-medium text-brand-600">{filteredVisits.length}</span> 筆
                  <span className="text-stone-400">（共 {visits.length} 筆）</span>
                </span>
                {filterSalesperson && (
                  <span className="inline-flex items-center gap-1 text-xs bg-brand-50 text-brand-600 border border-brand-200/50 px-2 py-0.5 rounded-full">
                    業務：{filterSalesperson}
                    <button onClick={() => setFilterSalesperson('')} className="hover:text-brand-800">✕</button>
                  </span>
                )}
                {filterCity && (
                  <span className="inline-flex items-center gap-1 text-xs bg-brand-50 text-brand-600 border border-brand-200/50 px-2 py-0.5 rounded-full">
                    縣市：{filterCity}
                    <button onClick={() => setFilterCity('')} className="hover:text-brand-800">✕</button>
                  </span>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-cream-50 text-stone-400 text-xs border-b border-brand-100/40">
                  <tr>
                    <th className="px-4 py-3 text-left">日期</th>
                    <th className="px-4 py-3 text-left">客戶名稱</th>
                    <th className="px-4 py-3 text-left">縣市</th>
                    <th className="px-4 py-3 text-left">互動類型</th>
                    <th className="px-4 py-3 text-left">客戶反應</th>
                    <th className="px-4 py-3 text-left">業務人員</th>
                    <th className="px-4 py-3 text-left">拜訪內容</th>
                    <th className="px-4 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-100/30">
                  {filteredVisits.map((v) => (
                    <tr
                      key={v.id}
                      onClick={() => setViewingVisit(v)}
                      className="hover:bg-cream-50/60 transition-colors cursor-pointer group"
                    >
                      <td className="px-4 py-3 text-stone-500 whitespace-nowrap">{formatDate(v.date)}</td>
                      <td className="px-4 py-3 font-medium text-stone-800 group-hover:text-brand-700 transition-colors">
                        {v.customerName}
                        {v.needsFollowUp && (
                          <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-orange-400 align-middle" title="需要追蹤" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-stone-500">{v.city || '—'}</td>
                      <td className="px-4 py-3">
                        <InteractionBadge interactionType={v.interactionType} fallbackStatus={v.status} />
                      </td>
                      <td className="px-4 py-3">
                        <ReactionBadge reaction={v.customerReaction} />
                      </td>
                      <td className="px-4 py-3 text-stone-500">{v.salesperson || '—'}</td>
                      <td className="px-4 py-3 text-stone-500 max-w-xs truncate">{v.content || '—'}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {deleteConfirmId === v.id ? (
                          <div className="flex items-center gap-2 justify-end">
                            <span className="text-xs text-stone-500">確認刪除？</span>
                            <button
                              onClick={() => handleDelete(v.id)}
                              disabled={deleting}
                              className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                            >
                              {deleting ? '…' : '確認'}
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="text-xs text-stone-400 hover:text-stone-600"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => { setEditingVisit(v); setDeleteConfirmId(null) }}
                              className="text-xs text-stone-400 hover:text-brand-600 transition-colors"
                            >
                              編輯
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(v.id)}
                              className="text-xs text-stone-300 hover:text-red-500 transition-colors"
                            >
                              刪除
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Incomplete filter warning + Load more */}
      {hasMore && (
        <div className="mt-3 flex flex-col items-center gap-2">
          {clientFiltered && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200/60 rounded-lg px-3 py-1.5 text-center">
              ⚠️ 篩選僅適用於已載入的 {visits.length} 筆，還有更多紀錄尚未載入
            </p>
          )}
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-5 py-2 rounded-full border border-brand-200/60 bg-white text-sm text-stone-500 hover:text-brand-600 hover:border-brand-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingMore ? '載入中…' : '載入更多'}
          </button>
        </div>
      )}
      {!hasMore && visits.length > 0 && (
        <p className="mt-3 text-center text-xs text-stone-300">
          已顯示全部 {visits.length} 筆
        </p>
      )}

      {/* AI 商機分析面板 */}
      <AnimatePresence>
        {showAiPanel && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25 }}
            className="mt-6 rounded-2xl border border-violet-200/60 bg-violet-50/40 overflow-hidden"
          >
            {/* 面板 header */}
            <div className="px-5 py-4 border-b border-violet-200/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-violet-500 text-lg">✦</span>
                <h3 className="text-sm font-semibold text-violet-800">AI 商機分析</h3>
                {aiAnalysis && (
                  <span className="text-xs text-violet-400">（已載入 {visits.length} 筆紀錄）</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {aiAnalysis && (
                  <button
                    onClick={runAiAnalysis}
                    disabled={aiLoading}
                    className="text-xs text-violet-500 hover:text-violet-700 transition disabled:opacity-40"
                  >
                    重新分析
                  </button>
                )}
                <button
                  onClick={() => setShowAiPanel(false)}
                  className="text-stone-400 hover:text-stone-600 transition text-sm"
                >✕</button>
              </div>
            </div>

            {/* 面板內容 */}
            <div className="px-5 py-5">
              {aiLoading && (
                <div className="flex items-center gap-3 text-sm text-violet-500 py-4">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                  </svg>
                  正在分析 {visits.length} 筆拜訪紀錄…
                </div>
              )}

              {aiError && (
                <p className="text-sm text-red-500 bg-red-50 rounded-xl px-4 py-3">{aiError}</p>
              )}

              {aiAnalysis && !aiLoading && (
                <div className="space-y-5">
                  {/* 高潛力客戶 */}
                  {aiAnalysis.hotCustomers?.length > 0 && (
                    <section>
                      <h4 className="text-xs font-semibold uppercase tracking-widest text-violet-500 mb-2">高潛力客戶</h4>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {aiAnalysis.hotCustomers.map((c, i) => (
                          <div key={i} className="bg-white rounded-xl px-4 py-3 border border-violet-100/60">
                            <p className="text-sm font-semibold text-stone-800">{c.name}</p>
                            <p className="text-xs text-stone-500 mt-0.5">{c.reason}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 產品需求 + 競品威脅 */}
                  <div className="grid gap-5 sm:grid-cols-2">
                    {aiAnalysis.productDemand?.length > 0 && (
                      <section>
                        <h4 className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-2">產品需求趨勢</h4>
                        <div className="space-y-1.5">
                          {aiAnalysis.productDemand.map((p, i) => (
                            <div key={i} className="bg-white rounded-xl px-4 py-2.5 border border-emerald-100/60 flex justify-between items-start gap-3">
                              <div>
                                <p className="text-sm font-medium text-stone-800">{p.product}</p>
                                <p className="text-xs text-stone-400">{p.note}</p>
                              </div>
                              <span className="text-xs font-bold text-emerald-600 shrink-0">{p.count} 次</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {aiAnalysis.competitorThreats?.length > 0 && (
                      <section>
                        <h4 className="text-xs font-semibold uppercase tracking-widest text-orange-500 mb-2">競品威脅雷達</h4>
                        <div className="space-y-1.5">
                          {aiAnalysis.competitorThreats.map((c, i) => (
                            <div key={i} className="bg-white rounded-xl px-4 py-2.5 border border-orange-100/60 flex justify-between items-start gap-3">
                              <div>
                                <p className="text-sm font-medium text-stone-800">{c.competitor}</p>
                                <p className="text-xs text-stone-400">{c.note}</p>
                              </div>
                              <span className="text-xs font-bold text-orange-500 shrink-0">{c.count} 次</span>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>

                  {/* 緊急追蹤 */}
                  {aiAnalysis.followUpUrgent?.length > 0 && (
                    <section>
                      <h4 className="text-xs font-semibold uppercase tracking-widest text-red-500 mb-2">需緊急追蹤</h4>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {aiAnalysis.followUpUrgent.map((f, i) => (
                          <div key={i} className="bg-white rounded-xl px-4 py-3 border border-red-100/60 flex items-start gap-3">
                            <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                            <div>
                              <p className="text-sm font-semibold text-stone-800">{f.name}
                                {f.date && <span className="ml-1.5 text-xs font-normal text-stone-400">{f.date}</span>}
                              </p>
                              <p className="text-xs text-stone-500">{f.reason}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 策略建議 */}
                  {aiAnalysis.strategicSuggestions?.length > 0 && (
                    <section>
                      <h4 className="text-xs font-semibold uppercase tracking-widest text-violet-500 mb-2">策略建議</h4>
                      <div className="space-y-1.5">
                        {aiAnalysis.strategicSuggestions.map((s, i) => (
                          <div key={i} className="flex items-start gap-2.5 bg-white rounded-xl px-4 py-2.5 border border-violet-100/60">
                            <span className="text-violet-400 text-xs mt-0.5 font-bold shrink-0">{i + 1}.</span>
                            <p className="text-sm text-stone-700">{s}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Visit Modal */}
      {showModal && (
        <VisitModal
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false)
            try { sessionStorage.removeItem(CACHE_KEY) } catch {}
            setFilterSalesperson('')
            setFilterCity('')
            setSearch('')
            setLoading(true)
            setVisits([])
            setHasMore(false)
            setNextCursor(null)
            loadVisits({ silent: true })
          }}
        />
      )}

      {/* Edit Visit Modal */}
      {editingVisit && (
        <VisitModal
          initialData={editingVisit}
          onClose={() => setEditingVisit(null)}
          onSaved={() => {
            setEditingVisit(null)
            try { sessionStorage.removeItem(CACHE_KEY) } catch {}
            setLoading(true)
            setVisits([])
            setHasMore(false)
            setNextCursor(null)
            loadVisits({ salesperson: filterSalesperson, silent: true })
          }}
        />
      )}

      {/* View Visit Detail Modal */}
      {viewingVisit && (
        <ViewVisitModal
          visit={viewingVisit}
          onClose={() => setViewingVisit(null)}
          onEdit={(v) => { setViewingVisit(null); setEditingVisit(v) }}
          onDelete={(id) => { setViewingVisit(null); setDeleteConfirmId(id) }}
        />
      )}
    </div>
  )
}

// ── View Detail Modal ─────────────────────────────────────────

function ViewVisitModal({
  visit,
  onClose,
  onEdit,
  onDelete,
}: {
  visit: Visit
  onClose: () => void
  onEdit: (v: Visit) => void
  onDelete: (id: string) => void
}) {
  const [visible, setVisible] = useState(true)

  const handleClose = () => {
    setVisible(false)
    setTimeout(onClose, 220)
  }

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-stone-900/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
          />

          {/* Scroll container */}
          <motion.div
            className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 overflow-y-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              className="relative w-full max-w-lg"
              initial={{ opacity: 0, y: 32, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <div className="panel overflow-hidden">
                {/* Header */}
                <div className="px-6 py-5 border-b border-brand-100/60 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="eyebrow mb-1">客情管理</p>
                    <h3 className="text-lg font-bold text-stone-800 truncate">{visit.customerName}</h3>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <InteractionBadge interactionType={visit.interactionType} fallbackStatus={visit.status} />
                      {visit.customerReaction && <ReactionBadge reaction={visit.customerReaction} />}
                      <span className="text-xs text-stone-400">{formatDate(visit.date)}</span>
                      {visit.salesperson && (
                        <span className="text-xs text-stone-400">・{visit.salesperson}</span>
                      )}
                      {visit.needsFollowUp && (
                        <span className="text-xs bg-orange-50 text-orange-600 border border-orange-200 rounded-full px-2 py-0.5 font-medium">
                          需追蹤{visit.nextFollowUpDate ? `・${formatDate(visit.nextFollowUpDate)}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleClose}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition text-lg leading-none"
                  >
                    ✕
                  </button>
                </div>

                {/* Content */}
                <div className="px-6 py-5 space-y-4">
                  {/* Info grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {([
                      ['縣市', visit.city],
                      ['鄉鎮市區', visit.district],
                      ['業務人員', visit.salesperson],
                      ['互動目的', visit.interactionPurpose],
                    ] as [string, string][]).map(([label, val]) => (
                      <div key={label} className="bg-cream-50/60 rounded-xl px-4 py-3">
                        <div className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1">{label}</div>
                        <div className="text-sm font-medium text-stone-700">{val || '—'}</div>
                      </div>
                    ))}
                  </div>

                  {/* Address */}
                  {visit.address && (
                    <div className="bg-cream-50/60 rounded-xl px-4 py-3">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1">地址</div>
                      <div className="text-sm text-stone-700">{visit.address}</div>
                    </div>
                  )}

                  {/* Content / notes */}
                  <div className="bg-cream-50/60 rounded-xl px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-1.5">拜訪內容</div>
                    {visit.content ? (
                      <p className="text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">{visit.content}</p>
                    ) : (
                      <p className="text-sm text-stone-400 italic">無拜訪內容紀錄</p>
                    )}
                  </div>

                  {/* 後續動作 */}
                  {visit.followUpAction && (
                    <div className="bg-orange-50/60 rounded-xl px-4 py-3 border border-orange-100/60">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-orange-400 mb-1.5">後續動作</div>
                      <p className="text-sm text-stone-700 whitespace-pre-wrap">{visit.followUpAction}</p>
                    </div>
                  )}

                  {/* 有興趣的產品 */}
                  {visit.interestedProducts && visit.interestedProducts.length > 0 && (
                    <div className="bg-cream-50/60 rounded-xl px-4 py-3">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-2">有興趣的產品</div>
                      <div className="flex flex-wrap gap-1.5">
                        {visit.interestedProducts.map((p) => (
                          <span key={p.id} className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200/50 rounded-full px-2.5 py-0.5 font-medium">
                            {p.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 客戶標籤 */}
                  {visit.tags && visit.tags.length > 0 && (
                    <div className="bg-cream-50/60 rounded-xl px-4 py-3">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-2">客戶標籤</div>
                      <div className="flex flex-wrap gap-1.5">
                        {visit.tags.map((tag) => (
                          <span key={tag} className="text-xs bg-brand-100 text-brand-700 border border-brand-200/50 rounded-full px-2.5 py-0.5 font-medium">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 競品設備 */}
                  {visit.competitorEquipment && visit.competitorEquipment.length > 0 && (
                    <div className="bg-cream-50/60 rounded-xl px-4 py-3">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-2">競品設備</div>
                      <div className="flex flex-wrap gap-1.5">
                        {visit.competitorEquipment.map((val) => (
                          <span key={val} className="text-xs bg-orange-50 text-orange-700 border border-orange-200/50 rounded-full px-2.5 py-0.5 font-medium">
                            {val}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer actions */}
                <div className="px-6 py-4 border-t border-brand-100/60 flex gap-2">
                  <button
                    onClick={() => onEdit(visit)}
                    className="button-primary flex-1 py-2.5 rounded-xl text-sm font-medium"
                  >
                    編輯紀錄
                  </button>
                  <button
                    onClick={handleClose}
                    className="button-secondary px-5 py-2.5 rounded-xl text-sm"
                  >
                    關閉
                  </button>
                  <button
                    onClick={() => onDelete(visit.id)}
                    className="px-4 py-2.5 rounded-xl text-sm font-medium text-red-500 hover:bg-red-50 transition"
                  >
                    刪除
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Shared Modal (create + edit) ──────────────────────────────

export function VisitModal({
  initialData,
  prefillCustomer,
  onClose,
  onSaved,
}: {
  initialData?: Visit
  prefillCustomer?: { id: string; name: string; city: string; district: string; address: string }
  onClose: () => void
  onSaved: () => void
}) {
  const router = useRouter()
  const isEdit = !!initialData
  const today = new Date().toISOString().slice(0, 10)
  const [visible, setVisible] = useState(true)

  const handleClose = () => {
    setVisible(false)
    setTimeout(onClose, 220)
  }

  const [form, setForm] = useState<VisitForm>({
    customerName: initialData?.customerName ?? prefillCustomer?.name ?? '',
    customerId: prefillCustomer?.id ?? '',
    date: initialData?.date ? initialData.date.slice(0, 10) : today,
    salesperson: initialData?.salesperson ?? '',
    status: initialData?.status ?? '',
    content: initialData?.content ?? '',
    address: initialData?.address ?? prefillCustomer?.address ?? '',
    city: initialData?.city ?? prefillCustomer?.city ?? '',
    district: initialData?.district ?? prefillCustomer?.district ?? '',
    tags: initialData?.tags ?? [],
    competitorEquipment: initialData?.competitorEquipment ?? [],
    interestedProductIds: initialData?.interestedProducts?.map((p) => p.id) ?? [],
    interactionType: initialData?.interactionType ?? '',
    interactionPurpose: initialData?.interactionPurpose ?? '',
    customerReaction: initialData?.customerReaction ?? '',
    followUpAction: initialData?.followUpAction ?? '',
    needsFollowUp: initialData?.needsFollowUp ?? false,
    nextFollowUpDate: initialData?.nextFollowUpDate ? initialData.nextFollowUpDate.slice(0, 10) : '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [salespersonOptions, setSalespersonOptions] = useState<SalespersonOption[]>([])
  const [tagOptions, setTagOptions] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [showTagDropdown, setShowTagDropdown] = useState(false)
  const tagInputRef = useRef<HTMLInputElement>(null)

  const [competitorOptions, setCompetitorOptions] = useState<string[]>([])
  const [competitorInput, setCompetitorInput] = useState('')
  const [showCompetitorDropdown, setShowCompetitorDropdown] = useState(false)

  const [interactionTypeOptions, setInteractionTypeOptions] = useState<string[]>([])
  const [interactionPurposeOptions, setInteractionPurposeOptions] = useState<string[]>([])
  const [customerReactionOptions, setCustomerReactionOptions] = useState<string[]>([])

  const [productSuggestions, setProductSuggestions] = useState<Array<{ id: string; name: string }>>([])
  const [productInput, setProductInput] = useState('')
  const [productSearchLoading, setProductSearchLoading] = useState(false)
  const productTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Customer search — disabled when prefillCustomer is provided
  const [query, setQuery] = useState(initialData?.customerName ?? prefillCustomer?.name ?? '')
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Only search after the user has actually typed — prevents edit mode from
  // auto-firing a search with the pre-filled customer name on mount.
  const customerSearchEnabled = useRef(false)

  useEffect(() => {
    if (prefillCustomer) return
    if (!customerSearchEnabled.current) return   // user hasn't typed yet
    if (!query || query.length < 1) { setSuggestions([]); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setSearchLoading(true)
      fetch(`/api/customers/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((data) => setSuggestions(Array.isArray(data) ? data : []))
        .catch(() => setSuggestions([]))
        .finally(() => setSearchLoading(false))
    }, 300)
  }, [query, prefillCustomer])

  useEffect(() => {
    let cancelled = false
    fetch('/api/visits/options')
      .then((r) => r.json())
      .then((data: { salespersons?: string[]; tagOptions?: string[]; competitorOptions?: string[]; interactionTypes?: string[]; interactionPurposes?: string[]; customerReactions?: string[] }) => {
        if (cancelled) return
        if (Array.isArray(data?.salespersons)) {
          setSalespersonOptions(data.salespersons.map((name) => ({ value: name, label: name })))
        }
        if (Array.isArray(data?.tagOptions)) setTagOptions(data.tagOptions)
        if (Array.isArray(data?.competitorOptions)) setCompetitorOptions(data.competitorOptions)
        if (Array.isArray(data?.interactionTypes)) setInteractionTypeOptions(data.interactionTypes)
        if (Array.isArray(data?.interactionPurposes)) setInteractionPurposeOptions(data.interactionPurposes)
        if (Array.isArray(data?.customerReactions)) setCustomerReactionOptions(data.customerReactions)
      })
      .catch(() => { if (cancelled) return; setSalespersonOptions([]) })
    return () => { cancelled = true }
  }, [])

  // Tag helpers
  const addTag = (tag: string) => {
    const t = tag.trim()
    if (!t || form.tags.includes(t)) return
    setForm((f) => ({ ...f, tags: [...f.tags, t] }))
    setTagInput('')
    setShowTagDropdown(false)
  }
  const removeTag = (tag: string) => {
    setForm((f) => ({ ...f, tags: f.tags.filter((t) => t !== tag) }))
  }
  const filteredTagOptions = tagOptions.filter(
    (t) => !form.tags.includes(t) && t.toLowerCase().includes(tagInput.toLowerCase())
  )

  // Competitor helpers
  const addCompetitor = (val: string) => {
    const v = val.trim()
    if (!v || form.competitorEquipment.includes(v)) return
    setForm((f) => ({ ...f, competitorEquipment: [...f.competitorEquipment, v] }))
    setCompetitorInput('')
    setShowCompetitorDropdown(false)
  }
  const removeCompetitor = (val: string) => {
    setForm((f) => ({ ...f, competitorEquipment: f.competitorEquipment.filter((v) => v !== val) }))
  }
  const filteredCompetitorOptions = competitorOptions.filter(
    (c) => !form.competitorEquipment.includes(c) && c.toLowerCase().includes(competitorInput.toLowerCase())
  )

  // Product search (debounced via /api/products/search)
  const searchProducts = useCallback((q: string) => {
    if (productTimer.current) clearTimeout(productTimer.current)
    if (!q.trim()) { setProductSuggestions([]); setProductSearchLoading(false); return }
    setProductSearchLoading(true)
    productTimer.current = setTimeout(() => {
      fetch(`/api/products/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data: Array<{ id: string; name: string }>) => {
          if (!Array.isArray(data)) return
          setProductSuggestions(data.filter((p) => !form.interestedProductIds.includes(p.id)))
        })
        .catch(() => setProductSuggestions([]))
        .finally(() => setProductSearchLoading(false))
    }, 300)
  }, [form.interestedProductIds])

  // Product helpers
  const [selectedProductNames, setSelectedProductNames] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    if (initialData?.interestedProducts) {
      for (const p of initialData.interestedProducts) map[p.id] = p.name
    }
    return map
  })

  const addProduct = (product: { id: string; name: string }) => {
    if (form.interestedProductIds.includes(product.id)) return
    setSelectedProductNames((m) => ({ ...m, [product.id]: product.name }))
    setForm((f) => ({ ...f, interestedProductIds: [...f.interestedProductIds, product.id] }))
    setProductInput('')
    setProductSuggestions([])
  }
  const removeProduct = (id: string) => {
    setForm((f) => ({ ...f, interestedProductIds: f.interestedProductIds.filter((pid) => pid !== id) }))
  }

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const mergedSalespersonOptions =
    form.salesperson && !salespersonOptions.some((option) => option.value === form.salesperson)
      ? [{ value: form.salesperson, label: form.salesperson }, ...salespersonOptions]
      : salespersonOptions

  const selectCustomer = (c: CustomerSuggestion) => {
    setForm((f) => ({
      ...f,
      customerName: c.name,
      customerId: c.id,
      city: c.city,
      district: c.district,
      address: c.address || f.address,
    }))
    setQuery(c.name)
    setSuggestions([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.customerName.trim()) { setError('請填寫客戶名稱'); return }
    setSubmitting(true)
    setError('')
    try {
      const res = isEdit
        ? await fetch(`/api/visits/${initialData!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
          })
        : await fetch('/api/visits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
          })

      if (res.status === 401) {
        router.push('/login')
        return
      }
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? (isEdit ? '更新失敗' : '建立失敗'))
        return
      }
      onSaved()
    } catch {
      setError('網路錯誤，請重試')
    } finally {
      setSubmitting(false)
    }
  }

  const inputCls = 'w-full border border-brand-200/60 bg-cream-50/50 rounded-xl px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition'

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-stone-900/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
          />

          {/* Scroll container */}
          <motion.div
            className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 overflow-y-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Modal panel */}
            <motion.div
              className="relative w-full max-w-lg"
              initial={{ opacity: 0, y: 32, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <div className="panel overflow-hidden">
                {/* Header */}
                <div className="px-6 py-5 border-b border-brand-100/60 flex items-center justify-between">
                  <div>
                    <p className="eyebrow mb-1">客情管理</p>
                    <h3 className="text-lg font-bold text-stone-800">
                      {isEdit ? '編輯拜訪紀錄' : '新增拜訪紀錄'}
                    </h3>
                  </div>
                  <button
                    onClick={handleClose}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition text-lg leading-none"
                  >
                    ✕
                  </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="px-6 py-5 max-h-[72vh] overflow-y-auto space-y-4">
                  {/* Customer search */}
                  <div className="relative">
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">客戶名稱 *</label>
                    <input
                      type="text"
                      value={query}
                      readOnly={!!prefillCustomer}
                      onChange={(e) => {
                        if (prefillCustomer) return
                        customerSearchEnabled.current = true   // enable search once user types
                        setQuery(e.target.value)
                        setForm((f) => ({ ...f, customerName: e.target.value, customerId: '', city: '', district: '', address: '' }))
                      }}
                      placeholder="輸入客戶名稱搜尋…"
                      className={`${inputCls} ${prefillCustomer ? 'opacity-70 cursor-default' : ''}`}
                    />
                    {(suggestions.length > 0 || searchLoading) && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-brand-200/40 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                        {searchLoading ? (
                          <div className="px-4 py-3 text-sm text-stone-400">搜尋中…</div>
                        ) : (
                          suggestions.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => selectCustomer(c)}
                              className="w-full text-left px-4 py-3 text-sm hover:bg-cream-50 border-b border-brand-100/30 last:border-0 transition-colors"
                            >
                              <div className="font-medium text-stone-800">{c.name}</div>
                              <div className="text-xs text-stone-400">{[c.city, c.district, c.type].filter(Boolean).join('・')}</div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">拜訪日期</label>
                      <input
                        type="date"
                        value={form.date}
                        onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">業務人員</label>
                      <select
                        value={form.salesperson}
                        onChange={(e) => setForm((f) => ({ ...f, salesperson: e.target.value }))}
                        className={inputCls}
                      >
                        <option value="">請選擇業務人員</option>
                        {mergedSalespersonOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">互動類型</label>
                      <select
                        value={form.interactionType}
                        onChange={(e) => setForm((f) => ({ ...f, interactionType: e.target.value }))}
                        className={inputCls}
                      >
                        <option value="">請選擇互動類型</option>
                        {interactionTypeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">互動目的</label>
                      <select
                        value={form.interactionPurpose}
                        onChange={(e) => setForm((f) => ({ ...f, interactionPurpose: e.target.value }))}
                        className={inputCls}
                      >
                        <option value="">請選擇互動目的</option>
                        {interactionPurposeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">地址</label>
                    <input
                      type="text"
                      value={form.address}
                      onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                      placeholder="拜訪地址（可自動從客戶帶入）"
                      className={inputCls}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">拜訪內容</label>
                    <textarea
                      value={form.content}
                      onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                      rows={3}
                      placeholder="記錄此次拜訪的重點內容…"
                      className={`${inputCls} resize-y min-h-[80px]`}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">客戶反應</label>
                    <select
                      value={form.customerReaction}
                      onChange={(e) => setForm((f) => ({ ...f, customerReaction: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="">請選擇客戶反應</option>
                      {customerReactionOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>

                  {/* 有興趣的產品 */}
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">有興趣的產品</label>
                    {form.interestedProductIds.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {form.interestedProductIds.map((id) => (
                          <span key={id} className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200/60 rounded-full px-2.5 py-0.5">
                            {selectedProductNames[id] ?? id}
                            <button type="button" onClick={() => removeProduct(id)} className="hover:text-emerald-900 leading-none">×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="relative">
                      <input
                        type="text"
                        value={productInput}
                        onChange={(e) => { setProductInput(e.target.value); searchProducts(e.target.value) }}
                        onBlur={() => setTimeout(() => setProductSuggestions([]), 150)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') { setProductInput(''); setProductSuggestions([]) }
                        }}
                        placeholder="輸入產品名稱搜尋…"
                        className={inputCls}
                      />
                      {(productSearchLoading || productSuggestions.length > 0) && productInput.trim() && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-brand-200/40 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                          {productSearchLoading ? (
                            <div className="px-4 py-3 text-sm text-stone-400">搜尋中…</div>
                          ) : (
                            productSuggestions.map((p) => (
                              <button key={p.id} type="button" onMouseDown={() => addProduct(p)}
                                className="w-full text-left px-4 py-2.5 text-sm text-stone-700 hover:bg-cream-50 border-b border-brand-100/30 last:border-0 transition-colors">
                                {p.name}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                      {!productSearchLoading && productInput.trim() && productSuggestions.length === 0 && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-brand-200/40 rounded-xl shadow-lg px-4 py-3 text-sm text-stone-400">
                          找不到符合的產品
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 客戶標籤 */}
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">客戶標籤</label>
                    {form.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {form.tags.map((tag) => (
                          <span key={tag} className="inline-flex items-center gap-1 text-xs bg-brand-100 text-brand-700 border border-brand-200/60 rounded-full px-2.5 py-0.5">
                            {tag}
                            <button type="button" onClick={() => removeTag(tag)} className="hover:text-brand-900 leading-none">×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="relative">
                      <input
                        ref={tagInputRef}
                        type="text"
                        value={tagInput}
                        onChange={(e) => { setTagInput(e.target.value); setShowTagDropdown(!!e.target.value.trim()) }}
                        onBlur={() => setTimeout(() => setShowTagDropdown(false), 150)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); if (tagInput.trim()) addTag(tagInput) }
                          if (e.key === 'Escape') { setShowTagDropdown(false); setTagInput('') }
                        }}
                        placeholder="輸入關鍵字搜尋標籤，按 Enter 新增…"
                        className={inputCls}
                      />
                      {showTagDropdown && tagInput.trim() && (filteredTagOptions.length > 0 || !tagOptions.includes(tagInput.trim())) && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-brand-200/40 rounded-xl shadow-lg max-h-44 overflow-y-auto">
                          {filteredTagOptions.map((t) => (
                            <button key={t} type="button" onMouseDown={() => addTag(t)}
                              className="w-full text-left px-4 py-2.5 text-sm text-stone-700 hover:bg-cream-50 border-b border-brand-100/30 last:border-0 transition-colors">
                              {t}
                            </button>
                          ))}
                          {!tagOptions.includes(tagInput.trim()) && (
                            <button type="button" onMouseDown={() => addTag(tagInput)}
                              className="w-full text-left px-4 py-2.5 text-sm text-brand-600 font-medium hover:bg-brand-50 transition-colors">
                              + 新增「{tagInput.trim()}」
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 競品設備 */}
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">競品設備</label>
                    {form.competitorEquipment.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {form.competitorEquipment.map((val) => (
                          <span
                            key={val}
                            className="inline-flex items-center gap-1 text-xs bg-orange-50 text-orange-700 border border-orange-200/60 rounded-full px-2.5 py-0.5"
                          >
                            {val}
                            <button
                              type="button"
                              onClick={() => removeCompetitor(val)}
                              className="hover:text-orange-900 leading-none"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="relative">
                      <input
                        type="text"
                        value={competitorInput}
                        onChange={(e) => { setCompetitorInput(e.target.value); setShowCompetitorDropdown(!!e.target.value.trim()) }}
                        onBlur={() => setTimeout(() => setShowCompetitorDropdown(false), 150)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); if (competitorInput.trim()) addCompetitor(competitorInput) }
                          if (e.key === 'Escape') { setShowCompetitorDropdown(false); setCompetitorInput('') }
                        }}
                        placeholder="輸入關鍵字搜尋競品，按 Enter 新增…"
                        className={inputCls}
                      />
                      {showCompetitorDropdown && competitorInput.trim() && (filteredCompetitorOptions.length > 0 || !competitorOptions.includes(competitorInput.trim())) && (
                        <div className="absolute z-20 mt-1 w-full bg-white border border-brand-200/40 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                          {filteredCompetitorOptions.map((c) => (
                            <button key={c} type="button" onMouseDown={() => addCompetitor(c)}
                              className="w-full text-left px-4 py-2.5 text-sm text-stone-700 hover:bg-cream-50 border-b border-brand-100/30 last:border-0 transition-colors">
                              {c}
                            </button>
                          ))}
                          {!competitorOptions.includes(competitorInput.trim()) && (
                            <button type="button" onMouseDown={() => addCompetitor(competitorInput)}
                              className="w-full text-left px-4 py-2.5 text-sm text-orange-600 font-medium hover:bg-orange-50 transition-colors">
                              + 新增「{competitorInput.trim()}」
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 後續動作 */}
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">後續動作</label>
                    <textarea
                      value={form.followUpAction}
                      onChange={(e) => setForm((f) => ({ ...f, followUpAction: e.target.value }))}
                      rows={2}
                      placeholder="記錄下一步需要做的事…"
                      className={`${inputCls} resize-y min-h-[60px]`}
                    />
                  </div>

                  {/* 是否需追蹤 + 下次追蹤日 */}
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={form.needsFollowUp}
                        onChange={(e) => setForm((f) => ({ ...f, needsFollowUp: e.target.checked, nextFollowUpDate: e.target.checked ? f.nextFollowUpDate : '' }))}
                        className="w-4 h-4 rounded border-brand-300 text-brand-600 focus:ring-brand-400 accent-brand-600"
                      />
                      <span className="text-sm font-medium text-stone-600">需要追蹤</span>
                    </label>
                    {form.needsFollowUp && (
                      <div className="flex-1 min-w-[160px]">
                        <input
                          type="date"
                          value={form.nextFollowUpDate}
                          onChange={(e) => setForm((f) => ({ ...f, nextFollowUpDate: e.target.value }))}
                          className={inputCls}
                        />
                      </div>
                    )}
                  </div>

                  {error && (
                    <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>
                  )}

                  <div className="flex gap-3 pt-2 border-t border-brand-100/40">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="button-primary flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
                    >
                      {submitting ? (isEdit ? '儲存中…' : '建立中…') : (isEdit ? '儲存變更' : '建立紀錄')}
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="button-secondary px-5 py-2.5 rounded-xl text-sm"
                    >
                      取消
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
