'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Customer, QuoteItem } from '@/types'

interface Props {
  /** Called immediately after the quote is created (e.g. to refresh a list) */
  onCreated?: (result: { shareUrl: string; id: string; quoteNumber: string }) => void
  /** Called when the user wants to close/cancel (e.g. to close a drawer) */
  onClose?: () => void
}

/**
 * 產品資料庫(products_catalog.json)的選品結果。
 * 與訂貨頁共用 /api/products/search,價格已套用中央售價覆寫。
 */
type CatalogPick = {
  skuCode: string
  name: string
  manufacturer: string
  productType: string
  category: string
  price: number | null
  salePrice: number | null
  /** 產品圖(存於 Notion 產品資料庫,由 SKU→圖片索引帶出);無圖為空字串 */
  imageUrl: string
}

/** 有效售價:優惠價 > 目錄價;與 OrderForm 同一套取法。 */
function effectivePrice(product: CatalogPick): number | null {
  return product.salePrice ?? product.price ?? null
}

type DraftItem = QuoteItem & { tempId: string }

function formatMoney(n: number) {
  return 'NT$ ' + n.toLocaleString('zh-TW')
}

function createTempId() {
  return Math.random().toString(36).slice(2)
}

function createItemFromProduct(product: CatalogPick): DraftItem {
  const unitPrice = effectivePrice(product) ?? 0
  return {
    tempId: createTempId(),
    productId: product.skuCode,
    name: product.name,
    brand: product.manufacturer,
    category: product.category,
    spec: product.productType,
    unit: '個',
    unitPrice,
    quantity: 1,
    subtotal: unitPrice,
    note: '',
    imageUrl: product.imageUrl || '',
    isCustom: false,
  }
}

function createCustomItem(): DraftItem {
  return {
    tempId: createTempId(),
    productId: '',
    name: '',
    brand: '客製化',
    category: '',
    spec: '',
    unit: '式',
    unitPrice: 0,
    quantity: 1,
    subtotal: 0,
    note: '',
    imageUrl: '',
    isCustom: true,
  }
}

export default function QuoteForm({ onCreated, onClose }: Props) {
  const router = useRouter()
  const detailSectionRef = useRef<HTMLDivElement | null>(null)
  const latestAddedItemRef = useRef<HTMLDivElement | null>(null)

  // ── 選品:與訂貨頁共用產品資料庫(/api/products/search) ─────────
  // 目錄有 6,000+ 品項,不可一次全載,改為伺服器端搜尋 + debounce。
  const [products, setProducts] = useState<CatalogPick[]>([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [brands, setBrands] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])

  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [manualCustomer, setManualCustomer] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerTaxId, setCustomerTaxId] = useState('')
  const [companyTitle, setCompanyTitle] = useState('')
  const [showCustomerList, setShowCustomerList] = useState(false)
  const customerDebounce = useRef<NodeJS.Timeout>()

  useEffect(() => {
    if (customerQuery.length < 1) {
      setCustomerResults([])
      return
    }

    clearTimeout(customerDebounce.current)
    customerDebounce.current = setTimeout(async () => {
      const res = await fetch(`/api/customers?q=${encodeURIComponent(customerQuery)}`)
      const data = await res.json()
      setCustomerResults(Array.isArray(data) ? data : [])
      setShowCustomerList(true)
    }, 300)
  }, [customerQuery])

  function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer)
    setCustomerQuery(customer.name)
    setManualCustomer(customer.name)
    setCustomerPhone(customer.phone || '')
    setCustomerAddress(customer.address || '')
    setCustomerTaxId(customer.taxId || '')
    setShowCustomerList(false)
  }

  function clearCustomer() {
    setSelectedCustomer(null)
    setCustomerQuery('')
    setManualCustomer('')
    setCustomerPhone('')
    setCustomerAddress('')
    setCustomerTaxId('')
    setCompanyTitle('')
  }

  const effectiveCustomerName = selectedCustomer?.name || manualCustomer.trim()

  const [salesperson, setSalesperson] = useState('')
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  })
  const [paymentTerms, setPaymentTerms] = useState('貨到付款')
  const [note, setNote] = useState('')

  const [productQuery, setProductQuery] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [items, setItems] = useState<DraftItem[]>([])
  const [highlightedItemId, setHighlightedItemId] = useState('')
  const [expandedItemIds, setExpandedItemIds] = useState<string[]>([])

  // 品牌/品類選項來自整份目錄(非當前搜尋結果),避免選項隨搜尋忽有忽無
  useEffect(() => {
    fetch('/api/products/options')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        setBrands(Array.isArray(data.brands) ? data.brands : [])
        setCategories(Array.isArray(data.categories) ? data.categories : [])
      })
      .catch(() => {})
  }, [])

  // 搜尋結果:debounce 250ms,並以 AbortController 取消過期請求
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setProductsLoading(true)
      const params = new URLSearchParams()
      if (productQuery.trim()) params.set('q', productQuery.trim())
      if (brandFilter) params.set('brand', brandFilter)
      if (categoryFilter) params.set('category', categoryFilter)
      params.set('limit', '100')
      fetch(`/api/products/search?${params}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setProducts(Array.isArray(data) ? data : []))
        .catch((error) => {
          if (error?.name !== 'AbortError') setProducts([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setProductsLoading(false)
        })
    }, 250)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [productQuery, brandFilter, categoryFilter])

  const filteredProducts = products

  function addProduct(product: CatalogPick) {
    const newItem = createItemFromProduct(product)
    setItems((prev) => [...prev, newItem])
    setExpandedItemIds((prev) => [...prev, newItem.tempId])
  }

  function addCustomItem() {
    const newItem = createCustomItem()
    setItems((prev) => [...prev, newItem])
    setHighlightedItemId(newItem.tempId)
    setExpandedItemIds((prev) => [...prev, newItem.tempId])
    requestAnimationFrame(() => {
      detailSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  function updateItem(tempId: string, field: keyof QuoteItem, value: string | number | boolean) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.tempId !== tempId) return item

        const updated = { ...item, [field]: value } as DraftItem
        const unitPrice = Number(updated.unitPrice) || 0
        const quantity = Math.max(1, Number(updated.quantity) || 1)
        updated.unitPrice = unitPrice
        updated.quantity = quantity
        updated.subtotal = unitPrice * quantity
        return updated
      })
    )
  }

  function removeItem(tempId: string) {
    setItems((prev) => prev.filter((item) => item.tempId !== tempId))
    setExpandedItemIds((prev) => prev.filter((id) => id !== tempId))
  }

  function toggleExpanded(tempId: string) {
    setExpandedItemIds((prev) =>
      prev.includes(tempId) ? prev.filter((id) => id !== tempId) : [...prev, tempId]
    )
  }

  useEffect(() => {
    if (!highlightedItemId) return

    const scrollTimer = window.setTimeout(() => {
      latestAddedItemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 120)
    const clearTimer = window.setTimeout(() => {
      setHighlightedItemId('')
    }, 2200)

    return () => {
      window.clearTimeout(scrollTimer)
      window.clearTimeout(clearTimer)
    }
  }, [highlightedItemId, items.length])

  const total = items.reduce((sum, item) => sum + item.subtotal, 0)

  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ shareUrl: string; id: string; quoteNumber: string } | null>(null)
  const [submitError, setSubmitError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!effectiveCustomerName) {
      setSubmitError('請輸入客戶名稱')
      return
    }

    if (items.length === 0) {
      setSubmitError('請至少新增一個品項')
      return
    }

    if (items.some((item) => !item.name.trim())) {
      setSubmitError('每個品項都需要填寫品名')
      return
    }

    setSubmitting(true)
    setSubmitError('')

    const res = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: effectiveCustomerName,
        customerId: selectedCustomer?.id ?? '',
        companyTitle,
        customerPhone,
        customerAddress,
        customerTaxId,
        salesperson,
        validUntil,
        paymentTerms,
        note,
        items: items.map(({ tempId, subtotal, ...rest }) => rest),
      }),
    })

    setSubmitting(false)

    if (!res.ok) {
      const err = await res.json()
      setSubmitError(err.error || '送出失敗，請再試一次')
      return
    }

    const data = await res.json()
    const pageId = data.id.replace(/-/g, '')
    const resultData = { shareUrl: `/share/${pageId}`, id: pageId, quoteNumber: data.quoteNumber }
    setResult(resultData)
    onCreated?.(resultData)
  }

  if (result) {
    const shareUrl = `${window.location.origin}${result.shareUrl}`
    return (
      <div className="card-soft rounded-3xl p-7 sm:p-10 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-stone-800 mb-2">報價單已建立</h2>
        <p className="text-stone-500 text-sm mb-6">報價單號：{result.quoteNumber}</p>
        <div className="rounded-2xl bg-stone-50 p-4 mb-6 flex items-center gap-3 ring-1 ring-stone-900/[0.06]">
          <input
            readOnly
            value={shareUrl}
            className="flex-1 bg-transparent text-sm text-stone-600 outline-none"
          />
          <button
            onClick={() => navigator.clipboard.writeText(shareUrl)}
            className="text-green-800 text-sm font-medium hover:underline"
          >
            複製
          </button>
        </div>
        <div className="flex gap-3 justify-center">
          <a
            href={result.shareUrl}
            target="_blank"
            className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 hover:bg-brand-600 active:scale-95 transition-all"
          >
            檢視報價單
          </a>
          <a
            href={`/api/quotes/${result.id}/pdf`}
            className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 hover:bg-brand-600 active:scale-95 transition-all"
          >
            下載 PDF
          </a>
          <button
            onClick={() => onClose ? onClose() : router.push('/quotes')}
            className="rounded-full border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-50 active:scale-95 transition-all"
          >
            返回列表
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-24 sm:pb-0">
      <div className="card-soft rounded-3xl p-5 sm:p-7">
        <div className="mb-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">第一步</p>
          <h2 className="mt-1 text-lg font-bold text-stone-800">客戶資訊</h2>
          <p className="mt-1 text-sm text-stone-500">搜尋既有客戶可自動帶入資料，減少重複輸入。</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="relative">
            <label className="block text-sm font-medium text-stone-700 mb-1">
              客戶名稱 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={customerQuery}
              onChange={(e) => {
                setCustomerQuery(e.target.value)
                setManualCustomer(e.target.value)
                setSelectedCustomer(null)
              }}
              onFocus={() => customerQuery && setShowCustomerList(true)}
              onBlur={() => setTimeout(() => setShowCustomerList(false), 150)}
              className="input-soft w-full px-4 py-3 text-sm"
              placeholder="搜尋客戶或直接輸入名稱"
            />
            {selectedCustomer && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-green-600 bg-brand-50 px-2 py-1 rounded-full">✓ 已從清單選取</span>
                <button type="button" onClick={clearCustomer} className="text-xs text-stone-400 hover:text-stone-600">
                  清除
                </button>
              </div>
            )}
            {!selectedCustomer && customerQuery && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">✎ 手動輸入</span>
              </div>
            )}
            {showCustomerList && customerResults.length > 0 && (
              <div className="absolute z-10 w-full bg-white border border-stone-200 rounded-xl shadow-lg mt-1 max-h-64 overflow-y-auto">
                {customerResults.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onMouseDown={() => selectCustomer(customer)}
                    className="w-full text-left px-4 py-2.5 hover:bg-brand-50 text-sm border-b border-stone-50 last:border-0"
                  >
                    <div className="font-medium">{customer.name}</div>
                    <div className="text-xs text-stone-400 mt-0.5 flex gap-2">
                      {customer.city && <span>{customer.city}</span>}
                      {customer.type && <span className="text-green-600">{customer.type}</span>}
                      {customer.phone && <span>{customer.phone}</span>}
                    </div>
                    {customer.address && <div className="text-xs text-stone-300 truncate">{customer.address}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">電話</label>
            <input
              type="text"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              className="input-soft w-full px-4 py-3 text-sm"
              placeholder="輸入電話"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">統一編號</label>
            <input
              type="text"
              value={customerTaxId}
              onChange={(e) => setCustomerTaxId(e.target.value)}
              className="input-soft w-full px-4 py-3 text-sm"
              placeholder="輸入統一編號"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">
              公司抬頭 <span className="text-stone-400 font-normal text-xs">（選填）</span>
            </label>
            <input
              type="text"
              value={companyTitle}
              onChange={(e) => setCompanyTitle(e.target.value)}
              className="input-soft w-full px-4 py-3 text-sm"
              placeholder="如：XX 牙醫診所"
            />
          </div>
          <div className="col-span-full">
            <label className="block text-sm font-medium text-stone-700 mb-1">地址</label>
            <input
              type="text"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              className="input-soft w-full px-4 py-3 text-sm"
              placeholder="輸入地址"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">業務姓名</label>
            <input
              type="text"
              value={salesperson}
              onChange={(e) => setSalesperson(e.target.value)}
              className="input-soft w-full px-4 py-3 text-sm"
              placeholder="輸入業務姓名"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">有效期限</label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="input-soft w-full px-4 py-3 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">付款條件</label>
            <input
              type="text"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              className="input-soft w-full px-4 py-3 text-sm"
              placeholder="如：貨到付款、月結30天"
            />
          </div>
          <div className="col-span-full">
            <label className="block text-sm font-medium text-stone-700 mb-1">備註</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="input-soft w-full px-4 py-3 text-sm resize-none"
              placeholder="選填"
            />
          </div>
        </div>
      </div>

      <div className="card-soft rounded-3xl p-5 sm:p-7">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div><p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">第二步</p><h2 className="mt-1 text-lg font-bold text-stone-800">選擇產品</h2></div>
          <button
            type="button"
            onClick={addCustomItem}
            className="self-start md:self-auto rounded-full border border-stone-200 bg-white px-4 py-2.5 text-sm font-semibold text-stone-600 hover:bg-stone-50 active:scale-95 transition-all"
          >
            + 新增客製化品項
          </button>
        </div>

        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="text"
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            className="input-soft w-full px-4 py-2.5 text-sm sm:w-52"
            placeholder="搜尋品名、規格..."
          />
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="select-soft px-4 py-2.5 text-sm"
          >
            <option value="">全部品牌</option>
            {brands.map((brand) => (
              <option key={brand} value={brand}>
                {brand}
              </option>
            ))}
          </select>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="select-soft px-4 py-2.5 text-sm"
          >
            <option value="">全部品類</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>

        <div className="max-h-72 overflow-y-auto border border-stone-100 rounded-xl">
          {productsLoading ? (
            <div className="py-8 text-center text-sm text-stone-400">搜尋產品資料庫中…</div>
          ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 sticky top-0 text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2 text-left">產品圖</th>
                <th className="px-3 py-2 text-left">品名／貨號</th>
                <th className="px-3 py-2 text-left">品牌</th>
                <th className="px-3 py-2 text-left">型態</th>
                <th className="px-3 py-2 text-right">售價</th>
                <th className="px-3 py-2 text-center">加入</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-stone-400">
                    {productQuery || brandFilter || categoryFilter
                      ? '產品資料庫中沒有符合的品項'
                      : '輸入關鍵字或選擇品牌／分類以搜尋產品'}
                  </td>
                </tr>
              )}
              {filteredProducts.map((product) => {
                const price = effectivePrice(product)
                return (
                <tr key={product.skuCode} className="hover:bg-brand-50/50">
                  <td className="px-3 py-2">
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.name}
                        loading="lazy"
                        className="h-12 w-12 rounded-lg border border-stone-200 bg-white object-contain"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-stone-300 bg-stone-50 text-[10px] text-stone-400">
                        無圖
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{product.name}</div>
                    <div className="text-xs text-stone-400">{product.skuCode}</div>
                  </td>
                  <td className="px-3 py-2 text-stone-500">{product.manufacturer || '—'}</td>
                  <td className="px-3 py-2 text-stone-500">{product.productType || '—'}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {price != null
                      ? formatMoney(price)
                      : <span className="text-stone-400">待定價</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => addProduct(product)}
                      className="rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-brand-500/20 hover:bg-brand-600 active:scale-95 transition-all"
                    >
                      + 加入
                    </button>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
          )}
        </div>
      </div>

      <div ref={detailSectionRef} className="card-soft rounded-3xl p-5 sm:p-7">
        <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">第三步</p>
        <h2 className="mt-1 text-lg font-bold text-stone-800 mb-4">確認報價明細 ({items.length} 項)</h2>
        {items.length === 0 ? (
          <div className="text-center py-8 text-stone-400 text-sm">尚未新增任何品項</div>
        ) : (
          <div className="space-y-4">
            {items.map((item, index) => (
              <div
                key={item.tempId}
                ref={item.tempId === highlightedItemId ? latestAddedItemRef : null}
                className={`border rounded-2xl p-4 transition ${
                  item.tempId === highlightedItemId
                    ? 'border-brand-500 bg-brand-50/60 shadow-[0_0_0_3px_rgba(34,197,94,0.12)]'
                    : 'border-stone-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(item.tempId)}
                    className="flex-1 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-14 w-14 shrink-0 rounded-xl border border-dashed border-stone-300 bg-stone-50 overflow-hidden flex items-center justify-center">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.name || '產品圖片'} className="h-full w-full object-cover" />
                        ) : (
                          <div className="text-[10px] text-stone-400 text-center px-1">圖片預留</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-stone-400">品項 {index + 1}</div>
                        <div className="text-sm font-semibold text-stone-800 truncate">
                          {item.isCustom ? (item.name || '客製化品項') : item.name}
                        </div>
                        <div className="text-xs text-stone-500 mt-1">
                          {item.brand || '未填品牌'}
                          {item.spec ? ` · ${item.spec}` : ''}
                          {` · ${item.quantity}${item.unit || ''}`}
                        </div>
                        {item.tempId === highlightedItemId && (
                          <div className="text-xs text-green-700 mt-1">已新增客製化品項，請直接填寫內容</div>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(item.tempId)}
                      className="text-sm font-medium text-green-800 hover:text-green-900"
                    >
                      {expandedItemIds.includes(item.tempId) ? '收合' : '編輯'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(item.tempId)}
                      className="text-red-500 hover:text-red-700 text-sm font-medium"
                    >
                      刪除
                    </button>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-stone-100 flex items-center justify-between">
                  <div className="text-sm text-stone-500">
                    {item.brand || '未填品牌'}
                    {item.category ? ` · ${item.category}` : ''}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-stone-400">小計</div>
                    <div className="text-lg font-bold text-green-800">{formatMoney(item.subtotal)}</div>
                  </div>
                </div>

                {/* 常駐備註欄 */}
                <div className="mt-3">
                  <input
                    type="text"
                    value={item.note}
                    onChange={(e) => updateItem(item.tempId, 'note', e.target.value)}
                    className="input-soft w-full px-3 py-2 text-xs text-stone-600 placeholder:text-stone-400 bg-stone-50"
                    placeholder="備註（選填，會顯示於品名下方）"
                  />
                </div>

                {expandedItemIds.includes(item.tempId) && (
                  <div className="grid grid-cols-1 md:grid-cols-[132px,1fr] gap-4 mt-4 pt-4 border-t border-stone-100">
                    <div>
                      <div className="h-32 w-full rounded-xl border border-dashed border-stone-300 bg-stone-50 overflow-hidden flex items-center justify-center">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.name || '產品圖片'} className="h-full w-full object-cover" />
                        ) : (
                          <div className="text-center text-xs text-stone-400 px-3">
                            <div className="font-medium mb-1">圖片預留位置</div>
                            <div>可由產品價目表自動帶入</div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">
                          品名 <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => updateItem(item.tempId, 'name', e.target.value)}
                          className="input-soft w-full px-4 py-3 text-sm"
                          placeholder="輸入品名"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">規格</label>
                        <input
                          type="text"
                          value={item.spec}
                          onChange={(e) => updateItem(item.tempId, 'spec', e.target.value)}
                          className="input-soft w-full px-4 py-3 text-sm"
                          placeholder="可自由調整"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">品牌</label>
                        <input
                          type="text"
                          value={item.brand}
                          onChange={(e) => updateItem(item.tempId, 'brand', e.target.value)}
                          className="input-soft w-full px-4 py-3 text-sm"
                          placeholder="可自由輸入"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">品類</label>
                        <input
                          type="text"
                          value={item.category}
                          onChange={(e) => updateItem(item.tempId, 'category', e.target.value)}
                          className="input-soft w-full px-4 py-3 text-sm"
                          placeholder="可自由輸入"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">單位</label>
                        <input
                          type="text"
                          value={item.unit}
                          onChange={(e) => updateItem(item.tempId, 'unit', e.target.value)}
                          className="input-soft w-full px-4 py-3 text-sm"
                          placeholder="例：個、組、式"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">圖片網址</label>
                        <input
                          type="url"
                          value={item.imageUrl}
                          onChange={(e) => updateItem(item.tempId, 'imageUrl', e.target.value)}
                          className="input-soft w-full px-4 py-3 text-sm"
                          placeholder="可手動調整圖片來源"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">單價</label>
                        <input
                          type="number"
                          value={item.unitPrice}
                          min={0}
                          onChange={(e) => updateItem(item.tempId, 'unitPrice', Number(e.target.value))}
                          className="input-soft w-full px-4 py-3 text-right text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">數量</label>
                        <input
                          type="number"
                          value={item.quantity}
                          min={1}
                          onChange={(e) => updateItem(item.tempId, 'quantity', Number(e.target.value))}
                          className="input-soft w-full px-4 py-3 text-right text-sm"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <div className="pt-4 border-t border-stone-100 flex justify-between items-center">
              <span className="text-stone-500 text-sm">合計</span>
              <span className="text-2xl font-bold text-green-800">{formatMoney(total)}</span>
            </div>
          </div>
        )}
      </div>

      {submitError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          {submitError}
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 rounded-t-3xl border-t border-stone-900/[0.06] bg-[#fdfdfb]/95 px-4 py-3 shadow-[0_-4px_24px_rgba(28,25,23,0.06)] backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <button
          type="button"
          onClick={() => onClose ? onClose() : router.push('/quotes')}
          className="rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-medium text-stone-600 hover:bg-stone-50 active:scale-95 transition-all"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-full bg-brand-500 px-7 py-3 text-sm font-semibold text-white shadow-md shadow-brand-500/25 hover:bg-brand-600 active:scale-95 transition-all disabled:opacity-50 sm:flex-none"
        >
          {submitting ? '送出中...' : '送出報價單'}
        </button>
      </div>
    </form>
  )
}
