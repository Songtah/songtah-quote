'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

type ProductItem = {
  id: string
  name: string
  manufacturer: string
  productType: string
  category: string
  price: number | null
  salePrice: number | null
  notes: string
  weight: number | null
  bendingStrength: string
  transparency: string
  sinteringTemp: string
  bendingModulus: string
  flexuralStrength: string
  tensileStrength: string
  elongation: string
  hardness: string
  workingDistance: string
  fieldWidth: string
  fieldDepth: string
}

const inputCls =
  'w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-700'

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
function SpecRow({ label, value }: { label: string; value: string | number | null }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex gap-2 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-slate-400 w-36 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-slate-700 font-medium">{value}</span>
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

  return (
    <div
      className="fixed inset-0 z-50 flex"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-lg h-full bg-white shadow-2xl flex flex-col overflow-hidden animate-slide-in">
        {/* Header */}
        <div className="flex items-start gap-4 px-6 py-5 border-b border-gray-100">
          <ProductThumb id={p.id} name={p.name} size={72} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-green-700 mb-1">
              {p.productType || '產品'}
            </p>
            <h2 className="text-xl font-bold text-slate-900 leading-snug">{p.name || '（未命名）'}</h2>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {p.manufacturer && (
                <span className="px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-xs text-green-800 font-medium">
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
            className="text-gray-400 hover:text-gray-600 text-xl leading-none shrink-0 mt-0.5"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

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
                  <div className="flex-1 bg-green-50 rounded-xl p-4 border border-green-100">
                    <p className="text-xs text-green-600 mb-1">優惠價</p>
                    <p className="text-lg font-bold text-green-800">{formatPrice(p.salePrice)}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Basic info */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">基本資料</p>
            <div className="bg-gray-50 rounded-xl px-4 py-1">
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
      </div>
    </div>
  )
}

// ── Product Card ─────────────────────────────────────────────────────────────
function ProductCard({ p, onClick }: { p: ProductItem; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-start gap-4 px-5 py-4 hover:bg-green-50/50 transition group"
    >
      <ProductThumb id={p.id} name={p.name} size={64} />

      <div className="flex-1 min-w-0">
        <div className="font-semibold text-slate-900 truncate leading-snug">
          {p.name || '（未命名）'}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {p.manufacturer && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-xs text-green-800 font-medium">
              {p.manufacturer}
            </span>
          )}
          {p.category && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-xs text-blue-700 font-medium">
              {p.category}
            </span>
          )}
          {p.productType && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-xs text-gray-600">
              {p.productType}
            </span>
          )}
        </div>
      </div>

      {p.price != null && (
        <div className="shrink-0 text-right">
          <div className="text-sm font-bold text-slate-800">{formatPrice(p.price)}</div>
          <div className="text-xs text-slate-400 mt-0.5">定價</div>
        </div>
      )}

      <svg className="w-4 h-4 text-gray-300 group-hover:text-green-600 transition shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export function ProductsContent({
  total,
  brands,
  types,
}: {
  total: number
  brands: string[]
  types: string[]
}) {
  const debounceRef = useRef<NodeJS.Timeout>()
  const [query, setQuery] = useState('')
  const [activeBrand, setActiveBrand] = useState('')
  const [activeType, setActiveType] = useState('')
  const [results, setResults] = useState<ProductItem[]>([])
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null)

  // Bug report modal
  const [bugOpen, setBugOpen] = useState(false)
  const [bugPage, setBugPage] = useState('')
  const [bugDesc, setBugDesc] = useState('')
  const [bugReporter, setBugReporter] = useState('')
  const [bugSubmitting, setBugSubmitting] = useState(false)
  const [bugDone, setBugDone] = useState(false)

  const hasActiveFilter = activeBrand !== '' || activeType !== ''

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (query.trim()) params.set('q', query.trim())
        if (activeBrand) params.set('brand', activeBrand)
        if (activeType) params.set('type', activeType)
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
  }, [query, activeBrand, activeType])

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

  const filterTag = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
        active
          ? 'bg-green-800 text-white shadow-sm'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  )

  return (
    <>
      {/* 統計卡片 */}
      <div className="mb-8">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 inline-flex flex-col gap-1 min-w-[180px]">
          <p className="text-xs font-semibold uppercase tracking-widest text-green-700">Products</p>
          <p className="text-4xl font-black text-slate-900">{total}</p>
          <p className="text-sm text-slate-500">可供報價與售後查詢的產品主檔數量</p>
        </div>
      </div>

      {/* 搜尋列 */}
      <div className="mb-5 relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜尋產品名稱、生產商、分類..."
          className={inputCls + ' pr-10'}
          autoComplete="off"
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            搜尋中...
          </span>
        )}
        {query && !loading && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
          >
            ✕
          </button>
        )}
      </div>

      {/* 篩選工具列 */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setFilterOpen((v) => !v)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all ${
              filterOpen || hasActiveFilter
                ? 'bg-green-800 text-white border-green-800 shadow-sm'
                : 'bg-white text-slate-600 border-gray-300 hover:border-green-700 hover:text-green-800'
            }`}
          >
            <svg className={`w-4 h-4 transition-transform ${filterOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm2 4a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm2 4a1 1 0 011-1h4a1 1 0 110 2H8a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
            篩選
            {hasActiveFilter && (
              <span className="bg-white/30 text-white text-xs px-1.5 py-0.5 rounded-full font-semibold leading-none">
                {(activeBrand ? 1 : 0) + (activeType ? 1 : 0)}
              </span>
            )}
          </button>

          {/* 已啟用的篩選標籤（收合狀態也顯示） */}
          {!filterOpen && hasActiveFilter && (
            <div className="flex flex-wrap gap-2 items-center">
              {activeBrand && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-50 border border-green-200 text-xs text-green-800 font-medium">
                  {activeBrand}
                  <button onClick={() => setActiveBrand('')} className="hover:text-green-600 leading-none">✕</button>
                </span>
              )}
              {activeType && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 border border-blue-200 text-xs text-blue-700 font-medium">
                  {activeType}
                  <button onClick={() => setActiveType('')} className="hover:text-blue-500 leading-none">✕</button>
                </span>
              )}
              <button
                onClick={() => { setActiveBrand(''); setActiveType('') }}
                className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2"
              >
                清除全部
              </button>
            </div>
          )}
        </div>

        {/* 展開的篩選面板 */}
        {filterOpen && (
          <div className="mt-4 p-4 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-4">
            {brands.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">依生產商</p>
                <div className="flex flex-wrap gap-2">
                  {filterTag('全部', activeBrand === '', () => setActiveBrand(''))}
                  {brands.map((b) =>
                    filterTag(b, activeBrand === b, () => setActiveBrand(activeBrand === b ? '' : b))
                  )}
                </div>
              </div>
            )}
            {types.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">依商品類型</p>
                <div className="flex flex-wrap gap-2">
                  {filterTag('全部', activeType === '', () => setActiveType(''))}
                  {types.map((t) =>
                    filterTag(t, activeType === t, () => setActiveType(activeType === t ? '' : t))
                  )}
                </div>
              </div>
            )}
            {hasActiveFilter && (
              <div className="pt-2 border-t border-gray-100">
                <button
                  onClick={() => { setActiveBrand(''); setActiveType('') }}
                  className="text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2"
                >
                  清除所有篩選
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 產品列表 */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-green-700 mb-0.5">Products</p>
            <h3 className="text-lg font-bold text-slate-900">產品清單</h3>
          </div>
          <span className="text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
            {initialized ? `${results.length} 筆` : `共 ${total} 筆`}
          </span>
        </div>

        {!initialized ? (
          <div className="divide-y divide-gray-50">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="w-16 h-16 rounded-xl bg-gray-100 animate-pulse shrink-0" />
                <div className="flex-1">
                  <div className="h-4 w-48 bg-gray-100 rounded animate-pulse mb-2" />
                  <div className="h-3 w-28 bg-gray-50 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400">
            {query.trim() || activeBrand || activeType ? '找不到符合的產品' : '尚無產品資料'}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {results.map((p) => (
              <ProductCard key={p.id} p={p} onClick={() => setSelectedProduct(p)} />
            ))}
          </div>
        )}
      </div>

      {/* 產品詳細側板 */}
      {selectedProduct && (
        <ProductDetail p={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}

      {/* 問題回報浮動按鈕 */}
      <button
        onClick={() => setBugOpen(true)}
        className="fixed bottom-8 right-8 flex items-center gap-2 bg-green-800 hover:bg-green-900 text-white text-sm font-medium px-4 py-3 rounded-full shadow-lg transition-all hover:shadow-xl z-40"
      >
        <span>🐛</span>
        <span>回報問題</span>
      </button>

      {/* 問題回報 Modal */}
      {bugOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setBugOpen(false) }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            {bugDone ? (
              <div className="py-8 text-center">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-lg font-bold text-slate-900">感謝回報！</p>
                <p className="text-sm text-slate-500 mt-1">我們已收到您的問題，將盡快處理。</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-green-700 mb-0.5">Bug Report</p>
                    <h2 className="text-xl font-bold text-slate-900">回報網頁問題</h2>
                  </div>
                  <button onClick={() => setBugOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">問題頁面 / 功能</label>
                    <input
                      value={bugPage}
                      onChange={(e) => setBugPage(e.target.value)}
                      placeholder="例：產品頁面、報價單、工單列表..."
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      問題描述 <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={bugDesc}
                      onChange={(e) => setBugDesc(e.target.value)}
                      placeholder="請描述遇到的問題、重現步驟或預期行為..."
                      rows={4}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700 resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">回報人（選填）</label>
                    <input
                      value={bugReporter}
                      onChange={(e) => setBugReporter(e.target.value)}
                      placeholder="您的姓名或帳號"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                    />
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setBugOpen(false)}
                    className="flex-1 border border-gray-300 text-gray-600 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-gray-50 transition"
                  >
                    取消
                  </button>
                  <button
                    onClick={submitBugReport}
                    disabled={!bugDesc.trim() || bugSubmitting}
                    className="flex-1 bg-green-800 hover:bg-green-900 disabled:opacity-50 text-white rounded-lg px-4 py-2.5 text-sm font-semibold transition"
                  >
                    {bugSubmitting ? '送出中...' : '送出回報'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
