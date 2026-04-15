'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Customer, Product, QuoteItem } from '@/types'

interface Props {
  products: Product[]
}

type DraftItem = QuoteItem & { tempId: string }

function formatMoney(n: number) {
  return 'NT$ ' + n.toLocaleString('zh-TW')
}

function createTempId() {
  return Math.random().toString(36).slice(2)
}

function createItemFromProduct(product: Product): DraftItem {
  const unitPrice = product.price ?? 0
  return {
    tempId: createTempId(),
    productId: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    spec: product.spec,
    unit: product.unit || '個',
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

export default function QuoteForm({ products }: Props) {
  const router = useRouter()
  const detailSectionRef = useRef<HTMLDivElement | null>(null)
  const latestAddedItemRef = useRef<HTMLDivElement | null>(null)

  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [manualCustomer, setManualCustomer] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerTaxId, setCustomerTaxId] = useState('')
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

  const brands = Array.from(new Set(products.map((p) => p.brand).filter(Boolean))).sort()
  const categories = Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort()

  const filteredProducts = products.filter((product) => {
    const q = productQuery.toLowerCase()
    const matchQuery =
      !q ||
      product.name.toLowerCase().includes(q) ||
      product.spec.toLowerCase().includes(q) ||
      product.brand.toLowerCase().includes(q)
    const matchBrand = !brandFilter || product.brand === brandFilter
    const matchCat = !categoryFilter || product.category === categoryFilter
    return matchQuery && matchBrand && matchCat
  })

  function addProduct(product: Product) {
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
    setResult({ shareUrl: `/share/${pageId}`, id: pageId, quoteNumber: data.quoteNumber })
  }

  if (result) {
    const shareUrl = `${window.location.origin}${result.shareUrl}`
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-gray-800 mb-2">報價單已建立</h2>
        <p className="text-gray-500 text-sm mb-6">報價單號：{result.quoteNumber}</p>
        <div className="bg-gray-50 rounded-xl p-4 mb-6 flex items-center gap-3">
          <input
            readOnly
            value={shareUrl}
            className="flex-1 bg-transparent text-sm text-gray-600 outline-none"
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
            className="bg-green-800 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-900"
          >
            檢視報價單
          </a>
          <a
            href={`/api/quotes/${result.id}/pdf`}
            className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-green-700"
          >
            下載 PDF
          </a>
          <button
            onClick={() => router.push('/dashboard')}
            className="border border-gray-300 px-5 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            返回列表
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h2 className="font-semibold text-gray-800 mb-4">客戶資訊</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
              placeholder="搜尋客戶或直接輸入名稱"
            />
            {selectedCustomer && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">✓ 已從清單選取</span>
                <button type="button" onClick={clearCustomer} className="text-xs text-gray-400 hover:text-gray-600">
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
              <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-xl shadow-lg mt-1 max-h-64 overflow-y-auto">
                {customerResults.map((customer) => (
                  <button
                    key={customer.id}
                    type="button"
                    onMouseDown={() => selectCustomer(customer)}
                    className="w-full text-left px-4 py-2.5 hover:bg-green-50 text-sm border-b border-gray-50 last:border-0"
                  >
                    <div className="font-medium">{customer.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5 flex gap-2">
                      {customer.city && <span>{customer.city}</span>}
                      {customer.type && <span className="text-green-600">{customer.type}</span>}
                      {customer.phone && <span>{customer.phone}</span>}
                    </div>
                    {customer.address && <div className="text-xs text-gray-300 truncate">{customer.address}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">電話</label>
            <input
              type="text"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
              placeholder="輸入電話"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">統一編號</label>
            <input
              type="text"
              value={customerTaxId}
              onChange={(e) => setCustomerTaxId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
              placeholder="輸入統一編號"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">地址</label>
            <input
              type="text"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
              placeholder="輸入地址"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">業務姓名</label>
            <input
              type="text"
              value={salesperson}
              onChange={(e) => setSalesperson(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
              placeholder="輸入業務姓名"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">有效期限</label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">付款條件</label>
            <input
              type="text"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
              placeholder="如：貨到付款、月結30天"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">備註</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700 resize-none"
              placeholder="選填"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <h2 className="font-semibold text-gray-800">選擇產品</h2>
          <button
            type="button"
            onClick={addCustomItem}
            className="self-start md:self-auto border border-green-700 text-green-800 hover:bg-green-50 text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            + 新增客製化品項
          </button>
        </div>

        <div className="flex flex-wrap gap-3 mb-4">
          <input
            type="text"
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700 w-52"
            placeholder="搜尋品名、規格..."
          />
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
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
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
          >
            <option value="">全部品類</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>

        <div className="max-h-72 overflow-y-auto border border-gray-100 rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 text-xs text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">品名</th>
                <th className="px-3 py-2 text-left">品牌</th>
                <th className="px-3 py-2 text-left">規格</th>
                <th className="px-3 py-2 text-left">產品圖</th>
                <th className="px-3 py-2 text-right">定價</th>
                <th className="px-3 py-2 text-center">加入</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-400">
                    無符合的產品
                  </td>
                </tr>
              )}
              {filteredProducts.map((product) => (
                <tr key={product.id} className="hover:bg-green-50/50">
                  <td className="px-3 py-2">
                    <div className="font-medium">{product.name}</div>
                    {product.series && <div className="text-xs text-gray-400">{product.series}</div>}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{product.brand}</td>
                  <td className="px-3 py-2 text-gray-500">{product.spec || '—'}</td>
                  <td className="px-3 py-2">
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt={product.name} className="h-12 w-12 rounded-lg object-cover border border-gray-200" />
                    ) : (
                      <div className="h-12 w-12 rounded-lg border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-[10px] text-gray-400">
                        預留圖
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {product.price != null ? formatMoney(product.price) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => addProduct(product)}
                      className="bg-green-800 hover:bg-green-900 text-white text-xs px-3 py-1 rounded-lg transition"
                    >
                      + 加入
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div ref={detailSectionRef} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <h2 className="font-semibold text-gray-800 mb-4">報價明細 ({items.length} 項)</h2>
        {items.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">尚未新增任何品項</div>
        ) : (
          <div className="space-y-4">
            {items.map((item, index) => (
              <div
                key={item.tempId}
                ref={item.tempId === highlightedItemId ? latestAddedItemRef : null}
                className={`border rounded-2xl p-4 transition ${
                  item.tempId === highlightedItemId
                    ? 'border-green-500 bg-green-50/60 shadow-[0_0_0_3px_rgba(34,197,94,0.12)]'
                    : 'border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(item.tempId)}
                    className="flex-1 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-14 w-14 shrink-0 rounded-xl border border-dashed border-gray-300 bg-gray-50 overflow-hidden flex items-center justify-center">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.name || '產品圖片'} className="h-full w-full object-cover" />
                        ) : (
                          <div className="text-[10px] text-gray-400 text-center px-1">圖片預留</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs text-gray-400">品項 {index + 1}</div>
                        <div className="text-sm font-semibold text-gray-800 truncate">
                          {item.isCustom ? (item.name || '客製化品項') : item.name}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
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

                <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                  <div className="text-sm text-gray-500">
                    {item.brand || '未填品牌'}
                    {item.category ? ` · ${item.category}` : ''}
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-400">小計</div>
                    <div className="text-lg font-bold text-green-800">{formatMoney(item.subtotal)}</div>
                  </div>
                </div>

                {expandedItemIds.includes(item.tempId) && (
                  <div className="grid grid-cols-1 xl:grid-cols-[132px,1fr] gap-4 mt-4 pt-4 border-t border-gray-100">
                    <div>
                      <div className="h-32 w-full rounded-xl border border-dashed border-gray-300 bg-gray-50 overflow-hidden flex items-center justify-center">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.name || '產品圖片'} className="h-full w-full object-cover" />
                        ) : (
                          <div className="text-center text-xs text-gray-400 px-3">
                            <div className="font-medium mb-1">圖片預留位置</div>
                            <div>可由產品價目表自動帶入</div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          品名 <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => updateItem(item.tempId, 'name', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                          placeholder="輸入品名"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">規格</label>
                        <input
                          type="text"
                          value={item.spec}
                          onChange={(e) => updateItem(item.tempId, 'spec', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                          placeholder="可自由調整"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">品牌</label>
                        <input
                          type="text"
                          value={item.brand}
                          onChange={(e) => updateItem(item.tempId, 'brand', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                          placeholder="可自由輸入"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">品類</label>
                        <input
                          type="text"
                          value={item.category}
                          onChange={(e) => updateItem(item.tempId, 'category', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                          placeholder="可自由輸入"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">單位</label>
                        <input
                          type="text"
                          value={item.unit}
                          onChange={(e) => updateItem(item.tempId, 'unit', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                          placeholder="例：個、組、式"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">圖片網址</label>
                        <input
                          type="url"
                          value={item.imageUrl}
                          onChange={(e) => updateItem(item.tempId, 'imageUrl', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                          placeholder="可手動調整圖片來源"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">單價</label>
                        <input
                          type="number"
                          value={item.unitPrice}
                          min={0}
                          onChange={(e) => updateItem(item.tempId, 'unitPrice', Number(e.target.value))}
                          className="w-full text-right border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">數量</label>
                        <input
                          type="number"
                          value={item.quantity}
                          min={1}
                          onChange={(e) => updateItem(item.tempId, 'quantity', Number(e.target.value))}
                          className="w-full text-right border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">備註</label>
                        <input
                          type="text"
                          value={item.note}
                          onChange={(e) => updateItem(item.tempId, 'note', e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-700"
                          placeholder="選填"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            <div className="pt-4 border-t border-gray-100 flex justify-between items-center">
              <span className="text-gray-500 text-sm">合計</span>
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

      <div className="flex justify-end gap-3">
        <a href="/dashboard" className="border border-white/60 px-6 py-2.5 rounded-xl text-sm font-medium text-white hover:bg-white/10">
          取消
        </a>
        <button
          type="submit"
          disabled={submitting}
          className="bg-green-800 hover:bg-green-900 disabled:bg-green-300 text-white px-8 py-2.5 rounded-xl text-sm font-semibold transition"
        >
          {submitting ? '送出中...' : '送出報價單'}
        </button>
      </div>
    </form>
  )
}
