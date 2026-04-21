'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import type { CreateTicketPayload, Equipment } from '@/types'

type SystemCustomer = { id: string; name: string; city: string; type: string }

const TICKET_TYPES = ['技術支援', '維修', 'RMA', '換貨', '客訴', '安裝', '教育訓練']
const PRIORITIES = ['P1', 'P2', 'P3', 'P4']
const SUPPORT_OWNERS = ['小黃', 'Paul', 'Aaron', 'Ted', 'Luca', 'Brain', '致廷']
const SALES_OWNERS = ['公司直營', 'Duncan', 'Gus', 'Hank', 'James', 'Eason', 'Amy', '小郭', 'Paul', 'Chloe']

const EMPTY_FORM: CreateTicketPayload = {
  customerName: '',
  title: '',
  ticketType: '技術支援',
  priority: 'P2',
  status: '尚未處理',
  contactName: '',
  supportOwner: 'Paul',
  salesOwner: '公司直營',
  description: '',
  cause: '',
  solution: '',
  keyPart: '',
  note: '',
}

const inputCls = 'w-full border border-brand-200 rounded-xl px-3 py-2 text-sm bg-cream-50 focus:outline-none focus:ring-2 focus:ring-gold-400 focus:border-gold-400 transition'

export default function NewTicketModal() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<CreateTicketPayload>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Equipment search
  const debounceRef = useRef<NodeJS.Timeout>()
  const [equipmentQuery, setEquipmentQuery] = useState('')
  const [equipmentResults, setEquipmentResults] = useState<Equipment[]>([])
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null)
  const [showEquipmentList, setShowEquipmentList] = useState(false)
  const [equipmentLoading, setEquipmentLoading] = useState(false)

  // Customer search
  const customerDebounceRef = useRef<NodeJS.Timeout>()
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<SystemCustomer[]>([])
  const [showCustomerList, setShowCustomerList] = useState(false)
  const [customerLoading, setCustomerLoading] = useState(false)

  // Lock body scroll when open
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Equipment search effect
  useEffect(() => {
    if (equipmentQuery.trim().length < 1) {
      setEquipmentResults([])
      setEquipmentLoading(false)
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setEquipmentLoading(true)
      try {
        const res = await fetch(`/api/equipment?q=${encodeURIComponent(equipmentQuery)}`)
        const data = await res.json()
        setEquipmentResults(Array.isArray(data) ? data : [])
        setShowEquipmentList(true)
      } catch { setEquipmentResults([]) }
      finally { setEquipmentLoading(false) }
    }, 250)
    return () => clearTimeout(debounceRef.current)
  }, [equipmentQuery])

  // Customer search effect
  useEffect(() => {
    if (customerQuery.trim().length < 1) {
      setCustomerResults([])
      return
    }
    clearTimeout(customerDebounceRef.current)
    customerDebounceRef.current = setTimeout(async () => {
      setCustomerLoading(true)
      try {
        const res = await fetch(`/api/system-customers?q=${encodeURIComponent(customerQuery)}`)
        const data = await res.json()
        setCustomerResults(Array.isArray(data) ? data : [])
        setShowCustomerList(true)
      } catch { setCustomerResults([]) }
      finally { setCustomerLoading(false) }
    }, 250)
    return () => clearTimeout(customerDebounceRef.current)
  }, [customerQuery])

  function updateField<K extends keyof CreateTicketPayload>(key: K, value: CreateTicketPayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function selectEquipment(item: Equipment) {
    setSelectedEquipment(item)
    setEquipmentQuery(item.customerName)
    setShowEquipmentList(false)
    setForm((prev) => ({
      ...prev,
      customerName: item.customerName,
      customerId: item.originalCustomerId || prev.customerId,
      equipmentId: item.id,
      productId: item.originalProductId || prev.productId,
      manufacturer: item.manufacturer,
    }))
  }

  function selectCustomer(item: SystemCustomer) {
    setCustomerQuery(item.name)
    setShowCustomerList(false)
    setForm((prev) => ({ ...prev, customerName: item.name, customerId: item.id }))
  }

  function handleClose() {
    setOpen(false)
    setForm(EMPTY_FORM)
    setEquipmentQuery('')
    setCustomerQuery('')
    setSelectedEquipment(null)
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    const res = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) {
      setError(data.error || '建立工單失敗')
      return
    }
    handleClose()
    router.refresh()
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="button-primary">
        ＋ 新建工單
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 z-40 bg-stone-900/50 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleClose}
            />

            {/* Modal */}
            <motion.div
              className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 overflow-y-auto"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="relative w-full max-w-2xl"
                initial={{ opacity: 0, y: 32, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.98 }}
                transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-brand-200/50 bg-white rounded-t-2xl">
                  <div>
                    <p className="eyebrow text-[10px]">RMA 技術支援</p>
                    <h2 className="text-lg font-bold text-stone-800">新建工單</h2>
                  </div>
                  <button
                    onClick={handleClose}
                    className="text-stone-400 hover:text-stone-600 text-xl leading-none transition"
                    aria-label="關閉"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="bg-white rounded-b-2xl shadow-[0_24px_60px_-16px_rgba(90,66,51,0.2)]">
                  <div className="px-6 py-5 space-y-5 max-h-[75vh] overflow-y-auto">

                    {/* 設備搜尋 */}
                    <div>
                      <label className="block text-sm font-medium text-stone-600 mb-1">客戶設備搜尋</label>
                      <input
                        value={equipmentQuery}
                        onChange={(e) => setEquipmentQuery(e.target.value)}
                        placeholder="輸入客戶名稱、序號、Support ID 或 TeamViewer ID"
                        className={inputCls}
                      />
                      {equipmentLoading && <p className="mt-1 text-xs text-stone-400">搜尋中...</p>}
                      {showEquipmentList && equipmentResults.length > 0 && (
                        <div className="mt-1 border border-brand-200 rounded-xl bg-white shadow-lg max-h-48 overflow-y-auto">
                          {equipmentResults.map((item) => (
                            <button key={item.id} type="button" onClick={() => selectEquipment(item)}
                              className="w-full text-left px-4 py-2.5 hover:bg-brand-50 text-sm border-b border-brand-100/40 last:border-0">
                              <div className="font-medium text-stone-800">{item.customerName}</div>
                              <div className="text-xs text-stone-400 mt-0.5">
                                {[item.manufacturer, item.serialNumber && `序號 ${item.serialNumber}`, item.supportId && `Support ${item.supportId}`].filter(Boolean).join('・')}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {selectedEquipment && (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-xs text-brand-600 bg-brand-50 px-2 py-1 rounded-full">
                            ✓ {[selectedEquipment.customerName, selectedEquipment.manufacturer, selectedEquipment.serialNumber && `序號 ${selectedEquipment.serialNumber}`].filter(Boolean).join('・')}
                          </span>
                          <button type="button" onClick={() => { setSelectedEquipment(null); setEquipmentQuery(''); setEquipmentResults([]) }}
                            className="text-xs text-stone-400 hover:text-stone-600">清除</button>
                        </div>
                      )}
                    </div>

                    {/* 客戶 + 聯絡人 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="relative">
                        <label className="block text-sm font-medium text-stone-600 mb-1">客戶名稱 <span className="text-rose-500">*</span></label>
                        <input
                          value={customerQuery || form.customerName}
                          onChange={(e) => { setCustomerQuery(e.target.value); updateField('customerName', e.target.value) }}
                          onFocus={() => { if (customerResults.length > 0) setShowCustomerList(true) }}
                          onBlur={() => setTimeout(() => setShowCustomerList(false), 150)}
                          className={inputCls} placeholder="搜尋客戶" autoComplete="off" required />
                        {customerLoading && <span className="absolute right-3 top-[34px] text-xs text-stone-400">搜尋中...</span>}
                        {showCustomerList && customerResults.length > 0 && (
                          <div className="absolute z-10 w-full mt-1 border border-brand-200 rounded-xl bg-white shadow-lg max-h-52 overflow-y-auto">
                            {customerResults.map((item) => (
                              <button key={item.id} type="button" onMouseDown={() => selectCustomer(item)}
                                className="w-full text-left px-4 py-2.5 hover:bg-brand-50 text-sm border-b border-brand-100/40 last:border-0">
                                <div className="font-medium">{item.name}</div>
                                {(item.city || item.type) && (
                                  <div className="text-xs text-stone-400 mt-0.5">{item.city}{item.city && item.type && ' · '}{item.type}</div>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">聯絡人 <span className="text-rose-500">*</span></label>
                        <input value={form.contactName} onChange={(e) => updateField('contactName', e.target.value)}
                          className={inputCls} placeholder="現場或回報窗口" required />
                      </div>
                    </div>

                    {/* 標題 + 類型 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">案件標題 <span className="text-rose-500">*</span></label>
                        <input value={form.title} onChange={(e) => updateField('title', e.target.value)}
                          className={inputCls} placeholder="例：FC-30 無法啟動" required />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">案件類型</label>
                        <select value={form.ticketType} onChange={(e) => updateField('ticketType', e.target.value)} className={inputCls}>
                          {TICKET_TYPES.map((v) => <option key={v}>{v}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* 優先級 + 日期 + 負責人 */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">優先級</label>
                        <select value={form.priority} onChange={(e) => updateField('priority', e.target.value)} className={inputCls}>
                          {PRIORITIES.map((v) => <option key={v}>{v}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">預計日期</label>
                        <input type="date" value={form.scheduledDate ?? ''} onChange={(e) => updateField('scheduledDate', e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">技術支援</label>
                        <select value={form.supportOwner} onChange={(e) => updateField('supportOwner', e.target.value)} className={inputCls}>
                          {SUPPORT_OWNERS.map((v) => <option key={v}>{v}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">業務窗口</label>
                        <select value={form.salesOwner} onChange={(e) => updateField('salesOwner', e.target.value)} className={inputCls}>
                          {SALES_OWNERS.map((v) => <option key={v}>{v}</option>)}
                        </select>
                      </div>
                    </div>

                    {/* 問題描述 */}
                    <div>
                      <label className="block text-sm font-medium text-stone-600 mb-1">問題描述 <span className="text-rose-500">*</span></label>
                      <textarea value={form.description} onChange={(e) => updateField('description', e.target.value)}
                        className={`${inputCls} min-h-24 resize-y`} placeholder="請描述問題情境、錯誤訊息與目前狀況" required />
                    </div>

                    {/* 原因 + 解法 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">原因判斷</label>
                        <textarea value={form.cause ?? ''} onChange={(e) => updateField('cause', e.target.value)}
                          className={`${inputCls} min-h-20 resize-y`} placeholder="先行判斷可能原因" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">暫定解法</label>
                        <textarea value={form.solution ?? ''} onChange={(e) => updateField('solution', e.target.value)}
                          className={`${inputCls} min-h-20 resize-y`} placeholder="若已有暫定處理方式" />
                      </div>
                    </div>

                    {/* 關鍵料件 + 備註 */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">關鍵料件</label>
                        <input value={form.keyPart ?? ''} onChange={(e) => updateField('keyPart', e.target.value)}
                          className={inputCls} placeholder="需要的零件或耗材" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-600 mb-1">備註</label>
                        <input value={form.note ?? ''} onChange={(e) => updateField('note', e.target.value)}
                          className={inputCls} placeholder="其他補充資訊" />
                      </div>
                    </div>

                    {error && <p className="text-sm text-rose-500 rounded-xl bg-rose-50 border border-rose-200 px-4 py-2">{error}</p>}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-brand-100 bg-cream-50/60 rounded-b-2xl">
                    <button type="button" onClick={handleClose} className="button-secondary">取消</button>
                    <button type="submit" disabled={submitting} className="button-primary">
                      {submitting ? '建立中...' : '建立工單'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
