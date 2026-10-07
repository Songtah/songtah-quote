'use client'
/**
 * 報價單表單（建立／修改／複製共用）——2026-10-07 依紙本報價單與 UI/UX 檢視改版
 *
 * 版面：左側填寫（客戶 → 報價條件 → 品項），右側常駐「金額摘要＋版面設定＋動作」；手機改為底部固定列。
 * 每個欄位都可改：客戶資料帶入後仍可修改、品項的品名／規格／品牌／單位／單價／數量／備註／圖片皆可編輯，
 * 品項可上下移動、複製、刪除；報價單上要不要顯示圖片／規格／單位／品牌由「版面設定」決定。
 * 金額只在畫面上試算，存檔時伺服器依 lib/quote-model 重算。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Customer, Quote, QuoteItem } from '@/types'
import {
  computeQuoteTotals, amountInChinese, formatMoney, rocDate, todayTW, addDays, addMonths, lineAmount,
  parseLayout, DEFAULT_LAYOUT, PAYMENT_TERM_PRESETS, DELIVERY_PRESETS, TAX_RATE,
  type QuoteLayout, type TaxMode,
} from '@/lib/quote-model'
import { canEditQuote } from '@/lib/quote-status'

interface Props {
  /** create：新增（initial 有值＝複製既有報價單）；edit：修改 initial */
  mode?: 'create' | 'edit'
  initial?: Quote | null
  defaultSalesperson?: string
  onCreated?: (result: { shareUrl: string; id: string; quoteNumber: string }) => void
  onClose?: () => void
}

/** 產品資料庫選品結果（與訂貨頁共用 /api/products/search，價格已套用中央售價覆寫） */
type CatalogPick = {
  skuCode: string; name: string; manufacturer: string; productType: string; category: string
  price: number | null; salePrice: number | null; imageUrl: string
}
const effectivePrice = (p: CatalogPick) => p.salePrice ?? p.price ?? null

type DraftItem = QuoteItem & { tempId: string }
const tempId = () => Math.random().toString(36).slice(2)

const fromProduct = (p: CatalogPick): DraftItem => ({
  tempId: tempId(), productId: p.skuCode, name: p.name, brand: p.manufacturer, category: p.category,
  spec: p.productType, unit: '個', unitPrice: effectivePrice(p) ?? 0, quantity: 1, subtotal: 0,
  note: '', imageUrl: p.imageUrl || '', isCustom: false,
})
const blankItem = (): DraftItem => ({
  tempId: tempId(), productId: '', name: '', brand: '', category: '', spec: '', unit: '式',
  unitPrice: 0, quantity: 1, subtotal: 0, note: '', imageUrl: '', isCustom: true,
})

// ── 小元件 ─────────────────────────────────────────────────────────────────
function Field({ label, hint, required, children, className = '' }: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode; className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 flex items-baseline gap-1.5 text-xs font-medium text-stone-500">
        {label}{required && <span className="text-red-500">*</span>}
        {hint && <span className="font-normal text-stone-400">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Section({ step, title, desc, action, children }: {
  step: string; title: string; desc?: string; action?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <section className="card-soft rounded-3xl p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold tracking-widest text-stone-400">{step}</p>
          <h2 className="mt-0.5 text-base font-bold text-stone-800">{title}</h2>
          {desc && <p className="mt-0.5 text-xs text-stone-400">{desc}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-3 py-1.5 text-left">
      <span>
        <span className="block text-sm text-stone-700">{label}</span>
        {hint && <span className="block text-[11px] text-stone-400">{hint}</span>}
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-500' : 'bg-stone-200'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

// ── 主元件 ─────────────────────────────────────────────────────────────────
export default function QuoteForm({ mode = 'create', initial = null, defaultSalesperson = '', onCreated, onClose }: Props) {
  const router = useRouter()
  const isEdit = mode === 'edit' && !!initial
  const today = todayTW()

  // 客戶
  const [customerId, setCustomerId] = useState(initial?.customerId ?? '')
  const [customerName, setCustomerName] = useState(initial?.customerName ?? '')
  const [companyTitle, setCompanyTitle] = useState(initial?.companyTitle ?? '')
  const [contactPerson, setContactPerson] = useState(initial?.contactPerson ?? '')
  const [customerPhone, setCustomerPhone] = useState(initial?.customerPhone ?? '')
  const [customerTaxId, setCustomerTaxId] = useState(initial?.customerTaxId ?? '')
  const [customerAddress, setCustomerAddress] = useState(initial?.customerAddress ?? '')
  const [customerResults, setCustomerResults] = useState<Customer[]>([])
  const [showCustomerList, setShowCustomerList] = useState(false)
  const customerTimer = useRef<ReturnType<typeof setTimeout>>()

  // 報價條件（複製時日期重新起算）
  const [quoteDate, setQuoteDate] = useState(isEdit ? (initial?.quoteDate || today) : today)
  const [validUntil, setValidUntil] = useState(isEdit && initial?.validUntil ? initial.validUntil : addMonths(today, 1))
  const [salesperson, setSalesperson] = useState(initial?.salesperson || defaultSalesperson)
  const [paymentTerms, setPaymentTerms] = useState(initial?.paymentTerms ?? '貨到付款')
  const [deliveryTerms, setDeliveryTerms] = useState(initial?.deliveryTerms ?? '')
  const [taxMode, setTaxMode] = useState<TaxMode>((initial?.taxMode as TaxMode) || '含稅')
  const [discount, setDiscount] = useState<number>(initial?.discount ?? 0)
  const [note, setNote] = useState(initial?.note ?? '')
  const [layout, setLayout] = useState<QuoteLayout>(initial ? parseLayout(initial.layout) : { ...DEFAULT_LAYOUT })

  // 品項
  const [items, setItems] = useState<DraftItem[]>(() => (initial?.items ?? []).map((i) => ({ ...i, tempId: tempId() })))
  const [openDetail, setOpenDetail] = useState<string[]>([])
  const [flashId, setFlashId] = useState('')

  // 選品
  const [productQuery, setProductQuery] = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [brands, setBrands] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [products, setProducts] = useState<CatalogPick[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // 送出
  const [saving, setSaving] = useState<'' | 'draft' | 'submit' | 'save'>('')
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState('')
  const [touched, setTouched] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [result, setResult] = useState<Quote | null>(null)

  // 任何輸入都標記為未存檔，離開頁面時提醒
  const markDirty = () => { if (!dirty) setDirty(true) }
  useEffect(() => {
    if (!dirty || result) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty, result])

  // 客戶搜尋
  function onCustomerInput(v: string) {
    setCustomerName(v); setCustomerId(''); markDirty()
    clearTimeout(customerTimer.current)
    if (!v.trim()) { setCustomerResults([]); return }
    customerTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers?q=${encodeURIComponent(v.trim())}`)
        const data = await res.json()
        setCustomerResults(Array.isArray(data) ? data.slice(0, 12) : [])
        setShowCustomerList(true)
      } catch { setCustomerResults([]) }
    }, 300)
  }
  function pickCustomer(c: Customer) {
    setCustomerId(c.id); setCustomerName(c.name)
    // 帶入但不蓋掉已手動填寫的內容
    setCustomerPhone((v) => v || c.phone || '')
    setCustomerAddress((v) => v || c.address || '')
    setCustomerTaxId((v) => v || c.taxId || '')
    setCompanyTitle((v) => v || c.name)
    setShowCustomerList(false); markDirty()
  }

  // 產品選項＋搜尋（目錄 6,000+ 品項，伺服器端搜尋＋debounce）
  useEffect(() => {
    fetch('/api/products/options').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return
      setBrands(Array.isArray(d.brands) ? d.brands : [])
      setCategories(Array.isArray(d.categories) ? d.categories : [])
    }).catch(() => {})
  }, [])
  useEffect(() => {
    if (!pickerOpen) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setProductsLoading(true)
      const params = new URLSearchParams({ limit: '40' })
      if (productQuery.trim()) params.set('q', productQuery.trim())
      if (brandFilter) params.set('brand', brandFilter)
      if (categoryFilter) params.set('category', categoryFilter)
      fetch(`/api/products/search?${params}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setProducts(Array.isArray(d) ? d : []))
        .catch((e) => { if (e?.name !== 'AbortError') setProducts([]) })
        .finally(() => { if (!controller.signal.aborted) setProductsLoading(false) })
    }, 250)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [pickerOpen, productQuery, brandFilter, categoryFilter])

  // 品項操作
  function addItem(item: DraftItem) {
    setItems((prev) => [...prev, item]); setFlashId(item.tempId); markDirty()
    if (item.isCustom) setOpenDetail((prev) => [...prev, item.tempId])
    setTimeout(() => setFlashId(''), 1600)
  }
  function updateItem(id: string, patch: Partial<QuoteItem>) {
    setItems((prev) => prev.map((i) => (i.tempId === id ? { ...i, ...patch } : i))); markDirty()
  }
  function moveItem(id: string, dir: -1 | 1) {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.tempId === id)
      const to = idx + dir
      if (idx < 0 || to < 0 || to >= prev.length) return prev
      const next = [...prev]; [next[idx], next[to]] = [next[to], next[idx]]
      return next
    }); markDirty()
  }
  function duplicateItem(id: string) {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.tempId === id)
      if (idx < 0) return prev
      const copy = { ...prev[idx], tempId: tempId() }
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)]
    }); markDirty()
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.tempId !== id)); markDirty()
  }
  const toggleDetail = (id: string) =>
    setOpenDetail((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const totals = useMemo(() => computeQuoteTotals({ items, taxMode, discount }), [items, taxMode, discount])

  // 驗證（送出時才顯示，避免一開始滿畫面紅字）
  const problems = useMemo(() => {
    const p: string[] = []
    if (!customerName.trim()) p.push('請填寫客戶名稱')
    if (items.length === 0) p.push('請至少加入一個品項')
    items.forEach((i, n) => {
      if (!i.name.trim()) p.push(`第 ${n + 1} 項沒有品名`)
      if (!(Number(i.quantity) > 0)) p.push(`第 ${n + 1} 項數量需大於 0`)
    })
    if (validUntil && quoteDate && validUntil < quoteDate) p.push('有效期限不能早於報價日期')
    return p
  }, [customerName, items, validUntil, quoteDate])

  const payload = () => ({
    customerId, customerName, companyTitle, contactPerson, customerPhone, customerTaxId, customerAddress,
    salesperson, quoteDate, validUntil, paymentTerms, deliveryTerms, taxMode, discount, note, layout,
    items: items.map(({ tempId: _t, subtotal: _s, ...rest }) => rest),
  })

  async function save(kind: 'draft' | 'submit' | 'save') {
    setTouched(true); setError('')
    if (problems.length) { setError(problems[0]); return }
    setSaving(kind)
    try {
      const res = await fetch(isEdit ? `/api/quotes/${initial!.id}` : '/api/quotes', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload(), submit: kind === 'submit' ? true : kind === 'draft' ? false : undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || '儲存失敗，請再試一次'); return }
      setDirty(false)
      setResult(data as Quote)
      const id = String(data.id).replace(/-/g, '')
      onCreated?.({ shareUrl: `/share/${id}`, id, quoteNumber: data.quoteNumber })
    } catch (e: any) {
      setError(e?.message || '儲存失敗，請再試一次')
    } finally { setSaving('') }
  }

  async function previewPdf() {
    setTouched(true); setError('')
    if (problems.length) { setError(problems[0]); return }
    setPreviewing(true)
    // 先開視窗再填內容，避免被瀏覽器當成彈出式廣告擋掉
    const win = window.open('', '_blank')
    try {
      const res = await fetch('/api/quotes/preview-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload(), quoteNumber: isEdit ? initial!.quoteNumber : '' }),
      })
      if (!res.ok) { win?.close(); setError((await res.json().catch(() => ({}))).error || 'PDF 預覽失敗'); return }
      const url = URL.createObjectURL(await res.blob())
      if (win) win.location.href = url; else window.open(url, '_blank')
    } catch (e: any) { win?.close(); setError(e?.message || 'PDF 預覽失敗') }
    finally { setPreviewing(false) }
  }

  const close = () => (onClose ? onClose() : router.push('/quotes'))

  // ── 存檔完成 ───────────────────────────────────────────────────────────
  if (result) {
    const id = result.id.replace(/-/g, '')
    const approved = result.status === '已核准'
    return (
      <div className="card-soft mx-auto max-w-xl rounded-3xl p-7 text-center sm:p-10">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-2xl text-emerald-600">✓</div>
        <h2 className="text-xl font-bold text-stone-800">
          {result.status === '草稿' ? '已存成草稿' : isEdit ? '報價單已更新' : '報價單已送出審核'}
        </h2>
        <p className="mt-1 text-sm text-stone-500">
          {result.quoteNumber}　·　{result.customerName}　·　{formatMoney(result.total)}
        </p>
        <p className="mt-3 text-xs text-stone-400">
          {result.status === '草稿'
            ? '草稿只有內部看得到，確認後到報價清單按「編輯」再送出審核。'
            : approved ? '已核准，可以把分享連結或 PDF 交給客戶。' : '審核通過後，分享連結與正式 PDF 才會開放給客戶。'}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <a href={`/api/quotes/${id}/pdf`} target="_blank" rel="noreferrer" className="button-primary px-5 py-2.5">
            {approved ? '下載 PDF' : '預覽 PDF'}
          </a>
          {canEditQuote(result.status) && (
            <a href={`/quote/${id}/edit`} className="button-secondary px-5 py-2.5">繼續編輯</a>
          )}
          <button onClick={() => router.push('/quotes')} className="button-secondary px-5 py-2.5">返回報價清單</button>
        </div>
      </div>
    )
  }

  // ── 表單 ───────────────────────────────────────────────────────────────
  const showError = (cond: boolean) => (touched && cond ? 'ring-2 ring-red-300' : '')
  const status = isEdit ? initial!.status : ''
  const submitLabel = !isEdit ? '送出審核' : status === '待行政審核' ? '儲存修改' : '儲存並送出審核'
  const showDraftButton = !isEdit || status === '草稿' || status === '已退回'

  return (
    <div className="grid gap-5 pb-44 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:pb-0">
      <div className="min-w-0 space-y-5">
        {isEdit && initial?.status === '已退回' && initial.approvalNote && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="font-semibold">退回意見：</span>{initial.approvalNote}
          </div>
        )}

        {/* 1. 客戶 */}
        <Section step="STEP 1" title="客戶資訊" desc="搜尋客戶主檔會自動帶入電話、地址、統編；帶入後仍可修改。">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="relative sm:col-span-2">
              <Field label="客戶名稱" required>
                <input
                  value={customerName}
                  onChange={(e) => onCustomerInput(e.target.value)}
                  onFocus={() => customerResults.length && setShowCustomerList(true)}
                  onBlur={() => setTimeout(() => setShowCustomerList(false), 150)}
                  className={`input-soft py-3 ${showError(!customerName.trim())}`}
                  placeholder="輸入名稱搜尋客戶主檔，或直接填寫"
                  autoComplete="off"
                />
              </Field>
              <div className="mt-1.5 h-5 text-xs">
                {customerId ? (
                  <span className="inline-flex items-center gap-2 text-emerald-700">
                    ✓ 已連結客戶主檔
                    <button type="button" onClick={() => { setCustomerId(''); markDirty() }} className="text-stone-400 underline hover:text-stone-600">取消連結</button>
                  </span>
                ) : customerName ? <span className="text-stone-400">未連結客戶主檔（報價仍可建立，但不會推進客戶的開發階段）</span> : null}
              </div>
              {showCustomerList && customerResults.length > 0 && (
                <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-2xl bg-white shadow-xl ring-1 ring-stone-900/[0.08]">
                  {customerResults.map((c) => (
                    <button key={c.id} type="button" onMouseDown={() => pickCustomer(c)}
                      className="block w-full border-b border-stone-50 px-4 py-2.5 text-left last:border-0 hover:bg-brand-50">
                      <span className="block text-sm font-medium text-stone-800">{c.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-stone-400">
                        {[c.city, c.type, c.phone, c.address].filter(Boolean).join('　·　')}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Field label="公司抬頭" hint="開立發票用">
              <input value={companyTitle} onChange={(e) => { setCompanyTitle(e.target.value); markDirty() }} className="input-soft py-3" placeholder="同客戶名稱可留空" />
            </Field>
            <Field label="統一編號">
              <input value={customerTaxId} onChange={(e) => { setCustomerTaxId(e.target.value); markDirty() }} className="input-soft py-3" inputMode="numeric" maxLength={8} placeholder="8 碼" />
            </Field>
            <Field label="聯絡人">
              <input value={contactPerson} onChange={(e) => { setContactPerson(e.target.value); markDirty() }} className="input-soft py-3" placeholder="例：陳技師" />
            </Field>
            <Field label="電話">
              <input value={customerPhone} onChange={(e) => { setCustomerPhone(e.target.value); markDirty() }} className="input-soft py-3" inputMode="tel" placeholder="例：02-8221-3088 #224" />
            </Field>
            <Field label="地址" className="sm:col-span-2">
              <input value={customerAddress} onChange={(e) => { setCustomerAddress(e.target.value); markDirty() }} className="input-soft py-3" />
            </Field>
          </div>
        </Section>

        {/* 2. 報價條件 */}
        <Section step="STEP 2" title="報價條件" desc="會印在報價單的「報價資訊」與「說明」區。">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="報價日期" hint={rocDate(quoteDate)}>
              <input type="date" value={quoteDate} onChange={(e) => { setQuoteDate(e.target.value); markDirty() }} className="input-soft py-3" />
            </Field>
            <Field label="有效期限" hint={rocDate(validUntil)}>
              <input type="date" value={validUntil} min={quoteDate} onChange={(e) => { setValidUntil(e.target.value); markDirty() }}
                className={`input-soft py-3 ${showError(!!validUntil && validUntil < quoteDate)}`} />
              <span className="mt-1.5 flex flex-wrap gap-1.5">
                {([['14 天', addDays(quoteDate, 14)], ['1 個月', addMonths(quoteDate, 1)], ['2 個月', addMonths(quoteDate, 2)], ['3 個月', addMonths(quoteDate, 3)]] as const).map(([l, v]) => (
                  <button key={l} type="button" onClick={() => { setValidUntil(v); markDirty() }}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] transition-all active:scale-95 ${validUntil === v ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'}`}>{l}</button>
                ))}
              </span>
            </Field>
            <Field label="業務承辦">
              <input value={salesperson} onChange={(e) => { setSalesperson(e.target.value); markDirty() }} className="input-soft py-3" />
            </Field>
            <Field label="稅別">
              <div className="flex rounded-xl bg-stone-100/80 p-1">
                {(['含稅', '未稅'] as TaxMode[]).map((t) => (
                  <button key={t} type="button" onClick={() => { setTaxMode(t); markDirty() }}
                    className={`flex-1 rounded-lg py-2 text-sm font-medium transition-all active:scale-95 ${taxMode === t ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}>
                    {t === '含稅' ? '含稅（稅金內含）' : `未稅（另計 ${Math.round(TAX_RATE * 100)}%）`}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="付款條件">
              <input list="payment-presets" value={paymentTerms} onChange={(e) => { setPaymentTerms(e.target.value); markDirty() }} className="input-soft py-3" placeholder="可選常用或自行輸入" />
              <datalist id="payment-presets">{PAYMENT_TERM_PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
            <Field label="交貨條件">
              <input list="delivery-presets" value={deliveryTerms} onChange={(e) => { setDeliveryTerms(e.target.value); markDirty() }} className="input-soft py-3" placeholder="可選常用或自行輸入" />
              <datalist id="delivery-presets">{DELIVERY_PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
            <Field label="備註／附加條款" hint="每行一條，列在報價單「說明」區" className="sm:col-span-2">
              <textarea value={note} onChange={(e) => { setNote(e.target.value); markDirty() }} rows={3}
                className="input-soft resize-y py-3" placeholder={'例：本報價含教育訓練 2 小時\n安裝場地需備 110V 專用迴路'} />
              <span className="mt-1 block text-[11px] text-stone-400">稅金說明與有效期限會自動列出，不用重複寫。</span>
            </Field>
          </div>
        </Section>

        {/* 3. 品項 */}
        <Section step="STEP 3" title={`報價品項${items.length ? `（${items.length} 項）` : ''}`}
          desc="從產品資料庫加入，或新增自訂品項；所有欄位都能直接修改。"
          action={
            <button type="button" onClick={() => addItem(blankItem())} className="button-secondary px-4 py-2">＋ 自訂品項</button>
          }>
          {/* 選品 */}
          <div className="rounded-2xl bg-stone-50 p-3">
            <div className="flex flex-wrap gap-2">
              <input value={productQuery} onChange={(e) => { setProductQuery(e.target.value); setPickerOpen(true) }}
                onFocus={() => setPickerOpen(true)}
                className="input-soft min-w-[200px] flex-1 bg-white" placeholder="🔍 搜尋產品資料庫：品名、貨號…" />
              <select value={brandFilter} onChange={(e) => { setBrandFilter(e.target.value); setPickerOpen(true) }} className="select-soft bg-white">
                <option value="">全部品牌</option>{brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPickerOpen(true) }} className="select-soft bg-white">
                <option value="">全部品類</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {pickerOpen && (
                <button type="button" onClick={() => setPickerOpen(false)} className="rounded-full px-3 text-xs text-stone-400 hover:text-stone-600">收起</button>
              )}
            </div>
            {pickerOpen && (
              <div className="mt-2 max-h-80 overflow-y-auto rounded-xl bg-white ring-1 ring-stone-900/[0.06]">
                {productsLoading ? (
                  <p className="py-8 text-center text-sm text-stone-400">搜尋中…</p>
                ) : products.length === 0 ? (
                  <p className="py-8 text-center text-sm text-stone-400">
                    {productQuery || brandFilter || categoryFilter ? '產品資料庫沒有符合的品項，可改用「自訂品項」' : '輸入關鍵字或選擇品牌／品類'}
                  </p>
                ) : products.map((p) => {
                  const price = effectivePrice(p)
                  const count = items.filter((i) => i.productId && i.productId === p.skuCode).length
                  return (
                    <div key={p.skuCode} className="flex items-center gap-3 border-b border-stone-50 px-3 py-2 last:border-0 hover:bg-brand-50/40">
                      {p.imageUrl
                        ? <img src={p.imageUrl} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain ring-1 ring-stone-900/[0.06]" />
                        : <div className="h-10 w-10 shrink-0 rounded-lg bg-stone-100" />}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-stone-800">{p.name}</p>
                        <p className="truncate text-[11px] text-stone-400">{[p.skuCode, p.manufacturer, p.productType].filter(Boolean).join('　·　')}</p>
                      </div>
                      <span className="shrink-0 text-sm tabular-nums text-stone-600">{price != null ? formatMoney(price) : <span className="text-stone-400">待定價</span>}</span>
                      <button type="button" onClick={() => addItem(fromProduct(p))}
                        className="shrink-0 rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-brand-500/20 transition-all hover:bg-brand-600 active:scale-95">
                        {count ? `再加一筆（已加 ${count}）` : '＋ 加入'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 品項明細 */}
          {items.length === 0 ? (
            <div className={`mt-4 rounded-2xl border border-dashed px-4 py-10 text-center text-sm ${touched ? 'border-red-300 text-red-500' : 'border-stone-200 text-stone-400'}`}>
              還沒有品項——從上方搜尋產品加入，或按「＋ 自訂品項」。
            </div>
          ) : (
            <div className="mt-4">
              <div className="hidden grid-cols-[28px_minmax(0,1fr)_76px_64px_112px_104px_72px] gap-2 px-2 pb-2 text-[11px] font-medium text-stone-400 xl:grid">
                <span>#</span><span>品名</span><span className="text-right">數量</span><span>單位</span>
                <span className="text-right">單價</span><span className="text-right">金額</span><span />
              </div>
              <ul className="space-y-2">
                {items.map((item, idx) => {
                  const detail = openDetail.includes(item.tempId)
                  const amount = lineAmount(item.unitPrice, item.quantity)
                  return (
                    <li key={item.tempId}
                      className={`rounded-2xl bg-white p-2 ring-1 transition-all ${flashId === item.tempId ? 'ring-2 ring-brand-300' : 'ring-stone-900/[0.06]'}`}>
                      <div className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2 xl:grid-cols-[28px_minmax(0,1fr)_64px_56px_96px_92px_80px] xl:items-center">
                        <span className="pt-2.5 text-center text-xs tabular-nums text-stone-400 xl:pt-0">{idx + 1}</span>
                        <div className="min-w-0">
                          <input value={item.name} onChange={(e) => updateItem(item.tempId, { name: e.target.value })}
                            className={`input-soft py-2 ${showError(!item.name.trim())}`} placeholder="品名（必填）" />
                          {!detail && (item.brand || item.spec || item.note) && (
                            <button type="button" onClick={() => toggleDetail(item.tempId)} className="mt-1 block max-w-full truncate px-1 text-left text-[11px] text-stone-400 hover:text-stone-600">
                              {[item.brand, item.spec, item.note && `備註：${item.note}`].filter(Boolean).join('　·　')}
                            </button>
                          )}
                        </div>
                        {/* 手機：數量／單位／單價／金額第二列 */}
                        <div className="col-span-2 grid grid-cols-[1fr_64px_1fr] gap-2 xl:contents">
                          <label className="xl:contents">
                            <span className="mb-1 block text-[11px] text-stone-400 xl:hidden">數量</span>
                            <input type="number" min={0} step="any" value={item.quantity}
                              onChange={(e) => updateItem(item.tempId, { quantity: Number(e.target.value) })}
                              className={`input-soft py-2 text-right tabular-nums ${showError(!(Number(item.quantity) > 0))}`} />
                          </label>
                          <label className="xl:contents">
                            <span className="mb-1 block text-[11px] text-stone-400 xl:hidden">單位</span>
                            <input value={item.unit} onChange={(e) => updateItem(item.tempId, { unit: e.target.value })}
                              className="input-soft px-2 py-2 text-center" placeholder="個" />
                          </label>
                          <label className="xl:contents">
                            <span className="mb-1 block text-[11px] text-stone-400 xl:hidden">單價</span>
                            <input type="number" min={0} step="any" value={item.unitPrice}
                              onChange={(e) => updateItem(item.tempId, { unitPrice: Number(e.target.value) })}
                              className="input-soft py-2 text-right tabular-nums" />
                          </label>
                        </div>
                        <div className="col-span-2 flex items-center justify-between gap-2 xl:col-span-1 xl:contents">
                          <span className="text-sm font-semibold tabular-nums text-stone-800 xl:text-right">
                            <span className="mr-1 text-[11px] font-normal text-stone-400 xl:hidden">金額</span>{amount.toLocaleString('zh-TW')}
                          </span>
                          <div className="flex items-center justify-end gap-0.5">
                            <button type="button" onClick={() => toggleDetail(item.tempId)} title="品牌、規格、備註、圖片"
                              className={`whitespace-nowrap rounded-full px-2 py-1 text-xs transition-all active:scale-95 ${detail ? 'bg-brand-50 text-brand-700' : 'text-stone-400 hover:bg-stone-100'}`}>詳細</button>
                            <details className="relative">
                              <summary className="list-none cursor-pointer rounded-full px-2 py-1 text-stone-400 hover:bg-stone-100" title="更多">⋯</summary>
                              <div onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}
                                className="absolute right-0 z-10 mt-1 w-32 overflow-hidden rounded-xl bg-white py-1 text-sm shadow-xl ring-1 ring-stone-900/[0.08]">
                                <button type="button" disabled={idx === 0} onClick={() => moveItem(item.tempId, -1)} className="block w-full px-3 py-1.5 text-left text-stone-600 hover:bg-stone-50 disabled:opacity-30">上移</button>
                                <button type="button" disabled={idx === items.length - 1} onClick={() => moveItem(item.tempId, 1)} className="block w-full px-3 py-1.5 text-left text-stone-600 hover:bg-stone-50 disabled:opacity-30">下移</button>
                                <button type="button" onClick={() => duplicateItem(item.tempId)} className="block w-full px-3 py-1.5 text-left text-stone-600 hover:bg-stone-50">複製</button>
                                <button type="button" onClick={() => removeItem(item.tempId)} className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50">刪除</button>
                              </div>
                            </details>
                          </div>
                        </div>
                      </div>

                      {detail && (
                        <div className="mt-2 grid grid-cols-1 gap-3 rounded-xl bg-stone-50 p-3 sm:grid-cols-2 xl:ml-[36px]">
                          <Field label="品牌"><input value={item.brand} onChange={(e) => updateItem(item.tempId, { brand: e.target.value })} className="input-soft bg-white py-2" /></Field>
                          <Field label="規格"><input value={item.spec} onChange={(e) => updateItem(item.tempId, { spec: e.target.value })} className="input-soft bg-white py-2" placeholder="例：98×14 mm" /></Field>
                          <Field label="品項備註" hint="印在品名下方" className="sm:col-span-2">
                            <input value={item.note} onChange={(e) => updateItem(item.tempId, { note: e.target.value })} className="input-soft bg-white py-2" placeholder="例：限量促銷品項" />
                          </Field>
                          <Field label="圖片網址" hint={layout.showImage ? '' : '版面設定開啟「顯示圖片」才會印出'} className="sm:col-span-2">
                            <div className="flex items-center gap-2">
                              {item.imageUrl
                                ? <img src={item.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain ring-1 ring-stone-900/[0.06]" />
                                : <div className="h-10 w-10 shrink-0 rounded-lg bg-white ring-1 ring-stone-900/[0.06]" />}
                              <input value={item.imageUrl} onChange={(e) => updateItem(item.tempId, { imageUrl: e.target.value })} className="input-soft bg-white py-2" placeholder="https://…" />
                            </div>
                          </Field>
                          {item.productId && <p className="text-[11px] text-stone-400 sm:col-span-2">貨號 {item.productId}（單價為加入當下的售價，之後目錄調價不會改動這張報價單）</p>}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </Section>
      </div>

      {/* 右側摘要（桌機常駐）／手機底部列 */}
      <aside className="space-y-4 lg:sticky lg:top-4">
        <div className="card-soft rounded-3xl p-5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs text-stone-400">報價單號</p>
            {isEdit && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500">{status}</span>}
          </div>
          <p className="mt-0.5 font-mono text-sm text-stone-700">{isEdit ? initial!.quoteNumber : '存檔後自動產生'}</p>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-stone-500">小計</dt><dd className="tabular-nums text-stone-700">{formatMoney(totals.subtotal)}</dd></div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-stone-500">折讓</dt>
              <dd className="flex items-center gap-1">
                <span className="text-stone-400">−</span>
                <input type="number" min={0} value={discount || ''} placeholder="0"
                  onChange={(e) => { setDiscount(Math.max(0, Number(e.target.value) || 0)); markDirty() }}
                  className="input-soft w-28 px-2 py-1 text-right tabular-nums" />
              </dd>
            </div>
            {taxMode === '未稅' && (
              <div className="flex justify-between"><dt className="text-stone-500">營業稅 {Math.round(TAX_RATE * 100)}%</dt><dd className="tabular-nums text-stone-700">{formatMoney(totals.tax)}</dd></div>
            )}
            <div className="flex items-end justify-between border-t border-stone-100 pt-3">
              <dt className="text-stone-600">總計{taxMode === '含稅' ? '（含稅）' : ''}</dt>
              <dd className="text-2xl font-bold tabular-nums text-brand-700">{formatMoney(totals.total)}</dd>
            </div>
            <p className="text-right text-[11px] text-stone-400">{amountInChinese(totals.total)}</p>
          </dl>
        </div>

        <div className="card-soft rounded-3xl p-5">
          <p className="mb-1 text-xs font-semibold text-stone-500">報價單版面</p>
          <Toggle checked={layout.showSpec} onChange={(v) => { setLayout({ ...layout, showSpec: v }); markDirty() }} label="規格欄" hint="關閉時規格改列在品名下方" />
          <Toggle checked={layout.showUnit} onChange={(v) => { setLayout({ ...layout, showUnit: v }); markDirty() }} label="單位欄" />
          <Toggle checked={layout.showBrand} onChange={(v) => { setLayout({ ...layout, showBrand: v }); markDirty() }} label="品牌" hint="列在品名下方" />
          <Toggle checked={layout.showImage} onChange={(v) => { setLayout({ ...layout, showImage: v }); markDirty() }} label="品項圖片" hint="只有帶圖的品項會顯示" />
        </div>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {/* 動作：桌機在側欄，手機固定在底部 */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-900/[0.06] bg-[#fdfdfb]/95 px-4 py-3 shadow-[0_-4px_24px_rgba(28,25,23,0.06)] backdrop-blur-xl lg:static lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
          <div className="mb-2 flex items-baseline justify-between lg:hidden">
            <span className="text-xs text-stone-500">總計{taxMode === '含稅' ? '（含稅）' : ''}</span>
            <span className="text-lg font-bold tabular-nums text-brand-700">{formatMoney(totals.total)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-col">
            <button type="button" onClick={() => save(isEdit ? (status === '待行政審核' ? 'save' : 'submit') : 'submit')} disabled={!!saving}
              className="button-primary col-span-2 py-3 lg:w-full">
              {saving === 'submit' || saving === 'save' ? '儲存中…' : submitLabel}
            </button>
            {showDraftButton && (
              <button type="button" onClick={() => save(isEdit ? 'save' : 'draft')} disabled={!!saving}
                className="button-secondary py-3 lg:w-full">
                {saving === 'draft' || (saving === 'save' && status !== '待行政審核') ? '儲存中…' : isEdit ? '只儲存不送出' : '存成草稿'}
              </button>
            )}
            <button type="button" onClick={previewPdf} disabled={previewing} className={`button-secondary py-3 lg:w-full ${showDraftButton ? '' : 'col-span-2'}`}>
              {previewing ? '產生中…' : '預覽 PDF'}
            </button>
            <button type="button" onClick={close} className="hidden py-2 text-sm text-stone-400 hover:text-stone-600 lg:block lg:w-full">取消</button>
          </div>
        </div>
      </aside>
    </div>
  )
}
