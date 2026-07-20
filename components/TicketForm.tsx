'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CreateTicketPayload, Equipment } from '@/types'
import {
  TICKET_PRIORITIES as PRIORITIES,
  TICKET_SALES_OWNERS as SALES_OWNERS,
  TICKET_SUPPORT_OWNERS as SUPPORT_OWNERS,
  TICKET_TYPES,
} from '@/lib/ticket-validation'

type SystemCustomer = { id: string; name: string; city: string; type: string }

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

export default function TicketForm() {
  const router = useRouter()
  const debounceRef = useRef<NodeJS.Timeout>()

  const [form, setForm] = useState<CreateTicketPayload>(EMPTY_FORM)
  const [equipmentQuery, setEquipmentQuery] = useState('')
  const [equipmentResults, setEquipmentResults] = useState<Equipment[]>([])
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null)
  const [showEquipmentList, setShowEquipmentList] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [equipmentLoading, setEquipmentLoading] = useState(false)
  const [equipmentError, setEquipmentError] = useState('')

  const customerDebounceRef = useRef<NodeJS.Timeout>()
  const [customerQuery, setCustomerQuery] = useState('')
  const [customerResults, setCustomerResults] = useState<SystemCustomer[]>([])
  const [showCustomerList, setShowCustomerList] = useState(false)
  const [customerLoading, setCustomerLoading] = useState(false)

  useEffect(() => {
    if (equipmentQuery.trim().length < 1) {
      setEquipmentResults([])
      setEquipmentError('')
      setEquipmentLoading(false)
      return
    }

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setEquipmentLoading(true)
      setEquipmentError('')

      try {
        const response = await fetch(`/api/equipment?q=${encodeURIComponent(equipmentQuery)}`)
        const data = await response.json()

        if (!response.ok) {
          setEquipmentResults([])
          setEquipmentError(data.error || '目前無法查詢客戶設備')
          return
        }

        setEquipmentResults(Array.isArray(data) ? data : [])
        setShowEquipmentList(true)
      } catch (fetchError) {
        console.error('equipment search error:', fetchError)
        setEquipmentResults([])
        setEquipmentError('設備搜尋暫時失敗，請稍後再試')
      } finally {
        setEquipmentLoading(false)
      }
    }, 250)

    return () => clearTimeout(debounceRef.current)
  }, [equipmentQuery])

  useEffect(() => {
    if (customerQuery.trim().length < 1) {
      setCustomerResults([])
      setCustomerLoading(false)
      return
    }

    clearTimeout(customerDebounceRef.current)
    customerDebounceRef.current = setTimeout(async () => {
      setCustomerLoading(true)
      try {
        const response = await fetch(`/api/system-customers?q=${encodeURIComponent(customerQuery)}`)
        const data = await response.json()
        setCustomerResults(Array.isArray(data) ? data : [])
        setShowCustomerList(true)
      } catch {
        setCustomerResults([])
      } finally {
        setCustomerLoading(false)
      }
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

  function clearEquipment() {
    setSelectedEquipment(null)
    setEquipmentQuery('')
    setEquipmentResults([])
    setForm((prev) => ({
      ...prev,
      customerName: '',
      customerId: '',
      equipmentId: '',
      productId: '',
      manufacturer: '',
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    const response = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    const data = await response.json()
    setSubmitting(false)

    if (!response.ok) {
      setError(data.error || '建立工單失敗')
      return
    }

    router.push('/tickets')
    router.refresh()
  }

  const inputCls = 'input-soft w-full px-4 py-3 text-sm text-stone-800 placeholder:text-stone-400'

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-24 sm:pb-0">
      {/* 案件基本資訊 */}
      <div className="card-soft rounded-3xl p-5 sm:p-7">
        <div className="mb-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">第一步</p>
          <h2 className="mt-1 text-lg font-bold text-stone-800">案件基本資訊</h2>
          <p className="mt-1 text-sm text-stone-500">先找到客戶，再填寫需要協助的問題。</p>
        </div>

        {/* 設備搜尋 */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">客戶設備搜尋</label>
          <div className="flex gap-2">
            <input
              value={equipmentQuery}
              onChange={(e) => setEquipmentQuery(e.target.value)}
              placeholder="輸入客戶名稱、序號、Support ID 或 TeamViewer ID"
              className={inputCls}
            />
            {selectedEquipment && (
              <button
                type="button"
                onClick={clearEquipment}
                className="shrink-0 rounded-full border border-stone-200 bg-white px-4 py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-50 active:scale-95 transition-all whitespace-nowrap"
              >
                清除
              </button>
            )}
          </div>
          {showEquipmentList && equipmentResults.length > 0 && (
            <div className="mt-1 border border-gray-200 rounded-xl bg-white shadow-lg max-h-60 overflow-y-auto">
              {equipmentResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectEquipment(item)}
                  className="w-full text-left px-4 py-3 hover:bg-brand-50/50 text-sm border-b border-stone-900/[0.06] last:border-0 transition-colors"
                >
                  <div className="font-medium text-gray-800">{item.customerName}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {[
                      item.manufacturer,
                      item.serialNumber && `序號 ${item.serialNumber}`,
                      item.supportId && `Support ${item.supportId}`,
                    ].filter(Boolean).join('・')}
                  </div>
                </button>
              ))}
            </div>
          )}
          {equipmentLoading && <p className="mt-2 text-xs text-gray-400">正在搜尋設備資料...</p>}
          {!equipmentLoading && equipmentQuery.trim() && showEquipmentList && equipmentResults.length === 0 && !equipmentError && (
            <p className="mt-2 text-xs text-gray-400">目前沒有符合的設備資料。</p>
          )}
          {equipmentError && <p className="mt-2 text-xs text-amber-600">{equipmentError}</p>}
          {selectedEquipment && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-green-600 bg-brand-50 px-2 py-1 rounded-full">
                ✓ 已選：{[selectedEquipment.customerName, selectedEquipment.manufacturer, selectedEquipment.serialNumber && `序號 ${selectedEquipment.serialNumber}`, selectedEquipment.supportId && `Support ${selectedEquipment.supportId}`].filter(Boolean).join('・')}
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 客戶名稱 */}
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              客戶名稱 <span className="text-red-500">*</span>
            </label>
            <input
              value={customerQuery || form.customerName}
              onChange={(e) => {
                setCustomerQuery(e.target.value)
                updateField('customerName', e.target.value)
                if (!e.target.value) updateField('customerId', '')
              }}
              onFocus={() => { if (customerResults.length > 0) setShowCustomerList(true) }}
              onBlur={() => setTimeout(() => setShowCustomerList(false), 150)}
              className={inputCls}
              placeholder="搜尋客戶名稱"
              autoComplete="off"
            />
            {customerLoading && (
              <span className="absolute right-3 top-[34px] text-xs text-gray-400">搜尋中...</span>
            )}
            {showCustomerList && customerResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 border border-gray-200 rounded-xl bg-white shadow-lg max-h-64 overflow-y-auto">
                {customerResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onMouseDown={() => selectCustomer(item)}
                    className="w-full text-left px-4 py-3 hover:bg-brand-50/50 text-sm border-b border-stone-900/[0.06] last:border-0 transition-colors"
                  >
                    <div className="font-medium">{item.name}</div>
                    {(item.city || item.type) && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        {item.city && <span>{item.city}</span>}
                        {item.city && item.type && <span> · </span>}
                        {item.type && <span className="text-green-600">{item.type}</span>}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
            {form.customerId && (
              <div className="mt-1">
                <span className="text-xs text-green-600 bg-brand-50 px-2 py-1 rounded-full">✓ 已從清單選取</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              聯絡人 <span className="text-red-500">*</span>
            </label>
            <input
              value={form.contactName}
              onChange={(e) => updateField('contactName', e.target.value)}
              className={inputCls}
              placeholder="現場或回報窗口"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              案件標題 <span className="text-red-500">*</span>
            </label>
            <input
              value={form.title}
              onChange={(e) => updateField('title', e.target.value)}
              className={inputCls}
              placeholder="例如：FC-30 無法啟動"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              案件類型 <span className="text-red-500">*</span>
            </label>
            <select
              value={form.ticketType}
              onChange={(e) => updateField('ticketType', e.target.value)}
              className={inputCls}
            >
              {TICKET_TYPES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">優先級</label>
            <select
              value={form.priority}
              onChange={(e) => updateField('priority', e.target.value)}
              className={inputCls}
            >
              {PRIORITIES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">預計維修日期</label>
            <input
              type="date"
              value={form.scheduledDate ?? ''}
              onChange={(e) => updateField('scheduledDate', e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">技術支援對口</label>
            <select
              value={form.supportOwner}
              onChange={(e) => updateField('supportOwner', e.target.value)}
              className={inputCls}
            >
              {SUPPORT_OWNERS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">業務窗口</label>
            <select
              value={form.salesOwner}
              onChange={(e) => updateField('salesOwner', e.target.value)}
              className={inputCls}
            >
              {SALES_OWNERS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 問題詳情 */}
      <div className="card-soft rounded-3xl p-5 sm:p-7">
        <div className="mb-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">第二步</p>
          <h2 className="mt-1 text-lg font-bold text-stone-800">問題詳情</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="col-span-full">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              問題描述 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              className={`${inputCls} min-h-32 resize-y`}
              placeholder="請描述問題情境、錯誤訊息、發生頻率與目前狀況"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">原因判斷</label>
            <textarea
              value={form.cause ?? ''}
              onChange={(e) => updateField('cause', e.target.value)}
              className={`${inputCls} min-h-24 resize-y`}
              placeholder="先行判斷可能原因"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">暫定解法</label>
            <textarea
              value={form.solution ?? ''}
              onChange={(e) => updateField('solution', e.target.value)}
              className={`${inputCls} min-h-24 resize-y`}
              placeholder="若已有暫定處理方式可先填"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">關鍵料件</label>
            <input
              value={form.keyPart ?? ''}
              onChange={(e) => updateField('keyPart', e.target.value)}
              className={inputCls}
              placeholder="需要的關鍵零件或耗材"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">備註</label>
            <input
              value={form.note ?? ''}
              onChange={(e) => updateField('note', e.target.value)}
              className={inputCls}
              placeholder="其他補充資訊"
            />
          </div>
        </div>
      </div>

      {error && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-200">{error}</p>}

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 rounded-t-3xl border-t border-stone-900/[0.06] bg-[#fdfdfb]/95 px-4 py-3 shadow-[0_-4px_24px_rgba(28,25,23,0.06)] backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 rounded-full bg-brand-500 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-brand-500/25 hover:bg-brand-600 active:scale-95 transition-all disabled:opacity-50 sm:flex-none"
        >
          {submitting ? '建立中...' : '建立工單'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/tickets')}
          className="rounded-full border border-stone-200 bg-white px-5 py-3 text-sm font-medium text-stone-600 hover:bg-stone-50 hover:border-stone-300 active:scale-95 transition-all"
        >
          返回列表
        </button>
      </div>
    </form>
  )
}
