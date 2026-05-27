'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

// ── Types ─────────────────────────────────────────────────────

interface CatalogItem {
  code: string
  name: string
  brand: string
  productType: string
  category: string
}

interface FamilySpec {
  key: string
  label: string
  options: string[]
}

interface ProductFamily {
  id: string
  seriesCode: string
  seriesName: string
  brand: string
  productType: string
  category: string
  specs: FamilySpec[]
  skuMap?: Record<string, string>
  coveredSkuCodes?: string[]
}

interface RichData {
  notionId: string | null
  price: number | null
  imageUrl: string
  description: string
}

// ── Props ─────────────────────────────────────────────────────

interface Props {
  brands: string[]
  categories: string[]
  productTypes: string[]
}

// ── Image Upload Zone (drag-and-drop) ────────────────────────

function ImageUploadZone({
  imageUrl,
  onUrlChange,
  disabled,
}: {
  imageUrl: string
  onUrlChange: (url: string) => void
  disabled: boolean
}) {
  const [tab,       setTab]       = useState<'upload' | 'url'>('upload')
  const [dragging,  setDragging]  = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress,  setProgress]  = useState(0)
  const [imgError,  setImgError]  = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const previewUrl = imageUrl.trim()

  const uploadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadErr('只支援圖片格式（JPG、PNG、WebP、GIF）')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadErr('圖片大小不能超過 5 MB')
      return
    }
    setUploadErr('')
    setUploading(true)
    setProgress(10)

    // Simulate progress while uploading
    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + 15, 85))
    }, 200)

    const fd = new FormData()
    fd.append('file', file)

    try {
      const res = await fetch('/api/products/upload-image', { method: 'POST', body: fd })
      const data = await res.json()
      clearInterval(interval)
      if (!res.ok) {
        setUploadErr(data.error ?? '上傳失敗')
      } else {
        setProgress(100)
        onUrlChange(data.url)
        setImgError(false)
        setTimeout(() => setProgress(0), 600)
      }
    } catch {
      clearInterval(interval)
      setUploadErr('網路錯誤，請稍後再試')
    } finally {
      setUploading(false)
    }
  }, [onUrlChange])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }, [uploadFile])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
    e.target.value = ''
  }

  return (
    <div>
      <div className="flex gap-1 mb-3 p-1 bg-gray-100 rounded-xl w-fit">
        {(['upload', 'url'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={[
              'px-4 py-1.5 rounded-lg text-xs font-semibold transition',
              tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {t === 'upload' ? '📁 上傳圖片' : '🔗 貼入網址'}
          </button>
        ))}
      </div>

      {tab === 'upload' ? (
        <>
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !disabled && !uploading && fileRef.current?.click()}
            className={[
              'relative w-full rounded-2xl border-2 border-dashed transition cursor-pointer overflow-hidden',
              dragging  ? 'border-brand-400 bg-brand-50 scale-[1.01]' :
              uploading ? 'border-blue-300 bg-blue-50 cursor-default' :
                          'border-gray-200 bg-gray-50 hover:border-brand-300 hover:bg-brand-50/40',
              disabled  ? 'opacity-50 pointer-events-none' : '',
            ].join(' ')}
            style={{ minHeight: 180 }}
          >
            {/* Progress bar */}
            {uploading && progress > 0 && (
              <div className="absolute top-0 left-0 h-1 bg-brand-400 rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }} />
            )}

            {previewUrl && !imgError ? (
              /* Preview */
              <div className="relative">
                <img
                  src={previewUrl}
                  alt="商品圖片"
                  className="w-full object-contain max-h-56"
                  onError={() => setImgError(true)}
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition flex items-center justify-center">
                  <span className="text-white text-sm font-medium opacity-0 hover:opacity-100 bg-black/50 px-3 py-1 rounded-full">
                    點擊或拖曳更換
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-10 px-4">
                {uploading ? (
                  <>
                    <svg className="animate-spin h-8 w-8 text-brand-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    <span className="text-sm text-brand-500 font-medium">上傳中…</span>
                  </>
                ) : dragging ? (
                  <>
                    <span className="text-4xl">📥</span>
                    <span className="text-sm font-semibold text-brand-600">放開以上傳</span>
                  </>
                ) : (
                  <>
                    <span className="text-4xl text-gray-300">🖼</span>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-gray-600">拖曳圖片到這裡</p>
                      <p className="text-xs text-gray-400 mt-1">或點擊選擇檔案</p>
                    </div>
                    <span className="text-xs text-gray-300 bg-white border border-gray-200 px-3 py-1 rounded-full">
                      JPG / PNG / WebP · 最大 5 MB
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />

          {uploadErr && (
            <p className="text-xs text-red-500 mt-2">{uploadErr}</p>
          )}
          {previewUrl && !imgError && (
            <button
              type="button"
              onClick={() => { onUrlChange(''); setImgError(false) }}
              className="mt-2 text-xs text-gray-400 hover:text-red-500 transition"
            >
              ✕ 移除圖片
            </button>
          )}
        </>
      ) : (
        /* URL tab */
        <>
          {previewUrl && !imgError && (
            <div className="mb-3 w-full h-44 rounded-2xl overflow-hidden bg-gray-50 border border-gray-200">
              <img src={previewUrl} alt="預覽" className="w-full h-full object-contain"
                onError={() => setImgError(true)} />
            </div>
          )}
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => { onUrlChange(e.target.value); setImgError(false) }}
            placeholder="貼上圖片網址（https://…）"
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
            disabled={disabled}
          />
          <p className="text-xs text-gray-400 mt-1.5">
            可貼入 Google Drive 公開連結、Notion 附件連結或任何公開圖片 URL。
          </p>
        </>
      )}
    </div>
  )
}

// ── Product Edit Drawer ───────────────────────────────────────

function ProductEditDrawer({
  skuCode,
  onClose,
  onSaved,
}: {
  skuCode: string
  onClose: () => void
  onSaved: (skuCode: string, price: number | null, imageUrl: string) => void
}) {
  const [catalog, setCatalog] = useState<CatalogItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  // Form state
  const [price,       setPrice]       = useState('')
  const [imageUrl,    setImageUrl]    = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    fetch(`/api/products/sku/${encodeURIComponent(skuCode)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return }
        setCatalog(data.catalog)
        setPrice(data.rich.price != null ? String(data.rich.price) : '')
        setImageUrl(data.rich.imageUrl ?? '')
        setDescription(data.rich.description ?? '')
      })
      .catch(() => setError('無法載入商品資料'))
      .finally(() => setLoading(false))
  }, [skuCode])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    const priceNum = price.trim() !== '' ? Number(price) : null
    if (price.trim() !== '' && isNaN(priceNum!)) {
      setError('售價必須為數字')
      setSaving(false)
      return
    }
    const res = await fetch(`/api/products/sku/${encodeURIComponent(skuCode)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: priceNum, imageUrl: imageUrl.trim(), description }),
    }).catch(() => null)

    if (!res?.ok) {
      const d = await res?.json().catch(() => ({}))
      setError(d?.error ?? '儲存失敗，請稍後再試')
      setSaving(false)
      return
    }
    setSaving(false)
    onSaved(skuCode, priceNum, imageUrl.trim())
    onClose()
  }

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <motion.div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }} onClick={onClose}
      />

      <motion.div
        className="relative ml-auto w-full max-w-lg h-full bg-white shadow-2xl flex flex-col overflow-hidden"
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-500 mb-1">編輯商品</p>
            <h2 className="text-lg font-bold text-slate-900 leading-snug">
              {loading ? '載入中…' : (catalog?.name ?? skuCode)}
            </h2>
            <p className="text-xs font-mono text-gray-400 mt-0.5">{skuCode}</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {catalog && (
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">基本資料</p>
              {[['品牌', catalog.brand], ['分類', catalog.category], ['商品類型', catalog.productType]].map(
                ([label, val]) => val ? (
                  <div key={label} className="flex gap-3 text-sm py-1">
                    <span className="text-slate-400 w-20 shrink-0">{label}</span>
                    <span className="text-slate-700 font-medium">{val}</span>
                  </div>
                ) : null
              )}
            </div>
          )}

          {/* 售價 */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              售價 <span className="text-gray-400 font-normal text-xs">（NT$）</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">NT$</span>
              <input
                type="number" min={0} value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="尚未設定"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
                disabled={loading}
              />
            </div>
          </div>

          {/* 商品圖片 */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">商品圖片</label>
            <ImageUploadZone
              imageUrl={imageUrl}
              onUrlChange={setImageUrl}
              disabled={loading}
            />
          </div>

          {/* 商品介紹 */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">商品介紹</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="填入產品特色、規格說明、使用注意事項…"
              rows={6}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent leading-relaxed"
              disabled={loading}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
          <button onClick={onClose} disabled={saving}
            className="px-5 py-2 rounded-full text-sm font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">
            取消
          </button>
          <button onClick={handleSave} disabled={loading || saving}
            className="px-6 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition disabled:opacity-50 flex items-center gap-2">
            {saving && (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            )}
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── SKU Row ───────────────────────────────────────────────────

function SkuRow({
  item,
  priceCache,
  imageFlagCache,
  onEdit,
}: {
  item: CatalogItem
  priceCache: Map<string, number | null>
  imageFlagCache: Set<string>
  onEdit: (item: CatalogItem) => void
}) {
  const hasPrice = priceCache.has(item.code)
  const hasImage = imageFlagCache.has(item.code)
  const price    = priceCache.get(item.code)

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 group">
      {/* Image dot */}
      <div className={`w-2 h-2 rounded-full shrink-0 ${hasImage ? 'bg-blue-400' : 'bg-gray-200'}`} />

      <div className="flex-1 min-w-0">
        <span className="font-mono text-[11px] text-gray-400 mr-2">{item.code}</span>
        <span className="text-sm text-gray-800">{item.name}</span>
      </div>

      {hasPrice && price != null && (
        <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full shrink-0">
          NT${price.toLocaleString('zh-TW')}
        </span>
      )}

      <button
        onClick={() => onEdit(item)}
        className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition opacity-0 group-hover:opacity-100"
      >
        編輯
      </button>
    </div>
  )
}

// ── Family Card ───────────────────────────────────────────────

const PAGE_SIZE = 100

function FamilyCard({
  family,
  allItems,
  priceCache,
  imageFlagCache,
  onEdit,
}: {
  family: ProductFamily
  allItems: CatalogItem[]
  priceCache: Map<string, number | null>
  imageFlagCache: Set<string>
  onEdit: (item: CatalogItem) => void
}) {
  const [open,         setOpen]         = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Reset pagination when collapsed
  const handleToggle = () => {
    setOpen((v) => {
      if (v) setVisibleCount(PAGE_SIZE) // reset on collapse
      return !v
    })
  }

  // Get SKU codes for this family
  const skuCodes: string[] = family.skuMap
    ? Array.from(new Set(Object.values(family.skuMap)))
    : (family.coveredSkuCodes ?? [])

  // Match to catalog items
  const items = skuCodes.length > 0
    ? skuCodes.map((c) => allItems.find((it) => it.code === c)).filter(Boolean) as CatalogItem[]
    : allItems.filter((it) => it.code.startsWith(family.seriesCode))

  if (items.length === 0) return null

  const priceSetCount = items.filter((it) => priceCache.has(it.code) && priceCache.get(it.code) != null).length
  const imageSetCount = items.filter((it) => imageFlagCache.has(it.code)).length

  const visibleItems  = items.slice(0, visibleCount)
  const remaining     = items.length - visibleCount

  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden">
      {/* Family header */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition"
      >
        <span className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{family.seriesName}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{family.brand}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-gray-400">{items.length} 個 SKU</span>
            {priceSetCount > 0 && (
              <span className="text-xs text-emerald-600">✓ {priceSetCount} 已設售價</span>
            )}
            {imageSetCount > 0 && (
              <span className="text-xs text-blue-600">✓ {imageSetCount} 已設圖片</span>
            )}
          </div>
        </div>
        <span className="text-xs text-gray-400 shrink-0">{family.category}</span>
      </button>

      {/* SKU list */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 px-5 py-2">
              {visibleItems.map((item) => (
                <SkuRow
                  key={item.code}
                  item={item}
                  priceCache={priceCache}
                  imageFlagCache={imageFlagCache}
                  onEdit={onEdit}
                />
              ))}

              {/* "Show more" button */}
              {remaining > 0 && (
                <div className="py-3 text-center border-t border-gray-100 mt-1">
                  <button
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    className="text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-4 py-1.5 rounded-full transition"
                  >
                    顯示更多 {Math.min(remaining, PAGE_SIZE)} 筆（還剩 {remaining} 筆）
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────

export function CatalogManagerContent({ brands, categories, productTypes }: Props) {
  const [families,     setFamilies]     = useState<ProductFamily[]>([])
  const [allItems,     setAllItems]     = useState<CatalogItem[]>([])
  const [loading,      setLoading]      = useState(true)

  const [search,         setSearch]         = useState('')
  const [filterBrand,    setFilterBrand]    = useState('')
  const [filterCategory, setFilterCategory] = useState('')

  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null)

  // Cache: skuCode → price (and whether image is set)
  // Populated lazily as users save products.
  const [priceCache,     setPriceCache]     = useState<Map<string, number | null>>(new Map())
  const [imageFlagCache, setImageFlagCache] = useState<Set<string>>(new Set())

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load families + full catalog on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/products/families').then((r) => r.json()),
      // Dedicated endpoint: returns raw { code, name, brand, … } format,
      // no 200-item cap, 5-min browser cache.
      fetch('/api/products/catalog-raw').then((r) => r.json()),
    ])
      .then(([fams, raw]) => {
        setFamilies(Array.isArray(fams) ? fams : [])
        setAllItems(Array.isArray(raw) ? raw : [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  // Debounced search results
  const [searchResults, setSearchResults] = useState<CatalogItem[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  const isSearching = search.trim().length > 0 || filterBrand || filterCategory

  useEffect(() => {
    if (!isSearching) { setSearchResults([]); return }
    if (timerRef.current) clearTimeout(timerRef.current)
    setSearchLoading(true)
    timerRef.current = setTimeout(() => {
      const params = new URLSearchParams({ limit: '200' })
      if (search.trim()) params.set('q', search.trim())
      if (filterBrand)    params.set('brand', filterBrand)
      if (filterCategory) params.set('category', filterCategory)
      fetch(`/api/products/search?${params}`)
        .then((r) => r.json())
        .then((data) => {
          const items: CatalogItem[] = Array.isArray(data)
            ? data.map((it: any) => ({
                code:        it.skuCode || it.id || '',
                name:        it.name    || '',
                brand:       it.manufacturer || '',
                productType: it.productType  || '',
                category:    it.category     || '',
              }))
            : []
          setSearchResults(items)
        })
        .catch(console.error)
        .finally(() => setSearchLoading(false))
    }, 300)
  }, [search, filterBrand, filterCategory, isSearching])

  // After a save, update caches
  const handleSaved = useCallback((skuCode: string, price: number | null, imageUrl: string) => {
    setPriceCache((prev) => {
      const next = new Map(prev)
      next.set(skuCode, price)
      return next
    })
    setImageFlagCache((prev) => {
      const next = new Set(prev)
      if (imageUrl) next.add(skuCode)
      else next.delete(skuCode)
      return next
    })
  }, [])

  // Filter families by active filters (brand/category)
  const visibleFamilies = families.filter((f) => {
    if (filterBrand    && f.brand    !== filterBrand)    return false
    if (filterCategory && f.category !== filterCategory) return false
    return true
  })

  const chip = (active: boolean) => [
    'px-3 py-1 rounded-full text-xs font-medium border transition-all',
    active
      ? 'bg-brand-500 border-brand-500 text-white shadow-sm'
      : 'bg-white border-gray-300 text-gray-600 hover:border-brand-400 hover:text-brand-600',
  ].join(' ')

  return (
    <>
      {/* Search + Filters */}
      <div className="mb-6 space-y-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋貨號、品名、品牌…"
          className="w-full max-w-lg px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
        />

        {/* Brand filter */}
        {brands.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setFilterBrand('')} className={chip(!filterBrand)}>全部品牌</button>
            {brands.map((b) => (
              <button key={b} onClick={() => setFilterBrand(filterBrand === b ? '' : b)} className={chip(filterBrand === b)}>
                {b}
              </button>
            ))}
          </div>
        )}

        {/* Category filter */}
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setFilterCategory('')} className={chip(!filterCategory)}>全部分類</button>
            {categories.map((c) => (
              <button key={c} onClick={() => setFilterCategory(filterCategory === c ? '' : c)} className={chip(filterCategory === c)}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />已設圖片</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-200 inline-block" />未設圖片</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />已設售價</span>
        <span className="text-gray-300">· 滑鼠移到商品列可見「編輯」按鈕</span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-2xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : isSearching ? (
        /* ── Search results mode ── */
        <div className="panel p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">
              {searchLoading ? '搜尋中…' : `找到 ${searchResults.length} 筆`}
            </span>
            <button onClick={() => { setSearch(''); setFilterBrand(''); setFilterCategory('') }}
              className="text-xs text-gray-400 hover:text-gray-600">
              清除篩選
            </button>
          </div>
          <div className="px-5 py-2 max-h-[65vh] overflow-y-auto">
            {searchResults.length === 0 && !searchLoading && (
              <p className="py-8 text-center text-sm text-gray-400">找不到符合的商品</p>
            )}
            {searchResults.map((item) => (
              <SkuRow
                key={item.code}
                item={item}
                priceCache={priceCache}
                imageFlagCache={imageFlagCache}
                onEdit={setEditingItem}
              />
            ))}
          </div>
        </div>
      ) : (
        /* ── Family browse mode ── */
        <div className="space-y-3">
          {visibleFamilies.length === 0 && (
            <p className="text-center py-12 text-sm text-gray-400">沒有符合條件的系列</p>
          )}
          {visibleFamilies.map((family) => (
            <FamilyCard
              key={family.id}
              family={family}
              allItems={allItems}
              priceCache={priceCache}
              imageFlagCache={imageFlagCache}
              onEdit={setEditingItem}
            />
          ))}
        </div>
      )}

      {/* Edit Drawer */}
      <AnimatePresence>
        {editingItem && (
          <ProductEditDrawer
            key={editingItem.code}
            skuCode={editingItem.code}
            onClose={() => setEditingItem(null)}
            onSaved={handleSaved}
          />
        )}
      </AnimatePresence>
    </>
  )
}
