'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type Customer = { id: string; name: string; city: string; district: string; type: string; salesperson: string }
type FilterOptions = { cities: string[]; districts: string[]; salespersons: string[] }
type Filters = { city: string; district: string; salesperson: string }

const searchCache = new Map<string, Customer[]>()

const EMPTY_FILTERS: Filters = { city: '', district: '', salesperson: '' }

export function CustomersContent({ recent, total }: { recent: Customer[]; total: number }) {
  const router = useRouter()
  const debounceRef = useRef<NodeJS.Timeout>()

  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [results, setResults] = useState<Customer[]>([])
  const [searching, setSearching] = useState(false)
  const [options, setOptions] = useState<FilterOptions>({ cities: [], districts: [], salespersons: [] })
  const [showFilters, setShowFilters] = useState(false)

  // Load filter options once
  useEffect(() => {
    fetch('/api/system-customers/options')
      .then((r) => r.json())
      .then((d) => { if (d.cities) setOptions(d) })
      .catch(() => {})
  }, [])

  const activeFilterCount = Object.values(filters).filter(Boolean).length

  // Search + filter logic
  useEffect(() => {
    const q = query.trim()
    const hasFilters = !!(filters.city || filters.district || filters.salesperson)

    if (!q && !hasFilters) {
      setResults([])
      setSearching(false)
      return
    }

    const cacheKey = `${q}|${filters.city}|${filters.district}|${filters.salesperson}`
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

  const isActive = query.trim().length > 0 || !!(filters.city || filters.district || filters.salesperson)
  const displayList = isActive ? results : recent

  function clearFilters() {
    setFilters(EMPTY_FILTERS)
  }

  return (
    <>
      {/* 搜尋列 + 篩選 */}
      <div className="mb-6 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋客戶名稱..."
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-700 pr-10"
              autoComplete="off"
            />
            {searching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                <span className="w-4 h-4 border-2 border-slate-200 border-t-green-700 rounded-full animate-spin inline-block" />
              </span>
            )}
            {query && !searching && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
              >
                ✕
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg border text-sm font-medium transition
              ${showFilters || activeFilterCount > 0
                ? 'bg-green-800 text-white border-green-800'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 8h10M11 12h2" />
            </svg>
            篩選
            {activeFilterCount > 0 && (
              <span className="bg-white text-green-800 text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">縣市</label>
                <select
                  value={filters.city}
                  onChange={(e) => setFilters((f) => ({ ...f, city: e.target.value, district: '' }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700 bg-white"
                >
                  <option value="">全部縣市</option>
                  {options.cities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">鄉鎮市區</label>
                <select
                  value={filters.district}
                  onChange={(e) => setFilters((f) => ({ ...f, district: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700 bg-white"
                >
                  <option value="">全部行政區</option>
                  {options.districts.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">業務</label>
                <select
                  value={filters.salesperson}
                  onChange={(e) => setFilters((f) => ({ ...f, salesperson: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700 bg-white"
                >
                  <option value="">全部業務</option>
                  {options.salespersons.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            {activeFilterCount > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={clearFilters}
                  className="text-xs text-gray-400 hover:text-gray-600 transition"
                >
                  清除篩選
                </button>
              </div>
            )}
          </div>
        )}

        {/* Active filter chips */}
        {activeFilterCount > 0 && !showFilters && (
          <div className="flex flex-wrap gap-2">
            {filters.city && (
              <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full">
                {filters.city}
                <button onClick={() => setFilters((f) => ({ ...f, city: '', district: '' }))} className="hover:text-green-900">✕</button>
              </span>
            )}
            {filters.district && (
              <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full">
                {filters.district}
                <button onClick={() => setFilters((f) => ({ ...f, district: '' }))} className="hover:text-green-900">✕</button>
              </span>
            )}
            {filters.salesperson && (
              <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-full">
                {filters.salesperson}
                <button onClick={() => setFilters((f) => ({ ...f, salesperson: '' }))} className="hover:text-green-900">✕</button>
              </span>
            )}
            <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-600">全部清除</button>
          </div>
        )}
      </div>

      {/* 客戶列表 */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-green-700 mb-0.5">Customers</p>
            <h3 className="text-lg font-bold text-slate-900">
              {isActive ? '搜尋結果' : '客戶名單'}
            </h3>
          </div>
          <span className="text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
            {isActive ? `${results.length} 筆` : `共 ${total} 筆`}
          </span>
        </div>

        {displayList.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-slate-400">
            {isActive && !searching ? '找不到符合的客戶' : isActive ? '搜尋中…' : '尚未載入客戶資料'}
          </div>
        ) : (
          <div className={`divide-y divide-gray-50 ${searching ? 'opacity-50' : ''} transition-opacity`}>
            {displayList.map((c) => (
              <button
                key={c.id}
                onClick={() => router.push(`/customers/${c.id}`)}
                className="w-full text-left px-6 py-4 hover:bg-green-50 transition flex items-center justify-between gap-4"
              >
                <div>
                  <div className="font-semibold text-slate-900">{c.name}</div>
                  {(c.city || c.type) && (
                    <div className="text-sm text-slate-500 mt-0.5">
                      {[c.city, c.district, c.type].filter(Boolean).join('・')}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {c.salesperson && (
                    <span className="text-xs text-slate-400">{c.salesperson}</span>
                  )}
                  <span className="text-slate-300">›</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
