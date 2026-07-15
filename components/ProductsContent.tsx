'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { fadeUp, stagger } from '@/lib/motion'
import { ProductFamily, YMHToothGridPanel, FamilySpecPanel } from '@/components/FamilySpecPicker'

type ProductItem = {
  id: string
  name: string
  manufacturer: string
  productType: string
  category: string
  price: number | null
  salePrice: number | null
  notes: string
  weight?: number | null
  bendingStrength?: string
  transparency?: string
  sinteringTemp?: string
  bendingModulus?: string
  flexuralStrength?: string
  tensileStrength?: string
  elongation?: string
  hardness?: string
  workingDistance?: string
  fieldWidth?: string
  fieldDepth?: string
  // Catalog fields
  skuCode?: string
}

const inputCls = 'input'

function formatPrice(price: number | null) {
  if (price == null) return null
  return `NT$ ${price.toLocaleString('zh-TW')}`
}

// ── Product Thumbnail ────────────────────────────────────────────────────────
function ProductThumb({ id, name, size = 64 }: { id: string; name: string; size?: number }) {
  const [imgError, setImgError] = useState(false)
  const proxySrc = `/api/notion-image?pageId=${id}`
  return (
    <div
      style={{ width: size, height: size }}
      className="flex-shrink-0 rounded-xl overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center"
    >
      {!imgError ? (
        <Image
          src={proxySrc}
          alt={name}
          width={size}
          height={size}
          className="object-cover w-full h-full"
          onError={() => setImgError(true)}
          unoptimized
        />
      ) : (
        <span className="text-2xl select-none">📦</span>
      )}
    </div>
  )
}

// ── Detail Slide-over ────────────────────────────────────────────────────────
function SpecRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex gap-2 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-slate-400 w-24 sm:w-36 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-slate-700 font-medium flex-1 min-w-0 break-words">{value}</span>
    </div>
  )
}

function ProductDetail({ p, onClose }: { p: ProductItem; onClose: () => void }) {
  // Prevent background scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const hasSpecs = p.bendingStrength || p.transparency || p.sinteringTemp ||
    p.bendingModulus || p.flexuralStrength || p.tensileStrength ||
    p.elongation || p.hardness || p.workingDistance || p.fieldWidth || p.fieldDepth

  const displayCode = p.skuCode || (p.id && !p.id.includes('-') ? '' : p.id)

  return (
    <div
      className="fixed inset-0 z-50 flex"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        className="relative ml-auto w-full max-w-lg h-full bg-white shadow-2xl flex flex-col overflow-hidden"
        initial={{ x: '100%', opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: '100%', opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-4 sm:px-6 pt-6 pb-4 sm:py-5 border-b border-gray-100">
          <ProductThumb id={p.id} name={p.name} size={64} />
          <div className="flex-1 min-w-0">
            <p className="eyebrow mb-1 text-[10px] sm:text-xs">
              {p.productType || '產品'}
              {displayCode && (
                <span className="ml-2 font-mono text-gray-400 normal-case tracking-normal font-normal">
                  {displayCode}
                </span>
              )}
            </p>
            <h2 className="text-base sm:text-xl font-bold text-slate-900 leading-snug">{p.name || '（未命名）'}</h2>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {p.manufacturer && (
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-600 font-medium">
                  {p.manufacturer}
                </span>
              )}
              {p.category && (
                <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-xs text-blue-700 font-medium">
                  {p.category}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition text-lg leading-none shrink-0 mt-0.5"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-5 space-y-6">

          {/* Pricing */}
          {(p.price != null || p.salePrice != null) && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">價格</p>
              <div className="flex gap-4">
                {p.price != null && (
                  <div className="flex-1 bg-gray-50 rounded-xl p-4">
                    <p className="text-xs text-slate-400 mb-1">定價</p>
                    <p className="text-lg font-bold text-slate-800">{formatPrice(p.price)}</p>
                  </div>
                )}
                {p.salePrice != null && (
                  <div className="flex-1 bg-gray-50 rounded-xl p-4 border border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">優惠價</p>
                    <p className="text-lg font-bold text-gray-900">{formatPrice(p.salePrice)}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Basic info */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">基本資料</p>
            <div className="bg-gray-50 rounded-xl px-4 py-1">
              {displayCode && <SpecRow label="貨品碼" value={displayCode} />}
              <SpecRow label="生產商" value={p.manufacturer} />
              <SpecRow label="商品類型" value={p.productType} />
              <SpecRow label="分類" value={p.category} />
              <SpecRow label="重量" value={p.weight != null ? `${p.weight} kg` : null} />
            </div>
          </div>

          {/* Technical specs */}
          {hasSpecs && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">技術規格</p>
              <div className="bg-gray-50 rounded-xl px-4 py-1">
                <SpecRow label="彎曲強度" value={p.bendingStrength} />
                <SpecRow label="材料透度" value={p.transparency} />
                <SpecRow label="燒結溫度" value={p.sinteringTemp} />
                <SpecRow label="彎曲模數 (Mpa)" value={p.bendingModulus} />
                <SpecRow label="抗彎強度 (MPa)" value={p.flexuralStrength} />
                <SpecRow label="抗拉強度 (MPa)" value={p.tensileStrength} />
                <SpecRow label="拉伸伸長率" value={p.elongation} />
                <SpecRow label="硬度" value={p.hardness} />
                <SpecRow label="工作距離" value={p.workingDistance} />
                <SpecRow label="景寬" value={p.fieldWidth} />
                <SpecRow label="景深" value={p.fieldDepth} />
              </div>
            </div>
          )}

          {/* Notes */}
          {p.notes && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">備註</p>
              <div className="bg-gray-50 rounded-xl p-4 text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                {p.notes}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── Product Card ─────────────────────────────────────────────────────────────
function ProductCardThumb({ id, name }: { id: string; name: string }) {
  const [imgError, setImgError] = useState(false)
  const proxySrc = `/api/notion-image?pageId=${id}`
  return (
    <div className="relative w-full aspect-[4/3] bg-gray-100 overflow-hidden border-b border-gray-100">
      {!imgError ? (
        <Image
          src={proxySrc}
          alt={name}
          fill
          className="object-cover"
          onError={() => setImgError(true)}
          unoptimized
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-4xl select-none">📦</span>
        </div>
      )}
    </div>
  )
}

function ProductCard({ p, onClick }: { p: ProductItem; onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      variants={fadeUp}
      whileHover={{ y: -3, boxShadow: '0 8px 24px -4px rgba(0,0,0,0.10)' }}
      transition={{ duration: 0.2 }}
      className="panel text-left flex flex-col overflow-hidden hover:border-gray-300 w-full"
    >
      {/* Thumbnail area — full bleed */}
      <ProductCardThumb id={p.id} name={p.name} />

      {/* Content */}
      <div className="p-4 flex flex-col flex-1">
        <h3 className="font-semibold text-gray-900 text-sm leading-snug mb-2.5 line-clamp-2 min-h-[2.5rem]">
          {p.name || '（未命名）'}
        </h3>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {p.manufacturer && (
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-600 font-medium">
              {p.manufacturer}
            </span>
          )}
          {p.category && (
            <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-xs text-blue-600 font-medium">
              {p.category}
            </span>
          )}
          {p.productType && !p.category && (
            <span className="px-2 py-0.5 rounded-full bg-gray-50 border border-gray-200 text-xs text-gray-500">
              {p.productType}
            </span>
          )}
        </div>

        {/* Price / code — pushed to bottom */}
        {p.price != null ? (
          <div className="mt-auto pt-3 border-t border-gray-50">
            <p className="text-sm font-bold text-gray-900">{formatPrice(p.price)}</p>
            {p.salePrice != null && (
              <p className="text-xs text-gray-400 mt-0.5">優惠價 {formatPrice(p.salePrice)}</p>
            )}
          </div>
        ) : p.skuCode ? (
          <div className="mt-auto pt-2">
            <p className="font-mono text-xs text-gray-400 truncate">{p.skuCode}</p>
          </div>
        ) : (
          <div className="mt-auto" />
        )}
      </div>
    </motion.button>
  )
}

// ── Family browse types ────────────────────────────────────────────────────────

type FamilyMember = {
  code: string
  name: string
  brand: string
  category: string
  productType: string
  price: number | null
  salePrice: number | null
}

// ── Family Card (browse mode) ─────────────────────────────────────────────────

function FamilyBrowseCard({
  family,
  isExpanded,
  members,
  membersLoading,
  onToggle,
  onSelectMember,
}: {
  family: ProductFamily
  isExpanded: boolean
  members: FamilyMember[] | undefined
  membersLoading: boolean
  onToggle: () => void
  onSelectMember: (m: FamilyMember) => void
}) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Card header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors"
      >
        <span className={`text-gray-400 text-xs transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{family.seriesName}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {family.brand && (
              <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-500 font-medium">
                {family.brand}
              </span>
            )}
            {family.productType && (
              <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-xs text-blue-600 font-medium">
                {family.productType}
              </span>
            )}
          </div>
        </div>
        <span className="text-xs text-gray-400 shrink-0">
          {isExpanded ? '收起' : '展開查看'}
        </span>
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="border-t border-gray-100">
          {family.uiVariant === 'ymh-tooth-grid' ? (
            <>
              <YMHToothGridPanel
                family={family}
                onAdd={(code) => { navigator.clipboard.writeText(code).catch(() => {}); setCopiedCode(code); setTimeout(() => setCopiedCode(null), 2500) }}
                actionLabel="複製貨號"
              />
              {copiedCode && (
                <div className="px-5 pb-3 text-xs text-green-600 font-medium">✓ 已複製 {copiedCode}</div>
              )}
            </>
          ) : family.skuMap ? (
            <>
              <FamilySpecPanel
                family={family}
                onAdd={(code) => { navigator.clipboard.writeText(code).catch(() => {}); setCopiedCode(code); setTimeout(() => setCopiedCode(null), 2500) }}
                actionLabel="複製貨號"
              />
              {copiedCode && (
                <div className="px-5 pb-3 text-xs text-green-600 font-medium">✓ 已複製 {copiedCode}</div>
              )}
            </>
          ) : (
            /* existing flat member list */
            membersLoading ? (
              <div className="px-4 py-3 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="h-3.5 w-1/2 bg-gray-100 rounded animate-pulse" />
                    <div className="h-3 w-1/4 bg-gray-50 rounded animate-pulse" />
                  </div>
                ))}
              </div>
            ) : members && members.length > 0 ? (
              members.map((m) => (
                <button
                  key={m.code}
                  onClick={() => onSelectMember(m)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{m.name}</p>
                    <p className="font-mono text-[10px] text-gray-400 mt-0.5">{m.code}</p>
                  </div>
                  {m.category && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-xs text-blue-600 font-medium whitespace-nowrap hidden sm:inline-block shrink-0">
                      {m.category}
                    </span>
                  )}
                  <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))
            ) : (
              <p className="px-4 py-4 text-sm text-gray-400 text-center">此系列暫無商品</p>
            )
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export function ProductsContent({
  total,
  brands,
  types,
  categories,
}: {
  total: number
  brands: string[]
  types: string[]
  categories: string[]
}) {
  const debounceRef = useRef<NodeJS.Timeout>()
  const [query, setQuery] = useState('')
  const [activeType, setActiveType] = useState('')
  const [activeBrand, setActiveBrand] = useState('')
  const [activeCategory, setActiveCategory] = useState('')
  const [results, setResults] = useState<ProductItem[]>([])
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null)

  // Family browse state
  const [families, setFamilies] = useState<ProductFamily[]>([])
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null)
  const [familyMembers, setFamilyMembers] = useState<Map<string, FamilyMember[]>>(new Map())
  const [familyMembersLoading, setFamilyMembersLoading] = useState<Set<string>>(new Set())

  // Bug report modal
  const [bugOpen, setBugOpen] = useState(false)
  const [bugPage, setBugPage] = useState('')
  const [bugDesc, setBugDesc] = useState('')
  const [bugReporter, setBugReporter] = useState('')
  const [bugSubmitting, setBugSubmitting] = useState(false)
  const [bugDone, setBugDone] = useState(false)

  const advancedFilterCount = [activeBrand, activeCategory].filter(Boolean).length
  const hasAnyFilter = activeType !== '' || activeBrand !== '' || activeCategory !== ''
  const isSearchMode = query.trim() !== '' || hasAnyFilter

  // Fetch families on mount (for browse mode)
  useEffect(() => {
    fetch('/api/products/families')
      .then((r) => r.json())
      .then((data) => setFamilies(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  // Toggle family expansion (accordion: only one open at a time)
  const handleFamilyToggle = async (familyId: string) => {
    if (expandedFamily === familyId) {
      setExpandedFamily(null)
      return
    }
    setExpandedFamily(familyId)

    const family = families.find((f) => f.id === familyId)
    // Only lazy-fetch member list for prefix-only families (no skuMap, no uiVariant)
    if (family?.skuMap || family?.uiVariant) return
    if (familyMembers.has(familyId)) return

    setFamilyMembersLoading((prev) => new Set(prev).add(familyId))
    try {
      const res = await fetch(`/api/products/families/${encodeURIComponent(familyId)}`)
      const data = await res.json()
      setFamilyMembers((prev) => new Map(prev).set(familyId, data.members ?? []))
    } catch {
      setFamilyMembers((prev) => new Map(prev).set(familyId, []))
    } finally {
      setFamilyMembersLoading((prev) => {
        const next = new Set(prev); next.delete(familyId); return next
      })
    }
  }

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (query.trim())    params.set('q', query.trim())
        if (activeBrand)     params.set('brand', activeBrand)
        if (activeType)      params.set('type', activeType)
        if (activeCategory)  params.set('category', activeCategory)
        const res = await fetch(`/api/products/search?${params.toString()}`)
        const data = await res.json()
        setResults(Array.isArray(data) ? data : [])
      } catch {
        setResults([])
      } finally {
        setLoading(false)
        setInitialized(true)
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [query, activeBrand, activeType, activeCategory])

  async function submitBugReport() {
    if (!bugDesc.trim()) return
    setBugSubmitting(true)
    try {
      await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: bugPage, description: bugDesc, reporter: bugReporter }),
      })
      setBugDone(true)
      setTimeout(() => {
        setBugOpen(false)
        setBugDone(false)
        setBugPage('')
        setBugDesc('')
        setBugReporter('')
      }, 2000)
    } catch {
      alert('回報失敗，請稍後再試')
    } finally {
      setBugSubmitting(false)
    }
  }

  function TypePill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
      <button
        onClick={onClick}
        className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors whitespace-nowrap ${
          active
            ? 'bg-gray-900 text-white border-gray-900'
            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
        }`}
      >
        {label}
      </button>
    )
  }

  return (
    <>
      {/* 搜尋列 */}
      <div className="mb-4 relative">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋產品名稱、生產商、分類..."
          className="input pl-10 pr-10"
          autoComplete="off"
        />
        {loading && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
            <span className="w-4 h-4 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin inline-block" />
          </span>
        )}
        {query && !loading && (
          <button onClick={() => setQuery('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      {/* ── 商品類型 quick-filter pills ────────────────────── */}
      {types.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <TypePill label="全部" active={activeType === ''} onClick={() => setActiveType('')} />
          {types.map((t) => (
            <TypePill key={t} label={t} active={activeType === t} onClick={() => setActiveType(activeType === t ? '' : t)} />
          ))}
        </div>
      )}

      {/* ── 進階篩選 bar ────────────────────────────────────── */}
      <div className="mb-6 space-y-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setFilterOpen((v) => !v)}
            className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${
              filterOpen || advancedFilterCount > 0 ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'
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
          <span className="text-sm text-gray-400">
            {initialized ? `${results.length} 筆` : `共 ${total} 筆`}
          </span>
        </div>

        {/* 展開的進階篩選面板 */}
        <AnimatePresence>
          {filterOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="panel p-4 space-y-4"
            >
              {/* 生產商 */}
              {brands.length > 0 && (
                <div>
                  <p className="eyebrow mb-2">生產商</p>
                  <div className="flex flex-wrap gap-2">
                    <TypePill label="全部" active={activeBrand === ''} onClick={() => setActiveBrand('')} />
                    {brands.map((b) => (
                      <TypePill key={b} label={b} active={activeBrand === b} onClick={() => setActiveBrand(activeBrand === b ? '' : b)} />
                    ))}
                  </div>
                </div>
              )}

              {/* 分類 */}
              {categories.length > 0 && (
                <div>
                  <p className="eyebrow mb-2">分類</p>
                  <div className="flex flex-wrap gap-2">
                    <TypePill label="全部" active={activeCategory === ''} onClick={() => setActiveCategory('')} />
                    {categories.map((c) => (
                      <TypePill key={c} label={c} active={activeCategory === c} onClick={() => setActiveCategory(activeCategory === c ? '' : c)} />
                    ))}
                  </div>
                </div>
              )}

              {advancedFilterCount > 0 && (
                <div className="pt-2 border-t border-gray-100 flex justify-end">
                  <button
                    onClick={() => { setActiveBrand(''); setActiveCategory('') }}
                    className="text-xs text-gray-400 hover:text-gray-600 transition"
                  >
                    清除篩選
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 產品列表 */}
      {isSearchMode ? (
        /* ── Search mode: flat list ─────────────────────── */
        !initialized ? (
          <div className="panel divide-y divide-gray-50">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <div className="w-10 h-10 rounded-lg bg-gray-100 animate-pulse shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-2/3 bg-gray-100 rounded animate-pulse" />
                  <div className="h-3 w-1/3 bg-gray-50 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="panel px-5 py-16 text-center text-sm text-gray-400">
            找不到符合的產品，請嘗試其他關鍵字或貨品碼
          </div>
        ) : (
          <motion.div
            key={results.map(p => p.id).join(',')}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="panel divide-y divide-gray-50 overflow-hidden"
          >
            {results.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedProduct(p)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
              >
                {/* Code badge — desktop left column, hidden on mobile */}
                <div className="shrink-0 w-28 text-right hidden sm:block">
                  <span className="font-mono text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded truncate inline-block max-w-full">
                    {p.skuCode || p.id}
                  </span>
                </div>
                {/* Name + meta (+ code on mobile) */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    {p.manufacturer && (
                      <p className="text-xs text-gray-400 truncate">{p.manufacturer}</p>
                    )}
                    {/* Code shown inline on mobile only */}
                    {(p.skuCode || p.id) && (
                      <span className="font-mono text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded sm:hidden">
                        {p.skuCode || p.id}
                      </span>
                    )}
                  </div>
                </div>
                {/* Category badge + arrow */}
                <div className="shrink-0 flex gap-1.5 items-center">
                  {p.category && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-xs text-blue-600 font-medium whitespace-nowrap hidden sm:inline-block">
                      {p.category}
                    </span>
                  )}
                  {p.productType && (
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs text-gray-500 whitespace-nowrap hidden md:inline-block">
                      {p.productType}
                    </span>
                  )}
                  <svg className="w-4 h-4 text-gray-300 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
            {results.length === 50 && (
              <p className="text-xs text-center text-gray-400 py-3">
                顯示前 50 筆，請輸入更精確的關鍵字縮小範圍
              </p>
            )}
          </motion.div>
        )
      ) : (
        /* ── Browse mode: family cards ──────────────────── */
        <div className="space-y-2">
          {families.length === 0 ? (
            <div className="panel divide-y divide-gray-50">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-2/3 bg-gray-100 rounded animate-pulse" />
                    <div className="h-3 w-1/3 bg-gray-50 rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {families.map((family) => (
                <FamilyBrowseCard
                  key={family.id}
                  family={family}
                  isExpanded={expandedFamily === family.id}
                  members={familyMembers.get(family.id)}
                  membersLoading={familyMembersLoading.has(family.id)}
                  onToggle={() => handleFamilyToggle(family.id)}
                  onSelectMember={(m) => {
                    setSelectedProduct({
                      id: m.code,
                      name: m.name,
                      manufacturer: m.brand,
                      productType: m.productType,
                      category: m.category,
                      price: m.price,
                      salePrice: m.salePrice,
                      notes: '',
                      skuCode: m.code,
                    })
                  }}
                />
              ))}
              <p className="text-center text-xs text-gray-400 pt-2">找不到？請使用搜尋框</p>
            </>
          )}
        </div>
      )}

      {/* 產品詳細側板 */}
      {selectedProduct && (
        <ProductDetail p={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}

      {/* 問題回報浮動按鈕 */}
      <button
        onClick={() => setBugOpen(true)}
        className="button-primary fixed bottom-8 right-8 flex items-center gap-2 text-sm font-medium px-4 py-3 rounded-full shadow-lg hover:shadow-xl z-40"
      >
        <span>🐛</span>
        <span>回報問題</span>
      </button>

      {/* 問題回報 Modal */}
      <AnimatePresence>
        {bugOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-stone-900/50 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setBugOpen(false)}
            />
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center px-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.div
                className="relative w-full max-w-md"
                initial={{ opacity: 0, y: 32, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.98 }}
                transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <div className="panel p-6">
                  {bugDone ? (
                    <div className="py-8 text-center">
                      <div className="text-4xl mb-3">✅</div>
                      <p className="text-lg font-bold text-stone-900">感謝回報！</p>
                      <p className="text-sm text-stone-500 mt-1">我們已收到您的問題，將盡快處理。</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-5">
                        <div>
                          <p className="eyebrow mb-1">Bug Report</p>
                          <h2 className="text-xl font-bold text-stone-900">回報網頁問題</h2>
                        </div>
                        <button
                          onClick={() => setBugOpen(false)}
                          className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition text-lg leading-none"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-medium text-stone-500 mb-1.5">問題頁面 / 功能</label>
                          <input
                            value={bugPage}
                            onChange={(e) => setBugPage(e.target.value)}
                            placeholder="例：產品頁面、報價單、工單列表..."
                            className="w-full input"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-stone-500 mb-1.5">
                            問題描述 <span className="text-red-500">*</span>
                          </label>
                          <textarea
                            value={bugDesc}
                            onChange={(e) => setBugDesc(e.target.value)}
                            placeholder="請描述遇到的問題、重現步驟或預期行為..."
                            rows={4}
                            className="w-full input resize-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-stone-500 mb-1.5">回報人（選填）</label>
                          <input
                            value={bugReporter}
                            onChange={(e) => setBugReporter(e.target.value)}
                            placeholder="您的姓名或帳號"
                            className="w-full input"
                          />
                        </div>
                      </div>
                      <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100">
                        <button
                          onClick={() => setBugOpen(false)}
                          className="button-secondary flex-1 rounded-lg px-4 py-2.5 text-sm font-medium"
                        >
                          取消
                        </button>
                        <button
                          onClick={submitBugReport}
                          disabled={!bugDesc.trim() || bugSubmitting}
                          className="button-primary flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                        >
                          {bugSubmitting ? '送出中...' : '送出回報'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
