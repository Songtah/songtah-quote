'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import type { Visit } from '@/lib/system-notion'
import type { OverviewAnalysis } from '@/app/api/ai/analyze/route'

// Legacy 拜訪性質 badge colors (for old records)
const LEGACY_STATUS_COLORS: Record<string, string> = {
  初次拜訪: 'bg-blue-100 text-blue-700',
  例行拜訪: 'bg-brand-50 text-green-700',
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
  LINE: 'bg-brand-50 text-green-700',
  展會: 'bg-purple-100 text-purple-700',
  課程: 'bg-cyan-100 text-cyan-700',
  維修: 'bg-orange-100 text-orange-700',
  報價: 'bg-amber-100 text-amber-700',
  售後: 'bg-rose-100 text-rose-700',
}

// 客戶反應 badge colors
const REACTION_COLORS: Record<string, string> = {
  有興趣: 'bg-brand-50 text-emerald-700',
  觀望: 'bg-yellow-100 text-yellow-700',
  拒絕: 'bg-red-100 text-red-600',
  需內部討論: 'bg-indigo-100 text-indigo-700',
  已購買: 'bg-brand-50 text-teal-700',
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

// ── 客戶反應標準選項（業務經理視角設計）─────────────────────────
// 涵蓋拜訪週期的四個階段：積極接觸 → 觀望評估 → 阻礙因素 → 後續行動
export const DEFAULT_REACTION_OPTIONS = [
  // 積極 / 高意願
  '積極詢問',      // 主動問產品、規格、價格
  '要求報價',      // 明確開口要報價單
  '同意試用',      // 願意接受樣品或試用
  '確認下單',      // 本次或近期確認採購
  // 中性 / 觀望
  '有興趣待確認',  // 表示有興趣，但需再確認
  '持觀望態度',    // 尚未表態，需再追蹤
  '需要考慮',      // 明確說需要時間評估
  // 阻礙 / 困難
  '價格有疑慮',    // 對價格有異議或比價
  '使用競品',      // 目前已有其他品牌在用
  '近期無需求',    // 明確表示短期不需要
  // 後續行動導向
  '安排再次拜訪',  // 雙方約定下次見面
  '反應冷淡',      // 態度被動、不主動回應
] as const

// ── 客戶反應 Combobox（可選清單 + 可自由輸入新選項）─────────────

function ReactionCombobox({
  value,
  options,
  onChange,
  inputCls,
}: {
  value:    string
  options:  string[]
  onChange: (v: string) => void
  inputCls: string
}) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState(value)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(value) }, [value])

  const filtered = query.trim()
    ? options.filter((o) => o.includes(query.trim()))
    : options

  const commit = (v: string) => {
    setQuery(v)
    onChange(v)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        placeholder="選擇或輸入客戶反應…"
        className={inputCls}
        onChange={(e) => { setQuery(e.target.value); onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {/* 清除按鈕 */}
      {query && (
        <button
          type="button"
          onClick={() => commit('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-base leading-none"
        >×</button>
      )}
      {/* 下拉選單 */}
      {open && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
          {filtered.map((o) => (
            <button
              key={o}
              type="button"
              onMouseDown={() => commit(o)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-blue-50 ${
                value === o ? 'text-blue-600 font-medium bg-blue-50/50' : 'text-gray-700'
              }`}
            >
              {o}
            </button>
          ))}
          {/* 自訂選項提示 */}
          {query.trim() && !options.includes(query.trim()) && (
            <button
              type="button"
              onMouseDown={() => commit(query.trim())}
              className="w-full text-left px-3 py-2 text-sm text-blue-500 border-t border-gray-100 hover:bg-blue-50 transition-colors"
            >
              ＋ 新增「{query.trim()}」
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── AI 客戶反應建議按鈕 ────────────────────────────────────────

function AIReactionButton({
  content,
  options,
  onSuggest,
}: {
  content:   string
  options:   string[]
  onSuggest: (value: string) => void
}) {
  const [loading,        setLoading]        = useState(false)
  const [lastSuggestion, setLastSuggestion] = useState('')
  // 記錄上次成功分析時的內容，用來判斷是否需鎖定
  const contentAtAnalysis = useRef('')

  // 分析成功後鎖定，直到內容被修改
  const isLocked = lastSuggestion !== '' && content.trim() === contentAtAnalysis.current.trim()
  const canRun   = content.trim().length > 0 && options.length > 0 && !isLocked

  const handleClick = async () => {
    if (!canRun) return
    setLoading(true)
    try {
      const res = await fetch('/api/ai/suggest-reaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, options }),
      })
      const data = await res.json()
      const suggestion: string = data.suggestion ?? ''
      setLastSuggestion(suggestion)
      if (suggestion) {
        onSuggest(suggestion)
        contentAtAnalysis.current = content  // 鎖定：記住此次分析的內容
      }
    } catch {
      // 靜默失敗
    } finally {
      setLoading(false)
    }
  }

  const title = isLocked
    ? '已分析完成，修改拜訪內容後可重新分析'
    : !content.trim()
    ? '請先填寫拜訪內容'
    : options.length === 0
    ? '選項載入中，請稍候'
    : 'AI 根據拜訪內容自動判斷'

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading || !canRun}
      title={title}
      className={`flex items-center gap-1 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
        isLocked
          ? 'text-emerald-500 disabled:opacity-80'
          : 'text-violet-500 hover:text-violet-700 disabled:opacity-40'
      }`}
    >
      {loading ? (
        <span className="animate-pulse">分析中…</span>
      ) : isLocked ? (
        <>✓ <span>已分析</span></>
      ) : (
        <>✨ <span>{lastSuggestion ? '重新判斷' : '自動判斷'}</span></>
      )}
    </button>
  )
}

export default function VisitsContent({
  initialOpenCreate = false,
  initialCustomerName = '',
  canManageAll = false,
}: {
  initialOpenCreate?: boolean
  initialCustomerName?: string
  canManageAll?: boolean
} = {}) {
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
  const [showModal, setShowModal] = useState(initialOpenCreate)
  const [editingVisit, setEditingVisit] = useState<Visit | null>(null)
  const [viewingVisit, setViewingVisit] = useState<Visit | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ── 多選批次處理 ───────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkConfirm, setBulkConfirm] = useState(false)

  // ── 一鍵批次 AI 分析 ─────────────────────────────────────────
  const [batchReactionOptions, setBatchReactionOptions] = useState<string[]>([])
  const [batchInteractionTypeOptions, setBatchInteractionTypeOptions] = useState<string[]>([])
  const [batchAnalyzing, setBatchAnalyzing] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)

  // ── 批次補齊客戶關聯 ─────────────────────────────────────────
  const [autoLinkOpen,    setAutoLinkOpen]    = useState(false)
  const [autoLinkRunning, setAutoLinkRunning] = useState(false)
  const [autoLinkDone,    setAutoLinkDone]    = useState(false)
  const [autoLinkStats,   setAutoLinkStats]   = useState<{
    linked: number; skipped: number; noMatch: number; multiMatch: number
    noMatchNames: string[]; multiMatchNames: string[]
  } | null>(null)
  const autoLinkAbort = useRef(false)

  // ── 偵測競品 state ─────────────────────────────────────────────
  const [detectOpen,    setDetectOpen]    = useState(false)
  const [detectRunning, setDetectRunning] = useState(false)
  const [detectDone,    setDetectDone]    = useState(false)
  const [detectStats,   setDetectStats]   = useState<{
    filled: number; skipped: number; noContent: number
    competitorOptions: string[]
    examples: { customerName: string; detected: string[] }[]
  } | null>(null)
  const detectAbort = useRef(false)

  // ── 刪除重複項目 state ─────────────────────────────────────────
  const [dedupOpen,    setDedupOpen]    = useState(false)
  const [dedupRunning, setDedupRunning] = useState(false)
  const [dedupDone,    setDedupDone]    = useState(false)
  const [dedupStats,   setDedupStats]   = useState<{
    groups: number; duplicates: number; deleted: number
    examples: { customerName: string; date: string; salesperson: string; count: number }[]
  } | null>(null)

  const CACHE_KEY = 'bd-visits-v3'   // v3 = page size 10
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
    qs.set('limit', '10')
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
  // 同時取得客戶反應選項供一鍵批次分析使用
  useEffect(() => {
    fetch('/api/visits/options')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.salespersons)) setSalespersonFilterOptions(data.salespersons)
        if (Array.isArray(data?.customerReactions)) {
          setBatchReactionOptions(Array.from(new Set([...DEFAULT_REACTION_OPTIONS, ...data.customerReactions])))
        } else {
          setBatchReactionOptions([...DEFAULT_REACTION_OPTIONS])
        }
        if (Array.isArray(data?.interactionTypes)) {
          setBatchInteractionTypeOptions(data.interactionTypes)
        } else {
          setBatchInteractionTypeOptions(Object.keys(INTERACTION_TYPE_COLORS))
        }
      })
      .catch(() => { setBatchReactionOptions([...DEFAULT_REACTION_OPTIONS]) })
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
  const AI_STORAGE_KEY = 'bd-ai-analysis'

  const [showAiModal, setShowAiModal] = useState(false)
  const [aiAnalysis, setAiAnalysis] = useState<OverviewAnalysis | null>(null)
  const [aiTimestamp, setAiTimestamp] = useState<string | null>(null)
  const [aiVisitCount, setAiVisitCount] = useState<number>(0)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')

  const [aiFilterSalesperson, setAiFilterSalesperson] = useState('')
  const [aiFilterDateFrom, setAiFilterDateFrom] = useState('')
  const [aiFilterDateTo, setAiFilterDateTo] = useState('')

  const AI_CUSTOM_PROMPT_KEY = 'bd-ai-custom-prompt'
  const [aiCustomPrompt, setAiCustomPrompt] = useState('')
  const [aiPromptSaved, setAiPromptSaved] = useState(false)

  // 掛載後從 localStorage 讀取（不能在 useState 初始化函式裡讀，SSR 時 localStorage 不存在）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(AI_CUSTOM_PROMPT_KEY)
      if (saved) setAiCustomPrompt(saved)
    } catch {}
  }, [])

  const saveCustomPrompt = useCallback(() => {
    try {
      localStorage.setItem(AI_CUSTOM_PROMPT_KEY, aiCustomPrompt)
      setAiPromptSaved(true)
      setTimeout(() => setAiPromptSaved(false), 2000)
    } catch {}
  }, [aiCustomPrompt])

  const visitsForAi = useMemo(() => {
    let result = visits
    if (aiFilterSalesperson) result = result.filter((v) => v.salesperson === aiFilterSalesperson)
    if (aiFilterDateFrom) result = result.filter((v) => !!v.date && v.date.slice(0, 10) >= aiFilterDateFrom)
    if (aiFilterDateTo) result = result.filter((v) => !!v.date && v.date.slice(0, 10) <= aiFilterDateTo)
    return result
  }, [visits, aiFilterSalesperson, aiFilterDateFrom, aiFilterDateTo])

  // Ref so openAiModal (memoized with [] deps) always calls the latest runAiAnalysis
  const runAiAnalysisRef = useRef<() => Promise<void>>(async () => {})

  const runAiAnalysis = useCallback(async () => {
    setAiLoading(true)
    setAiError('')
    setAiAnalysis(null)
    try {
      // 直接傳篩選條件給 API，由伺服器端向 Notion 抓全部符合紀錄
      // 不再受 UI 分頁（已載入筆數）限制
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'overview',
          filterSalesperson: aiFilterSalesperson || undefined,
          filterDateFrom: aiFilterDateFrom || undefined,
          filterDateTo: aiFilterDateTo || undefined,
          customInstructions: aiCustomPrompt.trim() || undefined,
        }),
      })
      if (res.status === 401) { router.push('/login'); return }
      const data = await res.json()
      if (!res.ok) { setAiError(data.error ?? 'AI 分析失敗'); return }
      const result = data as OverviewAnalysis
      const timestamp = new Date().toISOString()
      const analyzedCount = result.analyzedCount ?? 0
      setAiAnalysis(result)
      setAiTimestamp(timestamp)
      setAiVisitCount(analyzedCount)
      try {
        localStorage.setItem(AI_STORAGE_KEY, JSON.stringify({
          result, timestamp,
          visitCount: analyzedCount,
          filterSalesperson: aiFilterSalesperson,
          filterDateFrom: aiFilterDateFrom,
          filterDateTo: aiFilterDateTo,
        }))
      } catch {}
    } catch {
      setAiError('網路錯誤，請重試')
    } finally {
      setAiLoading(false)
    }
  }, [router, aiFilterSalesperson, aiFilterDateFrom, aiFilterDateTo, aiCustomPrompt])

  // Keep ref pointing to latest runAiAnalysis (so openAiModal's [] closure always gets fresh fn)
  useEffect(() => { runAiAnalysisRef.current = runAiAnalysis }, [runAiAnalysis])

  // 開啟 Modal：先載入 localStorage 快取，若無快取則直接執行分析
  const openAiModal = useCallback(() => {
    setShowAiModal(true)
    setAiError('')
    try {
      const raw = localStorage.getItem(AI_STORAGE_KEY)
      if (raw) {
        const { result, timestamp, visitCount, filterSalesperson, filterDateFrom, filterDateTo } = JSON.parse(raw)
        setAiAnalysis(result)
        setAiTimestamp(timestamp)
        setAiVisitCount(visitCount)
        if (filterSalesperson) setAiFilterSalesperson(filterSalesperson)
        if (filterDateFrom) setAiFilterDateFrom(filterDateFrom)
        if (filterDateTo) setAiFilterDateTo(filterDateTo)
        return  // 有快取就直接顯示，不自動重新分析
      }
    } catch {}
    // 沒有快取 → 透過 ref 呼叫最新的 runAiAnalysis（避免 stale closure）
    runAiAnalysisRef.current()
  }, [])

  const exportAiPdf = useCallback(() => {
    if (!aiAnalysis) return
    const html = generatePdfHtml(aiAnalysis, aiTimestamp, aiVisitCount, {
      salesperson: aiFilterSalesperson,
      dateFrom: aiFilterDateFrom,
      dateTo: aiFilterDateTo,
    })
    // 用隱藏 iframe 列印，避免瀏覽器封鎖彈出視窗
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;top:-10000px;left:-10000px;width:1px;height:1px;border:none;'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) { document.body.removeChild(iframe); return }
    doc.open()
    doc.write(html)
    doc.close()
    setTimeout(() => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => { document.body.removeChild(iframe) }, 2000)
    }, 500)
  }, [aiAnalysis, aiTimestamp, aiVisitCount, aiFilterSalesperson, aiFilterDateFrom, aiFilterDateTo])

  // 一鍵批次分析：對所有已載入、有拜訪內容但尚未填「互動類型」或「客戶反應」的紀錄執行 AI 判斷並寫回 Notion
  const handleBatchAnalyze = useCallback(async () => {
    const toAnalyze = filteredVisits.filter(
      (v) => v.content?.trim() && (!v.customerReaction || !v.interactionType)
    )
    if (toAnalyze.length === 0 || batchAnalyzing) return

    setBatchAnalyzing(true)
    setBatchProgress({ done: 0, total: toAnalyze.length })

    for (let i = 0; i < toAnalyze.length; i++) {
      const visit = toAnalyze[i]
      try {
        // 一次呼叫同時判斷「互動類型」與「客戶反應」
        const suggestRes = await fetch('/api/ai/suggest-fields', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: visit.content,
            interactionTypeOptions: batchInteractionTypeOptions,
            reactionOptions: batchReactionOptions,
          }),
        })
        const { interactionType, customerReaction } = await suggestRes.json()

        // 只更新目前為空的欄位
        const patch: Record<string, string> = {}
        if (!visit.interactionType && interactionType) patch.interactionType = interactionType
        if (!visit.customerReaction && customerReaction) patch.customerReaction = customerReaction

        if (Object.keys(patch).length > 0) {
          // 寫回 Notion
          await fetch(`/api/visits/${visit.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          })
          // 樂觀更新本地狀態
          setVisits((prev) =>
            prev.map((v) => v.id === visit.id ? { ...v, ...patch } : v)
          )
        }
      } catch {
        // 靜默失敗，繼續下一筆
      }
      setBatchProgress({ done: i + 1, total: toAnalyze.length })
    }

    setBatchAnalyzing(false)
    setBatchProgress(null)
  }, [filteredVisits, batchReactionOptions, batchInteractionTypeOptions, batchAnalyzing])

  // 計算目前有幾筆等待分析（有內容但缺少互動類型或客戶反應）
  const batchPendingCount = filteredVisits.filter(
    (v) => v.content?.trim() && (!v.customerReaction || !v.interactionType)
  ).length

  // ── 批次補齊客戶關聯 handler ─────────────────────────────────
  const handleAutoLink = async () => {
    setAutoLinkRunning(true)
    setAutoLinkDone(false)
    setAutoLinkStats(null)
    autoLinkAbort.current = false

    let cursor: string | undefined
    let totalLinked = 0, totalSkipped = 0, totalNoMatch = 0, totalMultiMatch = 0
    const allNoMatchNames: string[] = []
    const allMultiMatchNames: string[] = []

    while (true) {
      if (autoLinkAbort.current) break
      try {
        const res = await fetch('/api/visits/auto-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cursor, batchSize: 30 }),
        })
        const data = await res.json()
        if (!res.ok) break

        totalLinked    += data.linked    ?? 0
        totalSkipped   += data.skipped   ?? 0
        totalNoMatch   += data.noMatch   ?? 0
        totalMultiMatch += data.multiMatch ?? 0
        for (const n of (data.noMatchNames ?? [])) {
          if (allNoMatchNames.length < 10 && !allNoMatchNames.includes(n)) allNoMatchNames.push(n)
        }
        for (const n of (data.multiMatchNames ?? [])) {
          if (allMultiMatchNames.length < 10 && !allMultiMatchNames.includes(n)) allMultiMatchNames.push(n)
        }

        setAutoLinkStats({
          linked: totalLinked, skipped: totalSkipped,
          noMatch: totalNoMatch, multiMatch: totalMultiMatch,
          noMatchNames: allNoMatchNames, multiMatchNames: allMultiMatchNames,
        })

        if (!data.hasMore || !data.nextCursor) break
        cursor = data.nextCursor
      } catch {
        break
      }
    }

    setAutoLinkRunning(false)
    setAutoLinkDone(true)
    // 重新載入第一頁（關聯已更新）
    if (totalLinked > 0) {
      try { sessionStorage.removeItem(CACHE_KEY) } catch {}
      loadVisits({ silent: true })
    }
  }

  // ── 批次偵測競品 ───────────────────────────────────────────────
  const handleDetectCompetitors = async () => {
    setDetectRunning(true)
    setDetectDone(false)
    setDetectStats(null)
    detectAbort.current = false

    let cursor: string | undefined
    let totalFilled = 0, totalSkipped = 0, totalNoContent = 0
    let competitorOptions: string[] = []
    const allExamples: { customerName: string; detected: string[] }[] = []

    while (true) {
      if (detectAbort.current) break
      try {
        const res = await fetch('/api/visits/detect-competitors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cursor, batchSize: 30 }),
        })
        const data = await res.json()
        if (!res.ok) break

        totalFilled    += data.filled    ?? 0
        totalSkipped   += data.skipped   ?? 0
        totalNoContent += data.noContent ?? 0
        if (data.competitorOptions?.length) competitorOptions = data.competitorOptions
        for (const ex of (data.examples ?? [])) {
          if (allExamples.length < 5) allExamples.push(ex)
        }

        setDetectStats({
          filled: totalFilled, skipped: totalSkipped,
          noContent: totalNoContent, competitorOptions,
          examples: allExamples,
        })

        if (!data.hasMore || !data.nextCursor) break
        cursor = data.nextCursor
      } catch {
        break
      }
    }

    setDetectRunning(false)
    setDetectDone(true)
    if (totalFilled > 0) {
      try { sessionStorage.removeItem(CACHE_KEY) } catch {}
      loadVisits({ silent: true })
    }
  }

  // ── 刪除重複項目 ───────────────────────────────────────────────
  // dryRun=true 先預覽要刪幾筆；dryRun=false 實際刪除
  const runDedup = async (dryRun: boolean) => {
    setDedupRunning(true)
    if (dryRun) { setDedupDone(false); setDedupStats(null) }
    try {
      const res = await fetch('/api/visits/dedup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      })
      const data = await res.json()
      if (res.ok) {
        setDedupStats({
          groups: data.groups ?? 0,
          duplicates: data.duplicates ?? 0,
          deleted: data.deleted ?? 0,
          examples: data.examples ?? [],
        })
        if (!dryRun) {
          setDedupDone(true)
          if ((data.deleted ?? 0) > 0) {
            try { sessionStorage.removeItem(CACHE_KEY) } catch {}
            loadVisits({ silent: true })
          }
        }
      }
    } catch {
      // 略過錯誤，UI 仍可關閉
    }
    setDedupRunning(false)
  }

  // ── 多選批次處理 helpers ───────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const allSelected = filteredVisits.length > 0 && filteredVisits.every((v) => selectedIds.has(v.id))
  const toggleSelectAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(filteredVisits.map((v) => v.id)))
  const clearSelection = () => { setSelectedIds(new Set()); setBulkConfirm(false) }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    try {
      const res = await fetch('/api/visits/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      })
      const data = await res.json()
      if (res.ok && (data.deleted ?? 0) > 0) {
        try { sessionStorage.removeItem(CACHE_KEY) } catch {}
        loadVisits({ silent: true })
      }
    } catch {
      // 略過
    }
    setBulkDeleting(false)
    clearSelection()
  }

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <section className="card-soft relative overflow-hidden px-5 py-5 sm:px-7 sm:py-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-brand-100/50 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow mb-1.5">今天的第一步</p>
          <h2 className="text-2xl font-bold tracking-tight text-stone-800">和客戶互動後，就在這裡留下紀錄</h2>
          <p className="mt-2 text-sm text-stone-500">記下客戶反應與下一步，之後追蹤不遺漏。</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="w-full shrink-0 rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 sm:w-auto"
        >
          ＋ 新增客情紀錄
        </button>
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-stone-800">客情紀錄</h3>
          <p className="mt-0.5 text-xs text-stone-400">搜尋、查看或更新過去紀錄</p>
        </div>
        <details className="group self-stretch sm:self-auto">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-stone-500 shadow-sm ring-1 ring-stone-900/[0.06] transition-all hover:text-brand-600 active:scale-95">
            整理與分析
            <span className="text-stone-300 transition-transform group-open:rotate-180">⌄</span>
          </summary>
          <div className="mt-2 flex flex-wrap justify-end gap-2 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-stone-900/[0.06] sm:max-w-xl">
          {/* 一鍵批次 AI 分析 */}
          <button
            onClick={handleBatchAnalyze}
            disabled={batchAnalyzing || batchPendingCount === 0}
            title={batchPendingCount === 0 ? '所有已載入紀錄均已填寫互動類型與客戶反應' : `分析 ${batchPendingCount} 筆缺少互動類型或客戶反應的紀錄`}
            className="flex min-h-11 items-center gap-1.5 rounded-full bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 ring-1 ring-violet-200 transition-all hover:bg-violet-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {batchAnalyzing && batchProgress ? (
              <><span className="animate-pulse text-base leading-none">✨</span> 分析中 {batchProgress.done}/{batchProgress.total}</>
            ) : (
              <><span className="text-base leading-none">✨</span> 一鍵分析{batchPendingCount > 0 ? `（${batchPendingCount}）` : ''}</>
            )}
          </button>
          <button
            onClick={openAiModal}
            disabled={visits.length === 0}
            className="flex min-h-11 items-center gap-1.5 rounded-full bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 ring-1 ring-violet-200 transition-all hover:bg-violet-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="text-base leading-none">✦</span>
            AI 商機分析
          </button>
          {canManageAll && (
            <>
              <button
                onClick={() => { setAutoLinkOpen(true); setAutoLinkDone(false); setAutoLinkStats(null) }}
                className="flex min-h-11 items-center gap-1.5 rounded-full bg-stone-50 px-4 py-2 text-sm font-medium text-stone-600 ring-1 ring-stone-200 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95"
                title="自動將客情紀錄的簡稱對照完整客戶名稱並建立關聯"
              >
                <span className="text-base leading-none">🔗</span> 補齊關聯
              </button>
              <button
                onClick={() => { setDetectOpen(true); setDetectDone(false); setDetectStats(null) }}
                className="flex min-h-11 items-center gap-1.5 rounded-full bg-stone-50 px-4 py-2 text-sm font-medium text-stone-600 ring-1 ring-stone-200 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95"
                title="掃描拜訪內文，自動偵測並填入競品欄位"
              >
                <span className="text-base leading-none">🔍</span> 偵測競品
              </button>
              <button
                onClick={() => { setDedupOpen(true); setDedupDone(false); setDedupStats(null); runDedup(true) }}
                className="flex min-h-11 items-center gap-1.5 rounded-full bg-stone-50 px-4 py-2 text-sm font-medium text-stone-500 ring-1 ring-stone-200 transition-all hover:bg-stone-100 active:scale-95"
                title="找出同客戶+同日期+同業務的重複紀錄，保留最完整一筆、刪除其餘"
              >
                <span className="text-base leading-none">🧹</span> 刪除重複
              </button>
            </>
          )}
          </div>
        </details>
        </div>

      {/* Search + Filter bar */}
      <div className="card-soft space-y-3 p-3 sm:p-4">
        {/* Search row */}
        <div className="relative">
          <svg className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋客戶名稱、互動方式或內容…"
            className="input-soft min-h-12 w-full pl-12 pr-11 text-base sm:text-sm"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="清除搜尋" className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-600 active:scale-95">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
        {/* Filter selects row */}
        <div className={`grid grid-cols-1 gap-2 ${canManageAll ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]' : 'sm:grid-cols-[minmax(0,1fr)_auto]'}`}>
          {canManageAll && (
            <select
              value={filterSalesperson}
              onChange={(e) => handleSalespersonFilter(e.target.value)}
              className="select-soft min-h-11 w-full text-sm"
            >
              <option value="">全部業務</option>
              {salespersonFilterOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <select
            value={filterCity}
            onChange={(e) => setFilterCity(e.target.value)}
            className="select-soft min-h-11 w-full text-sm"
          >
            <option value="">全部縣市</option>
            {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {isFiltered && (
            <button onClick={clearAll} className="min-h-11 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium text-stone-500 transition-all hover:bg-stone-100 active:scale-95">
              清除篩選
            </button>
          )}
        </div>
      </div>

      {/* 多選操作列 */}
      {selectedIds.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-col gap-3 rounded-2xl bg-brand-50 px-4 py-3 shadow-md ring-1 ring-brand-200/70 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-brand-700">已選 {selectedIds.size} 筆</span>
            <button onClick={toggleSelectAll} className="text-xs text-stone-500 hover:text-stone-700 transition-colors">
              {allSelected ? '取消全選' : '全選本頁'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {bulkConfirm ? (
              <>
                <span className="text-xs text-stone-600">確認刪除 {selectedIds.size} 筆？</span>
                <button onClick={handleBulkDelete} disabled={bulkDeleting} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-red-600 text-white hover:bg-red-700 active:scale-95 transition-all disabled:opacity-50">
                  {bulkDeleting ? '刪除中…' : '確認刪除'}
                </button>
                <button onClick={() => setBulkConfirm(false)} disabled={bulkDeleting} className="px-3 py-1.5 rounded-full text-xs text-stone-500 hover:bg-stone-100 transition-colors disabled:opacity-50">取消</button>
              </>
            ) : (
              <>
                <button onClick={() => setBulkConfirm(true)} className="px-3 py-1.5 rounded-full text-xs font-medium bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 active:scale-95 transition-all">🗑 刪除選取</button>
                <button onClick={clearSelection} className="px-3 py-1.5 rounded-full text-xs text-stone-500 hover:bg-stone-100 transition-colors">清除</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* List */}
      <div className="card-soft overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-stone-400">正在整理客情紀錄…</div>
        ) : visits.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-xl text-brand-600">＋</div>
            <p className="text-sm font-medium text-stone-700">還沒有客情紀錄</p>
            <p className="mt-1 text-sm text-stone-400">與客戶互動後，新增第一筆紀錄。</p>
            <button onClick={() => setShowModal(true)} className="mt-5 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95">新增客情紀錄</button>
          </div>
        ) : filteredVisits.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-medium text-stone-700">找不到符合條件的紀錄</p>
            <button onClick={clearAll} className="mt-3 min-h-11 rounded-full px-5 text-sm font-medium text-brand-600 transition-all hover:bg-brand-50 active:scale-95">清除搜尋與篩選</button>
          </div>
        ) : (
          <>
            {/* Filter result summary */}
            {isFiltered && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-900/[0.06] bg-stone-50/70 px-4 py-3">
                <span className="text-xs text-stone-500">
                  找到 <span className="font-semibold text-stone-800">{filteredVisits.length}</span> 筆
                  <span className="text-stone-400">（共 {visits.length} 筆）</span>
                </span>
                {filterSalesperson && (
                  <span className="chip inline-flex items-center gap-1 text-xs">
                    業務：{filterSalesperson}
                    <button onClick={() => setFilterSalesperson('')} className="hover:text-stone-900">✕</button>
                  </span>
                )}
                {filterCity && (
                  <span className="chip inline-flex items-center gap-1 text-xs">
                    縣市：{filterCity}
                    <button onClick={() => setFilterCity('')} className="hover:text-stone-900">✕</button>
                  </span>
                )}
              </div>
            )}

            {/* ── Mobile / iPad card list (< lg) ── */}
            <div className="space-y-2 bg-stone-50/40 p-2 lg:hidden">
              {filteredVisits.map((v) => (
                <div
                  key={v.id}
                  onClick={() => setViewingVisit(v)}
                  className={`cursor-pointer rounded-2xl bg-white px-4 py-4 shadow-sm ring-1 ring-stone-900/[0.05] transition-all active:scale-[0.99] ${selectedIds.has(v.id) ? 'bg-brand-50/70 ring-brand-200' : 'hover:shadow-md'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedIds.has(v.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSelect(v.id)}
                      className="mt-1 w-4 h-4 shrink-0 accent-brand-500 cursor-pointer"
                    />
                    {/* Left: main info */}
                    <div className="flex-1 min-w-0">
                      {/* Name + follow-up dot */}
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="truncate font-semibold text-stone-800">{v.customerName}</span>
                        {v.needsFollowUp && (
                          <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-orange-400" title="需要追蹤" />
                        )}
                      </div>
                      {/* Badges + city */}
                      <div className="flex flex-wrap items-center gap-1.5 mb-2">
                        <InteractionBadge interactionType={v.interactionType} fallbackStatus={v.status} />
                        <ReactionBadge reaction={v.customerReaction} />
                        {v.city && <span className="text-xs text-stone-400">{v.city}</span>}
                      </div>
                      {/* Content preview */}
                      {v.content && (
                        <p className="mb-2 line-clamp-2 text-sm leading-relaxed text-stone-600">{v.content}</p>
                      )}
                      {/* Meta: date + salesperson */}
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-stone-400">{formatDate(v.date)}</span>
                        {v.salesperson && <span className="text-xs text-stone-400">{v.salesperson}</span>}
                      </div>
                    </div>
                    {/* Right: actions */}
                    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                      {deleteConfirmId === v.id ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <span className="text-xs text-gray-500">確認刪除？</span>
                          <div className="flex gap-2">
                            <button onClick={() => handleDelete(v.id)} disabled={deleting} className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50">
                              {deleting ? '…' : '確認'}
                            </button>
                            <button onClick={() => setDeleteConfirmId(null)} className="text-xs text-gray-400 hover:text-gray-600">取消</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-1">
                          <button onClick={(e) => { e.stopPropagation(); setEditingVisit(v); setDeleteConfirmId(null) }} className="min-h-11 rounded-full px-3 text-xs font-medium text-brand-600 transition-all hover:bg-brand-50 active:scale-95">編輯</button>
                          <button onClick={(e) => { e.stopPropagation(); setDeleteConfirmId(v.id) }} className="min-h-11 rounded-full px-3 text-xs text-stone-300 transition-all hover:bg-red-50 hover:text-red-500 active:scale-95">刪除</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* ── Desktop table (lg+) ── */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-stone-900/[0.06] bg-stone-50/80 text-xs text-stone-400">
                  <tr>
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 accent-brand-500 cursor-pointer align-middle"
                        title="全選本頁"
                      />
                    </th>
                    <th className="px-4 py-3 text-left font-medium">日期</th>
                    <th className="px-4 py-3 text-left font-medium">客戶名稱</th>
                    <th className="px-4 py-3 text-left font-medium">縣市</th>
                    <th className="px-4 py-3 text-left font-medium">互動類型</th>
                    <th className="px-4 py-3 text-left font-medium">客戶反應</th>
                    <th className="px-4 py-3 text-left font-medium">業務人員</th>
                    <th className="px-4 py-3 text-left font-medium">拜訪內容</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-900/[0.05]">
                  {filteredVisits.map((v) => (
                    <tr key={v.id} onClick={() => setViewingVisit(v)} className={`group cursor-pointer transition-colors ${selectedIds.has(v.id) ? 'bg-brand-50/60' : 'hover:bg-brand-50/40'}`}>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(v.id)}
                          onChange={() => toggleSelect(v.id)}
                          className="w-4 h-4 accent-brand-500 cursor-pointer align-middle"
                        />
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-stone-500">{formatDate(v.date)}</td>
                      <td className="px-4 py-4 font-semibold text-stone-800">
                        {v.customerName}
                        {v.needsFollowUp && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-orange-400 align-middle" title="需要追蹤" />}
                      </td>
                      <td className="px-4 py-4 text-stone-500">{v.city || '—'}</td>
                      <td className="px-4 py-3"><InteractionBadge interactionType={v.interactionType} fallbackStatus={v.status} /></td>
                      <td className="px-4 py-3"><ReactionBadge reaction={v.customerReaction} /></td>
                      <td className="px-4 py-4 text-stone-500">{v.salesperson || '—'}</td>
                      <td className="max-w-xs truncate px-4 py-4 text-stone-500">{v.content || '—'}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {deleteConfirmId === v.id ? (
                          <div className="flex items-center gap-2 justify-end">
                            <span className="text-xs text-gray-500">確認刪除？</span>
                            <button onClick={() => handleDelete(v.id)} disabled={deleting} className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50">{deleting ? '…' : '確認'}</button>
                            <button onClick={() => setDeleteConfirmId(null)} className="text-xs text-gray-400 hover:text-gray-600">取消</button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                            <button onClick={() => { setEditingVisit(v); setDeleteConfirmId(null) }} className="rounded-full px-3 py-2 text-xs font-medium text-brand-600 transition-all hover:bg-brand-50 active:scale-95">編輯</button>
                            <button onClick={() => setDeleteConfirmId(v.id)} className="rounded-full px-3 py-2 text-xs text-stone-300 transition-all hover:bg-red-50 hover:text-red-500 active:scale-95">刪除</button>
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
            className="button-secondary px-5 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
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

      {/* AI 商機分析 Modal */}
      {showAiModal && (
        <AiAnalysisModal
          analysis={aiAnalysis}
          loading={aiLoading}
          error={aiError}
          timestamp={aiTimestamp}
          visitCount={aiVisitCount}
          filteredCount={visitsForAi.length}
          totalVisits={visits.length}
          onReanalyze={runAiAnalysis}
          onClose={() => setShowAiModal(false)}
          onExportPdf={exportAiPdf}
          salespersonOptions={salespersonFilterOptions}
          filterSalesperson={aiFilterSalesperson}
          filterDateFrom={aiFilterDateFrom}
          filterDateTo={aiFilterDateTo}
          onFilterSalespersonChange={setAiFilterSalesperson}
          onFilterDateFromChange={setAiFilterDateFrom}
          onFilterDateToChange={setAiFilterDateTo}
          customPrompt={aiCustomPrompt}
          onCustomPromptChange={setAiCustomPrompt}
          onSavePrompt={saveCustomPrompt}
          promptSaved={aiPromptSaved}
        />
      )}

      {/* New Visit Modal */}
      {showModal && (
        <VisitModal
          prefillCustomer={initialCustomerName ? { name: initialCustomerName } : undefined}
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

      {/* ── 批次補齊客戶關聯 Modal ── */}
      <AnimatePresence>
        {autoLinkOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50"
              onClick={() => { if (!autoLinkRunning) setAutoLinkOpen(false) }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
            >
              <div className="max-h-[94vh] w-full max-w-md space-y-5 overflow-y-auto rounded-t-3xl bg-[#fdfdfb] p-5 shadow-2xl ring-1 ring-stone-900/[0.06] sm:rounded-3xl sm:p-6">
                <div>
                  <p className="eyebrow mb-1">資料整理</p>
                  <h3 className="text-lg font-semibold text-stone-800">🔗 批次補齊客戶關聯</h3>
                  <p className="mt-1 text-sm text-stone-500">
                    自動比對客情紀錄的客戶簡稱與客戶資料庫，若唯一符合則建立關聯並更新為完整名稱。
                  </p>
                </div>

                {!autoLinkRunning && !autoLinkDone && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 space-y-1">
                    <p className="font-medium">執行前請確認：</p>
                    <ul className="list-disc list-inside space-y-0.5 text-xs">
                      <li>只處理尚未關聯客戶的紀錄</li>
                      <li>搜尋結果唯一才會自動關聯（多個候選則略過）</li>
                      <li>關聯後客戶名稱會更新為資料庫中的完整名稱</li>
                      <li>大量資料需要幾分鐘，請勿關閉視窗</li>
                    </ul>
                  </div>
                )}

                {/* 進度 / 結果 */}
                {(autoLinkRunning || autoLinkDone) && autoLinkStats && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="bg-brand-50 border border-brand-200 rounded-xl py-3">
                        <div className="text-2xl font-bold text-green-700">{autoLinkStats.linked}</div>
                        <div className="text-xs text-green-600 mt-0.5">成功關聯</div>
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded-xl py-3">
                        <div className="text-2xl font-bold text-gray-700">{autoLinkStats.skipped}</div>
                        <div className="text-xs text-gray-500 mt-0.5">略過</div>
                      </div>
                    </div>

                    {autoLinkStats.noMatch > 0 && (
                      <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                        <span className="font-medium text-gray-700">找不到客戶（{autoLinkStats.noMatch} 筆）：</span>
                        {' '}{autoLinkStats.noMatchNames.slice(0, 5).join('、')}
                        {autoLinkStats.noMatchNames.length > 5 ? '…' : ''}
                      </div>
                    )}
                    {autoLinkStats.multiMatch > 0 && (
                      <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                        <span className="font-medium text-gray-700">多個候選（{autoLinkStats.multiMatch} 筆）：</span>
                        {' '}{autoLinkStats.multiMatchNames.slice(0, 5).join('、')}
                        {autoLinkStats.multiMatchNames.length > 5 ? '…' : ''}
                      </div>
                    )}

                    {autoLinkRunning && (
                      <p className="text-xs text-blue-500 text-center animate-pulse">處理中，請稍候…</p>
                    )}
                    {autoLinkDone && (
                      <p className="text-sm text-emerald-600 text-center font-medium">✅ 完成！</p>
                    )}
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  {!autoLinkRunning && !autoLinkDone && (
                    <button
                      onClick={handleAutoLink}
                      className="min-h-12 flex-1 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95"
                    >
                      開始補齊關聯
                    </button>
                  )}
                  {autoLinkRunning && (
                    <button
                      onClick={() => { autoLinkAbort.current = true }}
                      className="flex-1 py-2.5 text-sm rounded-xl font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
                    >
                      停止
                    </button>
                  )}
                  <button
                    onClick={() => { if (!autoLinkRunning) setAutoLinkOpen(false) }}
                    disabled={autoLinkRunning}
                    className="min-h-12 flex-1 rounded-full px-5 py-2.5 text-sm font-medium text-stone-500 ring-1 ring-stone-200 transition-all hover:bg-stone-100 active:scale-95 disabled:opacity-40"
                  >
                    {autoLinkDone ? '關閉' : '取消'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}

        {/* ── 刪除重複項目 Modal ───────────────────────────────── */}
        {dedupOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-50"
              onClick={() => { if (!dedupRunning) setDedupOpen(false) }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
            >
              <div className="max-h-[94vh] w-full max-w-md space-y-5 overflow-y-auto rounded-t-3xl bg-[#fdfdfb] p-5 shadow-2xl ring-1 ring-stone-900/[0.06] sm:rounded-3xl sm:p-6">
                <div>
                  <p className="eyebrow mb-1">資料清理</p>
                  <h3 className="text-lg font-semibold text-stone-800">🧹 刪除重複項目</h3>
                  <p className="mt-1 text-sm text-stone-500">
                    以「客戶＋日期＋業務」為同一次拜訪，同組保留內容最完整的一筆，刪除其餘重複。
                  </p>
                </div>

                {/* 預覽掃描中 */}
                {dedupRunning && !dedupDone && (
                  <p className="text-sm text-blue-500 text-center animate-pulse py-4">
                    {dedupStats ? '刪除中，請稍候…' : '掃描重複紀錄中…'}
                  </p>
                )}

                {/* 預覽 / 結果 */}
                {dedupStats && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="bg-amber-50 border border-amber-200 rounded-xl py-3">
                        <div className="text-2xl font-bold text-amber-700">{dedupStats.groups}</div>
                        <div className="text-xs text-amber-600 mt-0.5">重複組數</div>
                      </div>
                      <div className="bg-red-50 border border-red-200 rounded-xl py-3">
                        <div className="text-2xl font-bold text-red-700">
                          {dedupDone ? dedupStats.deleted : dedupStats.duplicates}
                        </div>
                        <div className="text-xs text-red-600 mt-0.5">{dedupDone ? '已刪除' : '可刪除'}</div>
                      </div>
                    </div>

                    {dedupStats.examples.length > 0 && (
                      <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 space-y-0.5 max-h-40 overflow-y-auto">
                        <p className="font-medium text-gray-700">重複範例：</p>
                        {dedupStats.examples.map((ex, i) => (
                          <div key={i}>
                            {ex.date}　{ex.customerName}　{ex.salesperson || '—'}
                            <span className="text-red-500">×{ex.count}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {dedupDone && (
                      <p className="text-sm text-emerald-600 text-center font-medium">✅ 完成！</p>
                    )}
                    {!dedupDone && dedupStats.duplicates === 0 && (
                      <p className="text-sm text-emerald-600 text-center font-medium">沒有發現重複項目 🎉</p>
                    )}
                  </div>
                )}

                <div className="flex gap-3 pt-1">
                  {!dedupDone && dedupStats && dedupStats.duplicates > 0 && (
                    <button
                      onClick={() => runDedup(false)}
                      disabled={dedupRunning}
                      className="flex-1 py-2.5 text-sm rounded-xl font-medium bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-40"
                    >
                      {dedupRunning ? '刪除中…' : `刪除 ${dedupStats.duplicates} 筆重複`}
                    </button>
                  )}
                  <button
                    onClick={() => { if (!dedupRunning) setDedupOpen(false) }}
                    disabled={dedupRunning}
                    className="flex-1 py-2.5 text-sm rounded-xl font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition disabled:opacity-40"
                  >
                    {dedupDone ? '關閉' : '取消'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}

        {/* ── 偵測競品 Modal ───────────────────────────────────── */}
        {detectOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { if (!detectRunning) setDetectOpen(false) }}
            />
            <motion.div
              className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:px-4 sm:py-8"
              initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}
            >
              <div className="max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-[#fdfdfb] shadow-2xl ring-1 ring-stone-900/[0.06] sm:rounded-3xl">
                {/* Header */}
                <div className="px-5 py-4 border-b border-brand-100/60 bg-brand-50/40">
                  <h3 className="font-bold text-gray-900">🔍 自動偵測競品</h3>
                  <p className="text-xs text-gray-500 mt-0.5">掃描拜訪內文，比對 Notion 競品選項並自動填入</p>
                </div>

                <div className="px-5 py-4 space-y-4">
                  {/* 說明 */}
                  {!detectRunning && !detectDone && (
                    <div className="text-sm text-gray-600 space-y-1.5">
                      <p>• 只處理<span className="font-medium">競品欄位為空</span>的紀錄，不覆蓋已填資料</p>
                      <p>• 以 Notion 競品選項名稱直接比對內文關鍵字</p>
                      <p>• 如需新增競品選項，請至 Notion 競品欄位新增後再執行</p>
                    </div>
                  )}

                  {/* 統計 */}
                  {detectStats && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: '成功填入', value: detectStats.filled, color: 'text-emerald-600' },
                          { label: '無匹配', value: detectStats.skipped, color: 'text-gray-500' },
                          { label: '無內文', value: detectStats.noContent, color: 'text-gray-400' },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="text-center bg-gray-50 rounded-xl py-3">
                            <div className={`text-xl font-bold ${color}`}>{value}</div>
                            <div className="text-[11px] text-gray-400 mt-0.5">{label}</div>
                          </div>
                        ))}
                      </div>

                      {/* 競品選項清單 */}
                      {detectStats.competitorOptions.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1.5">比對的競品選項（共 {detectStats.competitorOptions.length} 項）</p>
                          <div className="flex flex-wrap gap-1">
                            {detectStats.competitorOptions.map((opt) => (
                              <span key={opt} className="text-[11px] px-2 py-0.5 bg-brand-50 text-emerald-700 border border-brand-100 rounded-full">{opt}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 成功範例 */}
                      {detectStats.examples.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-400 mb-1.5">填入範例</p>
                          <div className="space-y-1">
                            {detectStats.examples.map((ex, i) => (
                              <div key={i} className="text-xs bg-gray-50 rounded-lg px-3 py-1.5 flex items-center justify-between gap-2">
                                <span className="text-gray-700 truncate">{ex.customerName || '（未知客戶）'}</span>
                                <span className="text-emerald-600 font-medium shrink-0">{ex.detected.join('、')}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 執行中 */}
                  {detectRunning && (
                    <div className="flex items-center gap-2 text-sm text-emerald-600">
                      <span className="animate-spin">⏳</span> 掃描中，請稍候…
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="px-5 pb-5 flex gap-2">
                  {!detectRunning && !detectDone && (
                    <button
                      onClick={handleDetectCompetitors}
                      className="flex-1 py-2.5 text-sm rounded-xl font-medium bg-brand-600 text-white hover:bg-brand-700 transition"
                    >
                      開始偵測
                    </button>
                  )}
                  {detectRunning && (
                    <button
                      onClick={() => { detectAbort.current = true }}
                      className="flex-1 py-2.5 text-sm rounded-xl font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition"
                    >
                      停止
                    </button>
                  )}
                  <button
                    onClick={() => { if (!detectRunning) setDetectOpen(false) }}
                    disabled={detectRunning}
                    className="flex-1 py-2.5 text-sm rounded-xl font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition disabled:opacity-40"
                  >
                    {detectDone ? '關閉' : '取消'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
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
            className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto sm:items-start sm:px-4 sm:py-8"
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
              <div className="max-h-[94vh] overflow-hidden rounded-t-3xl bg-[#fdfdfb] shadow-2xl ring-1 ring-stone-900/[0.06] sm:max-h-none sm:rounded-3xl">
                {/* Header */}
                <div className="flex items-start justify-between gap-4 border-b border-stone-900/[0.06] px-5 py-4 sm:px-6 sm:py-5">
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
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg leading-none text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-600 active:scale-95"
                  >
                    ✕
                  </button>
                </div>

                {/* Content */}
                <div className="max-h-[68vh] space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
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
                          <span key={p.id} className="text-xs bg-brand-50 text-emerald-700 border border-brand-200/50 rounded-full px-2.5 py-0.5 font-medium">
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
                <div className="flex gap-2 border-t border-stone-900/[0.06] bg-white/80 px-5 py-4 sm:px-6">
                  <button
                    onClick={() => onEdit(visit)}
                    className="min-h-11 flex-1 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95"
                  >
                    編輯紀錄
                  </button>
                  <button
                    onClick={handleClose}
                    className="min-h-11 rounded-full px-5 py-2.5 text-sm font-medium text-stone-500 transition-all hover:bg-stone-100 active:scale-95"
                  >
                    關閉
                  </button>
                  <button
                    onClick={() => onDelete(visit.id)}
                    className="min-h-11 rounded-full px-4 py-2.5 text-sm font-medium text-stone-400 transition-all hover:bg-red-50 hover:text-red-500 active:scale-95"
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
  prefillCustomer?: { id?: string; name: string; city?: string; district?: string; address?: string }
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
    customerId: initialData?.customerId ?? prefillCustomer?.id ?? '',
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
  // 合併預設選項 + Notion 已有選項（去重，預設排前）
  const mergedReactionOptions = Array.from(
    new Set([...DEFAULT_REACTION_OPTIONS, ...customerReactionOptions])
  )

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

  const inputCls = 'input-soft min-h-11 w-full text-base sm:text-sm'

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
            className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto sm:items-start sm:px-4 sm:py-8"
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
              <div className="max-h-[96vh] overflow-hidden rounded-t-3xl bg-[#fdfdfb] shadow-2xl ring-1 ring-stone-900/[0.06] sm:max-h-none sm:rounded-3xl">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-stone-900/[0.06] px-5 py-4 sm:px-6 sm:py-5">
                  <div>
                    <p className="eyebrow mb-1">客情管理</p>
                    <h3 className="text-lg font-bold text-stone-800">
                      {isEdit ? '編輯客情紀錄' : '新增客情紀錄'}
                    </h3>
                  </div>
                  <button
                    onClick={handleClose}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-lg leading-none text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-600 active:scale-95"
                  >
                    ✕
                  </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="max-h-[78vh] space-y-5 overflow-y-auto px-5 py-5 sm:max-h-[72vh] sm:px-6">
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

                    {/* 客戶連結狀態列 */}
                    <div className="mt-1.5 flex items-center gap-2 min-h-[20px]">
                      {form.customerId ? (
                        <>
                          <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                            <span>🔗</span>
                            <span>已連結至客戶資料庫</span>
                          </span>
                          {!prefillCustomer && (
                            <button
                              type="button"
                              onClick={() => setForm((f) => ({ ...f, customerId: '' }))}
                              className="text-xs text-stone-400 hover:text-red-500 underline underline-offset-2 transition-colors"
                            >
                              解除連結
                            </button>
                          )}
                        </>
                      ) : (
                        !prefillCustomer && (
                          <span className="text-xs text-stone-400">
                            未連結 — 輸入名稱從下拉選取可建立連結
                          </span>
                        )
                      )}
                    </div>
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
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-medium text-stone-500">客戶反應</label>
                      <AIReactionButton
                        content={form.content}
                        options={mergedReactionOptions}
                        onSuggest={(v) => setForm((f) => ({ ...f, customerReaction: v }))}
                      />
                    </div>
                    <ReactionCombobox
                      value={form.customerReaction}
                      options={mergedReactionOptions}
                      onChange={(v) => setForm((f) => ({ ...f, customerReaction: v }))}
                      inputCls={inputCls}
                    />
                  </div>

                  {/* 有興趣的產品 */}
                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">有興趣的產品</label>
                    {form.interestedProductIds.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {form.interestedProductIds.map((id) => (
                          <span key={id} className="inline-flex items-center gap-1 text-xs bg-brand-50 text-emerald-700 border border-brand-200/60 rounded-full px-2.5 py-0.5">
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

                  <div className="sticky bottom-0 -mx-5 flex gap-3 border-t border-stone-900/[0.06] bg-[#fdfdfb]/95 px-5 pb-1 pt-4 backdrop-blur sm:-mx-6 sm:px-6">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="min-h-12 flex-1 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50"
                    >
                      {submitting ? (isEdit ? '儲存中…' : '建立中…') : (isEdit ? '儲存變更' : '建立紀錄')}
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="min-h-12 rounded-full px-5 py-2.5 text-sm font-medium text-stone-500 transition-all hover:bg-stone-100 active:scale-95"
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

// ── PDF 產生 ──────────────────────────────────────────────────

function generatePdfHtml(
  analysis: OverviewAnalysis,
  timestamp: string | null,
  visitCount: number,
  filter: { salesperson: string; dateFrom: string; dateTo: string },
): string {
  const formatTs = (iso: string) => {
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  const filterParts = [
    filter.salesperson || '全部業務',
    filter.dateFrom || filter.dateTo
      ? `${filter.dateFrom || '—'} 至 ${filter.dateTo || '—'}`
      : '全部時間',
  ]
  const card = (name: string, desc: string, sub?: string) =>
    `<div class="card"><div class="card-name">${name}${sub ? ` <small>${sub}</small>` : ''}</div><div class="card-desc">${desc}</div></div>`

  const hotHtml = analysis.hotCustomers?.length
    ? analysis.hotCustomers.map((c) => card(c.name, c.reason)).join('')
    : '<p class="empty">無</p>'

  const productHtml = analysis.productDemand?.length
    ? `<table><tr><th>產品 / 需求</th><th>次數</th><th>備註</th></tr>${
        analysis.productDemand.map((p) =>
          `<tr><td>${p.product}</td><td class="num">${p.count}</td><td>${p.note}</td></tr>`
        ).join('')}</table>`
    : '<p class="empty">無</p>'

  const compHtml = analysis.competitorThreats?.length
    ? `<table><tr><th>競品</th><th>次數</th><th>威脅情境</th></tr>${
        analysis.competitorThreats.map((c) =>
          `<tr><td>${c.competitor}</td><td class="num">${c.count}</td><td>${c.note}</td></tr>`
        ).join('')}</table>`
    : '<p class="empty">無</p>'

  const followHtml = analysis.followUpUrgent?.length
    ? analysis.followUpUrgent.map((f) => card(f.name, f.reason, f.date)).join('')
    : '<p class="empty">無</p>'

  const suggestHtml = analysis.strategicSuggestions?.length
    ? `<ol>${analysis.strategicSuggestions.map((s) => `<li>${s}</li>`).join('')}</ol>`
    : '<p class="empty">無</p>'

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>AI 商機分析報告</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system,"PingFang TC","PingFang SC","Microsoft JhengHei","Microsoft YaHei",sans-serif; font-size: 13px; color: #333; padding: 32px; }
h1 { font-size: 20px; font-weight: 700; color: #1e1b4b; margin-bottom: 4px; }
.meta { font-size: 11px; color: #888; margin-bottom: 6px; }
.filter-bar { display: flex; gap: 16px; background: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 8px; padding: 8px 14px; margin: 12px 0 24px; font-size: 11px; color: #555; }
.filter-bar strong { color: #6d28d9; }
.section { margin-bottom: 22px; page-break-inside: avoid; }
.section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
.card { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; margin-bottom: 6px; }
.card-name { font-weight: 600; font-size: 13px; color: #1f2937; margin-bottom: 3px; }
.card-name small { font-weight: 400; color: #9ca3af; margin-left: 6px; }
.card-desc { font-size: 12px; color: #6b7280; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { background: #f9fafb; font-weight: 600; color: #374151; padding: 7px 10px; text-align: left; border-bottom: 2px solid #e5e7eb; }
td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; color: #374151; vertical-align: top; }
td.num { text-align: center; font-weight: 600; color: #059669; }
ol { padding-left: 20px; }
ol li { margin-bottom: 6px; line-height: 1.6; }
.empty { color: #9ca3af; font-size: 12px; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 22px; }
@media print { body { padding: 16px; } .section { page-break-inside: avoid; } @page { margin: 1.5cm; } }
</style>
</head>
<body>
<h1>✦ AI 商機分析報告</h1>
<p class="meta">分析時間：${timestamp ? formatTs(timestamp) : '—'}・共 ${visitCount} 筆紀錄・期間：${analysis.period || '—'}</p>
<div class="filter-bar">篩選條件：<strong>${filterParts.join('　|　')}</strong></div>
<div class="section"><div class="section-title" style="color:#6d28d9">⭐ 高潛力客戶</div>${hotHtml}</div>
<div class="two-col">
  <div class="section"><div class="section-title" style="color:#059669">📦 產品需求趨勢</div>${productHtml}</div>
  <div class="section"><div class="section-title" style="color:#d97706">⚠️ 競品威脅雷達</div>${compHtml}</div>
</div>
<div class="section"><div class="section-title" style="color:#dc2626">🔴 需緊急追蹤</div>${followHtml}</div>
<div class="section"><div class="section-title" style="color:#6d28d9">💡 策略建議</div>${suggestHtml}</div>
</body></html>`
}

// ── AI 商機分析 Modal ─────────────────────────────────────────

function AiAnalysisModal({
  analysis,
  loading,
  error,
  timestamp,
  visitCount,
  filteredCount,
  totalVisits,
  onReanalyze,
  onClose,
  onExportPdf,
  salespersonOptions,
  filterSalesperson,
  filterDateFrom,
  filterDateTo,
  onFilterSalespersonChange,
  onFilterDateFromChange,
  onFilterDateToChange,
  customPrompt,
  onCustomPromptChange,
  onSavePrompt,
  promptSaved,
}: {
  analysis: OverviewAnalysis | null
  loading: boolean
  error: string
  timestamp: string | null
  visitCount: number
  filteredCount: number
  totalVisits: number
  onReanalyze: () => void
  onClose: () => void
  onExportPdf: () => void
  salespersonOptions: string[]
  filterSalesperson: string
  filterDateFrom: string
  filterDateTo: string
  onFilterSalespersonChange: (v: string) => void
  onFilterDateFromChange: (v: string) => void
  onFilterDateToChange: (v: string) => void
  customPrompt: string
  onCustomPromptChange: (v: string) => void
  onSavePrompt: () => void
  promptSaved: boolean
}) {
  const [showPromptEditor, setShowPromptEditor] = useState(false)

  // ── 快速期間預設 ─────────────────────────────────────────────
  function getPresetRange(preset: 'week' | 'month' | 'quarter') {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

    if (preset === 'week') {
      const day = now.getDay() === 0 ? 7 : now.getDay() // Mon=1 … Sun=7
      const mon = new Date(now); mon.setDate(now.getDate() - day + 1)
      const sun = new Date(mon);  sun.setDate(mon.getDate() + 6)
      return { from: fmt(mon), to: fmt(sun) }
    }
    if (preset === 'month') {
      const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from, to: fmt(last) }
    }
    // quarter
    const q     = Math.floor(now.getMonth() / 3)
    const qFrom = new Date(now.getFullYear(), q * 3, 1)
    const qTo   = new Date(now.getFullYear(), q * 3 + 3, 0)
    return { from: fmt(qFrom), to: fmt(qTo) }
  }

  const activePreset = (() => {
    const { from: wf, to: wt } = getPresetRange('week')
    const { from: mf, to: mt } = getPresetRange('month')
    const { from: qf, to: qt } = getPresetRange('quarter')
    if (filterDateFrom === wf && filterDateTo === wt) return 'week'
    if (filterDateFrom === mf && filterDateTo === mt) return 'month'
    if (filterDateFrom === qf && filterDateTo === qt) return 'quarter'
    return null
  })()

  function applyPreset(preset: 'week' | 'month' | 'quarter') {
    const { from, to } = getPresetRange(preset)
    onFilterDateFromChange(from)
    onFilterDateToChange(to)
  }

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  function formatTimestamp(iso: string) {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  return (
    <AnimatePresence>
      <>
        {/* Backdrop */}
        <motion.div
          className="fixed inset-0 z-40 bg-stone-900/50 backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto sm:items-start sm:px-4 sm:py-8"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="relative w-full max-w-2xl"
            initial={{ opacity: 0, y: 32, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <div className="max-h-[96vh] overflow-hidden rounded-t-3xl bg-[#fdfdfb] shadow-2xl ring-1 ring-stone-900/[0.06] sm:rounded-3xl">
              {/* Header */}
              <div className="px-6 py-5 border-b border-violet-100/60 bg-violet-50/40 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-violet-500 text-lg">✦</span>
                    <h3 className="text-lg font-bold text-stone-800">AI 商機分析</h3>
                  </div>
                  {timestamp && (
                    <p className="text-xs text-stone-400">
                      上次分析：{formatTimestamp(timestamp)}・共 {visitCount} 筆紀錄
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {analysis && !loading && (
                    <button
                      onClick={onExportPdf}
                      className="text-xs text-stone-500 hover:text-stone-700 font-medium border border-stone-200 bg-white rounded-full px-3 py-1.5 transition"
                    >
                      匯出 PDF
                    </button>
                  )}
                  <button
                    onClick={() => setShowPromptEditor((v) => !v)}
                    title="自訂分析提示詞"
                    className={`w-8 h-8 flex items-center justify-center rounded-full text-base transition ${showPromptEditor ? 'bg-violet-100 text-violet-600' : 'text-stone-400 hover:text-stone-600 hover:bg-stone-100'}`}
                  >⚙️</button>
                  <button
                    onClick={onReanalyze}
                    disabled={loading}
                    className="text-xs text-violet-600 hover:text-violet-800 font-medium border border-violet-200 bg-white rounded-full px-3 py-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {loading ? '分析中…' : '重新分析'}
                  </button>
                  <button
                    onClick={onClose}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition text-lg leading-none"
                  >✕</button>
                </div>
              </div>

              {/* 篩選條件 */}
              <div className="px-6 py-3 border-b border-violet-100/40 bg-violet-50/20">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-stone-400 shrink-0">業務</span>
                  <select
                    value={filterSalesperson}
                    onChange={(e) => onFilterSalespersonChange(e.target.value)}
                    className="w-32 h-8 text-sm border border-stone-200 rounded-lg px-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 transition"
                  >
                    <option value="">全部業務</option>
                    {salespersonOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {/* 快速期間 */}
                  {(
                    [
                      { key: 'week',    label: '本週' },
                      { key: 'month',   label: '本月' },
                      { key: 'quarter', label: '本季' },
                    ] as const
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => applyPreset(key)}
                      className={`h-8 px-3 text-xs font-medium rounded-lg border transition ${
                        activePreset === key
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-white text-stone-500 border-stone-200 hover:border-violet-300 hover:text-violet-600'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="text-xs text-stone-300">|</span>
                  <input
                    type="date"
                    value={filterDateFrom}
                    onChange={(e) => onFilterDateFromChange(e.target.value)}
                    className="w-36 h-8 text-sm border border-stone-200 rounded-lg px-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 transition"
                  />
                  <span className="text-xs text-stone-300">—</span>
                  <input
                    type="date"
                    value={filterDateTo}
                    onChange={(e) => onFilterDateToChange(e.target.value)}
                    className="w-36 h-8 text-sm border border-stone-200 rounded-lg px-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 transition"
                  />
                  <span className="text-xs text-stone-400 ml-auto shrink-0">
                    {visitCount > 0
                      ? <>上次分析 <span className="font-semibold text-violet-600">{visitCount}</span> 筆</>
                      : '分析時自動抓取全部符合紀錄'}
                  </span>
                </div>
              </div>

              {/* 提示詞編輯面板 */}
              {showPromptEditor && (
                <div className="px-6 py-4 border-b border-amber-100/60 bg-amber-50/30">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-stone-600">
                      分析提示詞
                      <span className="ml-2 font-normal text-stone-400">調整後需點「儲存」才會記住</span>
                    </label>
                    <div className="flex items-center gap-2">
                      {customPrompt.trim() && (
                        <button
                          onClick={() => onCustomPromptChange('')}
                          className="text-xs text-stone-400 hover:text-red-500 transition"
                        >
                          清除
                        </button>
                      )}
                      <button
                        onClick={onSavePrompt}
                        className={`text-xs font-medium px-3 py-1 rounded-full border transition ${
                          promptSaved
                            ? 'bg-brand-50 border-brand-200 text-emerald-600'
                            : 'bg-amber-100 border-amber-300 text-amber-700 hover:bg-amber-200'
                        }`}
                      >
                        {promptSaved ? '✓ 已儲存' : '儲存'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={customPrompt}
                    onChange={(e) => onCustomPromptChange(e.target.value)}
                    rows={3}
                    placeholder="例：請專注於客戶商機、產品需求與競品動態分析。不需要對業務人員的工作分配、人力管理或團隊負荷提出建議。"
                    className="w-full text-sm border border-stone-200 rounded-xl px-3 py-2.5 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 placeholder:text-stone-300 transition"
                  />
                  <p className="text-[11px] text-stone-400 mt-1.5">儲存後下次開啟自動帶入 · 調整後點「重新分析」套用至本次分析</p>
                </div>
              )}

              {/* Content */}
              <div className="px-6 py-6 space-y-6 max-h-[55vh] overflow-y-auto">

                {/* Loading */}
                {loading && (
                  <div className="flex flex-col items-center justify-center py-12 gap-4">
                    <svg className="animate-spin w-8 h-8 text-violet-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    <p className="text-sm text-violet-500">AI 正在分析拜訪紀錄中…</p>
                  </div>
                )}

                {/* Error */}
                {error && !loading && (
                  <div className="bg-red-50 border border-red-200/60 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>
                )}

                {/* Results */}
                {analysis && !loading && (
                  <>
                    {/* 高潛力客戶 */}
                    {analysis.hotCustomers?.length > 0 && (
                      <section>
                        <h4 className="text-xs font-semibold uppercase tracking-widest text-violet-500 mb-3">⭐ 高潛力客戶</h4>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {analysis.hotCustomers.map((c, i) => (
                            <div key={i} className="bg-violet-50/50 rounded-xl px-4 py-3 border border-violet-100/60">
                              <p className="text-sm font-semibold text-stone-800">{c.name}</p>
                              <p className="text-xs text-stone-500 mt-1 leading-relaxed">{c.reason}</p>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {/* 產品需求 + 競品 */}
                    <div className="grid gap-5 sm:grid-cols-2">
                      {analysis.productDemand?.length > 0 && (
                        <section>
                          <h4 className="text-xs font-semibold uppercase tracking-widest text-emerald-600 mb-3">📦 產品需求趨勢</h4>
                          <div className="space-y-2">
                            {analysis.productDemand.map((p, i) => (
                              <div key={i} className="bg-brand-50/50 rounded-xl px-4 py-2.5 border border-brand-100/60 flex justify-between items-start gap-3">
                                <div>
                                  <p className="text-sm font-medium text-stone-800">{p.product}</p>
                                  <p className="text-xs text-stone-400 mt-0.5">{p.note}</p>
                                </div>
                                <span className="text-xs font-bold text-emerald-600 bg-brand-50 rounded-full px-2 py-0.5 shrink-0">{p.count} 次</span>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}

                      {analysis.competitorThreats?.length > 0 && (
                        <section>
                          <h4 className="text-xs font-semibold uppercase tracking-widest text-orange-500 mb-3">⚠️ 競品威脅雷達</h4>
                          <div className="space-y-2">
                            {analysis.competitorThreats.map((c, i) => (
                              <div key={i} className="bg-orange-50/50 rounded-xl px-4 py-2.5 border border-orange-100/60 flex justify-between items-start gap-3">
                                <div>
                                  <p className="text-sm font-medium text-stone-800">{c.competitor}</p>
                                  <p className="text-xs text-stone-400 mt-0.5">{c.note}</p>
                                </div>
                                <span className="text-xs font-bold text-orange-500 bg-orange-100 rounded-full px-2 py-0.5 shrink-0">{c.count} 次</span>
                              </div>
                            ))}
                          </div>
                        </section>
                      )}
                    </div>

                    {/* 緊急追蹤 */}
                    {analysis.followUpUrgent?.length > 0 && (
                      <section>
                        <h4 className="text-xs font-semibold uppercase tracking-widest text-red-500 mb-3">🔴 需緊急追蹤</h4>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {analysis.followUpUrgent.map((f, i) => (
                            <div key={i} className="bg-red-50/50 rounded-xl px-4 py-3 border border-red-100/60 flex items-start gap-3">
                              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                              <div>
                                <p className="text-sm font-semibold text-stone-800">
                                  {f.name}
                                  {f.date && <span className="ml-1.5 text-xs font-normal text-stone-400">{f.date}</span>}
                                </p>
                                <p className="text-xs text-stone-500 mt-0.5">{f.reason}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {/* 策略建議 */}
                    {analysis.strategicSuggestions?.length > 0 && (
                      <section>
                        <h4 className="text-xs font-semibold uppercase tracking-widest text-violet-500 mb-3">💡 策略建議</h4>
                        <div className="space-y-2">
                          {analysis.strategicSuggestions.map((s, i) => (
                            <div key={i} className="flex items-start gap-3 bg-violet-50/50 rounded-xl px-4 py-3 border border-violet-100/60">
                              <span className="text-violet-400 text-xs font-bold shrink-0 mt-0.5">{i + 1}.</span>
                              <p className="text-sm text-stone-700 leading-relaxed">{s}</p>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </>
                )}

                {/* Empty state */}
                {!analysis && !loading && !error && (
                  <div className="text-center py-12 text-sm text-stone-400">
                    點擊「重新分析」開始分析拜訪紀錄
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      </>
    </AnimatePresence>
  )
}
