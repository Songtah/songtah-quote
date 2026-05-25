'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { staggerFast, listItem, slideDown } from '@/lib/motion'

type Customer = {
  id: string
  name: string
  city: string
  district: string
  type: string
  salesperson: string
}
type FilterOptions = {
  cities: string[]
  districtsByCity: Record<string, string[]>
  salespersons: string[]
  types: string[]
}
type Filters = {
  city: string
  district: string
  salesperson: string
  type: string
}

const searchCache = new Map<string, Customer[]>()
const EMPTY_FILTERS: Filters = { city: '', district: '', salesperson: '', type: '' }

// Returns 1-2 char initials from a name
function getInitials(name: string) {
  if (!name) return '?'
  return name.slice(0, 1)
}

// Deterministic color from string
const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-green-100 text-green-700',
  'bg-purple-100 text-purple-700',
  'bg-orange-100 text-orange-700',
  'bg-teal-100 text-teal-700',
  'bg-rose-100 text-rose-700',
  'bg-indigo-100 text-indigo-700',
  'bg-amber-100 text-amber-700',
]
function avatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function CustomersContent({ recent, total }: { recent: Customer[]; total: number }) {
  const router = useRouter()
  const debounceRef = useRef<NodeJS.Timeout>()

  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [results, setResults] = useState<Customer[]>([])
  const [searching, setSearching] = useState(false)
  const [options, setOptions] = useState<FilterOptions>({ cities: [], districtsByCity: {}, salespersons: [], types: [] })
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Load filter options once
  useEffect(() => {
    fetch('/api/system-customers/options')
      .then((r) => r.json())
      .then((d) => { if (d.cities) setOptions(d) })
      .catch(() => {})
  }, [])

  const advancedFilterCount = [filters.city, filters.district, filters.salesperson].filter(Boolean).length

  // Search + filter logic — triggers whenever query or any filter changes
  useEffect(() => {
    const q = query.trim()
    const hasFilters = !!(filters.city || filters.district || filters.salesperson || filters.type)

    if (!q && !hasFilters) {
      setResults([])
      setSearching(false)
      return
    }

    const cacheKey = `${q}|${filters.city}|${filters.district}|${filters.salesperson}|${filters.type}`
    if (searchCache.has(cacheKey)) {
      setResults(searchCache.get(cacheKey)!)
      setSearching(false)
      return
    }

    setSearching(true)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams()
        if (q) params.set('q', q)
        if (filters.city) params.set('city', filters.city)
        if (filters.district) params.set('district', filters.district)
        if (filters.salesperson) params.set('salesperson', filters.salesperson)
        if (filters.type) params.set('type', filters.type)
        const res = await fetch(`/api/system-customers?${params}`)
        const data: Customer[] = await res.json()
        const items = Array.isArray(data) ? data : []
        searchCache.set(cacheKey, items)
        setResults(items)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 200)

    return () => clearTimeout(debounceRef.current)
  }, [query, filters])

  const isActive = query.trim().length > 0 || !!(filters.city || filters.district || filters.salesperson || filters.type)
  const displayList = isActive ? results : recent

  function clearAdvanced() {
    setFilters((f) => ({ ...f, city: '', district: '', salesperson: '' }))
  }

  return (
    <div className="space-y-4">
      {/* ── Search bar ─────────────────────────────────── */}
      <div className="relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋客戶名稱..."
          className="input pl-10 pr-10 py-2.5"
          autoComplete="off"
        />
        {searching && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
            <span className="w-4 h-4 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin inline-block" />
          </span>
        )}
        {query && !searching && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* ── 客戶類型 quick-filter pills ─────────────────── */}
      {options.types.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilters((f) => ({ ...f, type: '' }))}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              !filters.type
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            全部
          </button>
          {options.types.map((t) => (
            <button
              key={t}
              onClick={() => setFilters((f) => ({ ...f, type: f.type === t ? '' : t }))}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                filters.type === t
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* ── Advanced filters toggle ─────────────────────── */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {isActive
            ? searching ? '搜尋中…' : `找到 ${results.length} 筆`
            : `共 ${total} 筆`}
        </p>
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
            showAdvanced || advancedFilterCount > 0 ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 8h10M11 12h2" />
          </svg>
          進階篩選
          {advancedFilterCount > 0 && (
            <span className="bg-gray-900 text-white text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {advancedFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* ── Advanced filter panel ───────────────────────── */}
      <AnimatePresence>
        {showAdvanced && (
          <motion.div
            variants={slideDown}
            initial="hidden"
            animate="show"
            exit="exit"
            className="panel p-4 space-y-3"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">縣市</label>
                <select
                  value={filters.city}
                  onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value, district: '' }))}
                  className="input text-sm py-2"
                >
                  <option value="">全部縣市</option>
                  {options.cities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">鄉鎮市區</label>
                <select
                  value={filters.district}
                  onChange={(e) => setFilters((f) => ({ ...f, district: e.target.value }))}
                  className="input text-sm py-2"
                  disabled={!filters.city}
                >
                  <option value="">
                    {filters.city ? '全部行政區' : '請先選縣市'}
                  </option>
                  {(filters.city ? (options.districtsByCity[filters.city] ?? []) : []).map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">業務</label>
                <select
                  value={filters.salesperson}
                  onChange={(e) => setFilters((f) => ({ ...f, salesperson: e.target.value }))}
                  className="input text-sm py-2"
                >
                  <option value="">全部業務</option>
                  {options.salespersons.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            {advancedFilterCount > 0 && (
              <div className="flex justify-end">
                <button onClick={clearAdvanced} className="text-xs text-gray-400 hover:text-gray-600 transition">
                  清除篩選
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Customer list ───────────────────────────────── */}
      {displayList.length === 0 ? (
        <div className="panel px-6 py-16 text-center">
          <p className="text-sm text-gray-400">
            {isActive && !searching ? '找不到符合的客戶' : !isActive ? '尚未載入客戶資料' : ''}
          </p>
        </div>
      ) : (
        <motion.div
          key={displayList.map((c) => c.id).join(',')}
          variants={staggerFast}
          initial="hidden"
          animate="show"
          className={`panel divide-y divide-gray-50 overflow-hidden transition-opacity ${searching ? 'opacity-50' : ''}`}
        >
          {displayList.map((c) => (
            <motion.div key={c.id} variants={listItem}>
              <button
                onClick={() => router.push(`/customers/${c.id}`)}
                className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-gray-50 transition-colors group"
              >
                {/* Avatar */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 ${avatarColor(c.name)}`}>
                  {getInitials(c.name)}
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 truncate">{c.name}</span>
                    {c.type && (
                      <span className="shrink-0 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{c.type}</span>
                    )}
                  </div>
                  {(c.city || c.district) && (
                    <p className="text-sm text-gray-400 mt-0.5 truncate">
                      {[c.city, c.district].filter(Boolean).join('・')}
                    </p>
                  )}
                </div>

                {/* Salesperson + arrow */}
                <div className="flex items-center gap-3 shrink-0">
                  {c.salesperson && (
                    <span className="text-xs text-gray-400 hidden sm:block">{c.salesperson}</span>
                  )}
                  <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  )
}
