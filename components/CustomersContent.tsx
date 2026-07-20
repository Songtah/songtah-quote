'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import Fuse from 'fuse.js'
import { listItem, staggerFast } from '@/lib/motion'
import { VisitModal } from '@/components/VisitsContent'

// ─── Types ────────────────────────────────────────────────────────────────────

type Customer = {
  id: string
  name: string
  city: string
  district: string
  type: string
  salesperson: string
  status: string
}

type NameIndexEntry = {
  id: string
  name: string
  city: string
  district: string
  type: string
  salesperson: string
  status: string
}

type FilterOptions = {
  cities: string[]
  districtsByCity: Record<string, string[]>
  salespersons: string[]
  types: string[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-brand-50 text-green-700',
  'bg-purple-100 text-purple-700',
  'bg-orange-100 text-orange-700',
  'bg-brand-50 text-teal-700',
  'bg-rose-100 text-rose-700',
  'bg-indigo-100 text-indigo-700',
  'bg-amber-100 text-amber-700',
]
function avatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

// Status badge: only show if not normal / empty
const STATUS_STYLE: Record<string, string> = {
  '停業': 'bg-red-50 text-red-600 border border-red-200',
  '待確認': 'bg-amber-50 text-amber-600 border border-amber-200',
  '潛在客戶': 'bg-sky-50 text-sky-600 border border-sky-200',
}
function statusBadge(status: string) {
  if (!status || status === '正常' || status === '正常營業') return null
  const cls = STATUS_STYLE[status] ?? 'bg-gray-100 text-gray-500 border border-gray-200'
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{status}</span>
}

// ─── Main component ────────────────────────────────────────────────────────────

export function CustomersContent({
  initialOptions,
}: {
  initialOptions?: FilterOptions
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlQuery = searchParams.get('q')?.trim() ?? ''
  const inputRef = useRef<HTMLInputElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fuseRef = useRef<Fuse<NameIndexEntry> | null>(null)
  const nameIndexRef = useRef<NameIndexEntry[]>([])

  // Filter options (loaded once on mount)
  const [options, setOptions] = useState<FilterOptions>(
    initialOptions ?? { cities: [], districtsByCity: {}, salespersons: [], types: [] }
  )

  // Search state
  const [query, setQuery] = useState(urlQuery)
  const [typeFilter, setTypeFilter] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [districtFilter, setDistrictFilter] = useState('')
  const [salespersonFilter, setSalespersonFilter] = useState('')

  // Results state: exact results + fuzzy-only results (shown with separator)
  const [results, setResults] = useState<Customer[]>([])
  const [fuzzyResults, setFuzzyResults] = useState<NameIndexEntry[]>([])
  const [searching, setSearching] = useState(false)

  // Quick add 客情 modal
  const [quickVisitCustomer, setQuickVisitCustomer] = useState<{
    id: string; name: string; city: string; district: string; address: string
  } | null>(null)

  useEffect(() => {
    setQuery(urlQuery)
  }, [urlQuery])

  // Load filter options + name index on mount
  useEffect(() => {
    if (!initialOptions) {
      fetch('/api/system-customers/options')
        .then((r) => r.json())
        .then((data) => { if (data && typeof data === 'object') setOptions(data) })
        .catch(() => {})
    }
    // Load name index for fuzzy search
    fetch('/api/system-customers/names')
      .then((r) => r.json())
      .then((data: NameIndexEntry[]) => {
        if (!Array.isArray(data)) return
        nameIndexRef.current = data
        fuseRef.current = new Fuse(data, {
          keys: ['name'],
          threshold: 0.4,
          includeScore: true,
          minMatchCharLength: 1,
        })
      })
      .catch(() => {})
  }, [initialOptions])

  // Trigger search when query or filters change (debounced)
  const hasActiveFilter = !!(query.trim() || typeFilter || cityFilter || districtFilter || salespersonFilter)
  const activeDistricts = cityFilter ? (options.districtsByCity[cityFilter] ?? []) : []

  useEffect(() => {
    if (!hasActiveFilter) { setResults([]); setFuzzyResults([]); return }

    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setSearching(true)
      const qs = new URLSearchParams()
      if (query.trim())      qs.set('q', query.trim())
      if (cityFilter)        qs.set('city', cityFilter)
      if (districtFilter)    qs.set('district', districtFilter)
      if (salespersonFilter) qs.set('salesperson', salespersonFilter)
      if (typeFilter)        qs.set('type', typeFilter)

      fetch(`/api/system-customers?${qs}`)
        .then((r) => r.json())
        .then((data) => {
          const exactList: Customer[] = Array.isArray(data) ? data : []
          setResults(exactList)

          // Fuzzy search — only when there's a text query and no filter-only search
          if (query.trim() && fuseRef.current) {
            const exactIds = new Set(exactList.map((c) => c.id))
            const fuzzyHits = fuseRef.current.search(query.trim())
            // Keep only results not already in exact list, top 5
            const fuzzyOnly = fuzzyHits
              .filter((hit) => !exactIds.has(hit.item.id))
              .slice(0, 5)
              .map((hit) => hit.item)
            setFuzzyResults(fuzzyOnly)
          } else {
            setFuzzyResults([])
          }
        })
        .catch(() => {
          setResults([])
          setFuzzyResults([])
        })
        .finally(() => setSearching(false))
    }, 300)

    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [query, typeFilter, cityFilter, districtFilter, salespersonFilter, hasActiveFilter])

  function clearAll() {
    setQuery('')
    setTypeFilter('')
    setCityFilter('')
    setDistrictFilter('')
    setSalespersonFilter('')
    setResults([])
    setFuzzyResults([])
    inputRef.current?.focus()
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      <div className="card-soft bg-white p-4 sm:p-5">
        <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">第一步</p>
        <p className="mt-1 text-base font-bold text-stone-800">搜尋客戶，再查看資料或新增客情</p>
        <p className="mt-1 text-sm text-stone-500">輸入名稱最快；需要縮小範圍時再使用下方篩選。</p>
      </div>

      {/* ── Search bar ──────────────────────────────────────────────────────── */}
      <div className="relative">
        <svg
          className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-500 pointer-events-none"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="輸入客戶名稱、縣市、行政區或業務姓名…"
          className="input-soft w-full pl-12 pr-12 py-3.5 text-base shadow-sm"
          autoComplete="off"
          autoFocus
        />
        <AnimatePresence>
          {query && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.1 }}
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center rounded-full bg-stone-100 text-stone-500 hover:bg-brand-50 hover:text-brand-600 active:scale-95 transition-all"
            >
              <svg className="w-3 h-3 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* ── Type quick pills ─────────────────────────────────────────────────── */}
      {options.types.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <TypePill label="全部" active={!typeFilter} onClick={() => setTypeFilter('')} />
          {options.types.map((t) => (
            <TypePill
              key={t}
              label={t}
              active={typeFilter === t}
              onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
            />
          ))}
        </div>
      )}

      {/* ── Filter bar: city / district / salesperson ────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center">
        <FilterSelect
          value={cityFilter}
          onChange={(v) => { setCityFilter(v); setDistrictFilter('') }}
          placeholder="全部縣市"
          options={options.cities}
        />

        {cityFilter && activeDistricts.length > 0 && (
          <FilterSelect
            value={districtFilter}
            onChange={setDistrictFilter}
            placeholder="全部行政區"
            options={activeDistricts}
          />
        )}

        <FilterSelect
          value={salespersonFilter}
          onChange={setSalespersonFilter}
          placeholder="全部業務"
          options={options.salespersons}
        />

        {hasActiveFilter && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 rounded-full px-3 py-2 text-sm text-stone-400 hover:bg-brand-50 hover:text-brand-700 active:scale-95 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            清除篩選
          </button>
        )}
      </div>

      {/* ── Results / Prompt ─────────────────────────────────────────────────── */}
      {!hasActiveFilter ? (
        <div className="card-soft px-6 py-14 text-center">
          <div className="text-3xl mb-3">🔍</div>
          <p className="font-semibold text-stone-700">先輸入客戶名稱</p>
          <p className="mt-1 text-sm text-stone-400">也可以用縣市、行政區或負責業務篩選</p>
        </div>
      ) : searching ? (
        <LoadingSkeleton />
      ) : results.length === 0 && fuzzyResults.length === 0 ? (
        <EmptyState hasFilter={hasActiveFilter} />
      ) : (
        <>
          <div className="text-xs text-stone-400 px-1">
            找到 {results.length} 筆
            {fuzzyResults.length > 0 && `，另有 ${fuzzyResults.length} 筆相似結果`}
          </div>
          <motion.div
            key={`${query}|${typeFilter}|${cityFilter}|${districtFilter}|${salespersonFilter}`}
            variants={staggerFast}
            initial="hidden"
            animate="show"
            className="card-soft divide-y divide-stone-900/[0.06] overflow-hidden"
          >
            {results.map((c) => (
              <motion.div key={c.id} variants={listItem}>
                <CustomerRow
                  customer={c}
                  onNavigate={() => router.push(`/customers/${c.id}`)}
                  onQuickVisit={() =>
                    setQuickVisitCustomer({ id: c.id, name: c.name, city: c.city, district: c.district, address: '' })
                  }
                />
              </motion.div>
            ))}

            {/* Fuzzy-only results with separator */}
            {fuzzyResults.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-5 py-2 bg-stone-50">
                  <span className="text-xs text-stone-400 font-medium">🔍 相似結果</span>
                  <div className="flex-1 h-px bg-stone-200" />
                </div>
                {fuzzyResults.map((c) => (
                  <motion.div key={c.id} variants={listItem}>
                    <CustomerRow
                      customer={c}
                      onNavigate={() => router.push(`/customers/${c.id}`)}
                      onQuickVisit={() =>
                        setQuickVisitCustomer({ id: c.id, name: c.name, city: c.city, district: c.district, address: '' })
                      }
                    />
                  </motion.div>
                ))}
              </>
            )}
          </motion.div>
        </>
      )}

      {/* ── Quick add 客情 modal ──────────────────────────────────────────────── */}
      {quickVisitCustomer && (
        <VisitModal
          prefillCustomer={quickVisitCustomer}
          onClose={() => setQuickVisitCustomer(null)}
          onSaved={() => setQuickVisitCustomer(null)}
        />
      )}
    </div>
  )
}

// ─── CustomerRow ───────────────────────────────────────────────────────────────

function CustomerRow({
  customer,
  onNavigate,
  onQuickVisit,
}: {
  customer: Customer
  onNavigate: () => void
  onQuickVisit: () => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="flex items-center gap-3 px-4 py-4 sm:gap-4 sm:px-5 hover:bg-brand-50/50 transition-colors group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Avatar */}
      <button
        onClick={onNavigate}
        tabIndex={-1}
        className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-transform group-hover:scale-105 ${avatarColor(customer.name)}`}
      >
        {customer.name.slice(0, 1)}
      </button>

      {/* Main info — clickable */}
      <button
        onClick={onNavigate}
        className="flex-1 min-w-0 text-left py-1 active:scale-[0.99] transition-all"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-stone-800 truncate">{customer.name}</span>
          {customer.type && (
            <span className="shrink-0 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {customer.type}
            </span>
          )}
          {statusBadge(customer.status)}
        </div>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          {(customer.city || customer.district) && (
            <span className="text-sm text-gray-400">
              {[customer.city, customer.district].filter(Boolean).join('・')}
            </span>
          )}
          {customer.salesperson && (
            <span className="text-sm text-gray-400 hidden sm:inline">
              業務：{customer.salesperson}
            </span>
          )}
        </div>
      </button>

      {/* Right side actions */}
      <div className="flex items-center gap-2 shrink-0">
        <AnimatePresence>
          {hovered && (
            <motion.button
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 6 }}
              transition={{ duration: 0.12 }}
              onClick={(e) => { e.stopPropagation(); onQuickVisit() }}
              className="text-xs text-white bg-brand-500 px-3 py-2 rounded-full hover:bg-brand-600 shadow-sm shadow-brand-500/20 active:scale-95 transition-all font-semibold"
            >
              + 客情
            </motion.button>
          )}
        </AnimatePresence>
        <button
          onClick={onNavigate}
          tabIndex={-1}
          className="text-gray-300 group-hover:text-gray-500 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function TypePill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
        active
          ? 'chip-active border-brand-500'
          : 'chip border-stone-200 hover:border-brand-300 hover:text-brand-700'
      }`}
    >
      {label}
    </button>
  )
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: string[]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none pl-4 pr-9 py-2.5 rounded-full border text-sm transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${
          value
            ? 'border-brand-500 bg-brand-500 text-white font-medium'
            : 'border-stone-200 bg-white text-stone-600 hover:border-brand-300'
        }`}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <svg
        className={`absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none ${value ? 'text-white' : 'text-gray-400'}`}
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="card-soft divide-y divide-stone-900/[0.06] overflow-hidden">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <div className="w-9 h-9 rounded-full bg-gray-100 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-gray-100 rounded animate-pulse w-2/5" />
            <div className="h-3 bg-gray-50 rounded animate-pulse w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="card-soft px-6 py-16 text-center">
      <div className="text-3xl mb-3">{hasFilter ? '🔍' : '📋'}</div>
      <p className="text-sm text-gray-400">
        {hasFilter ? '找不到符合條件的客戶' : '尚無客戶資料'}
      </p>
    </div>
  )
}
