'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Visit } from '@/lib/system-notion'

const VISIT_STATUS_OPTIONS = [
  '初次拜訪',
  '例行拜訪',
  '重點追蹤',
  '展覽',
  '電話拜訪',
  '視訊拜訪',
  '其他',
]

type CustomerSuggestion = {
  id: string
  name: string
  city: string
  district: string
  address: string
  type: string
}

type VisitForm = {
  customerName: string
  customerId: string
  date: string
  salesperson: string
  status: string
  content: string
  address: string
  city: string
  district: string
}

function formatDate(d: string) {
  if (!d) return '—'
  return d.slice(0, 10).replace(/-/g, '/')
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    初次拜訪: 'bg-blue-100 text-blue-700',
    例行拜訪: 'bg-green-100 text-green-700',
    重點追蹤: 'bg-orange-100 text-orange-700',
    展覽: 'bg-purple-100 text-purple-700',
    電話拜訪: 'bg-slate-100 text-slate-600',
    視訊拜訪: 'bg-cyan-100 text-cyan-700',
    其他: 'bg-gray-100 text-gray-600',
  }
  const cls = colorMap[status] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{status || '—'}</span>
  )
}

export default function VisitsContent() {
  const [visits, setVisits] = useState<Visit[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingVisit, setEditingVisit] = useState<Visit | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadVisits = useCallback(() => {
    setLoading(true)
    fetch('/api/visits')
      .then((r) => r.json())
      .then(setVisits)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadVisits() }, [loadVisits])

  const handleDelete = async (id: string) => {
    setDeleting(true)
    try {
      await fetch(`/api/visits/${id}`, { method: 'DELETE' })
      setDeleteConfirmId(null)
      loadVisits()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">客情拜訪紀錄</h2>
          <p className="text-xs text-gray-400 mt-0.5">記錄每日客戶拜訪情況</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-green-800 hover:bg-green-900 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
        >
          + 新增拜訪
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">載入中…</div>
        ) : visits.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400 border-2 border-dashed border-gray-200 rounded-2xl m-4">
            尚無拜訪紀錄，點擊「新增拜訪」開始記錄。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-400 text-xs border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left">日期</th>
                  <th className="px-4 py-3 text-left">客戶名稱</th>
                  <th className="px-4 py-3 text-left">縣市</th>
                  <th className="px-4 py-3 text-left">鄉鎮市區</th>
                  <th className="px-4 py-3 text-left">拜訪性質</th>
                  <th className="px-4 py-3 text-left">業務人員</th>
                  <th className="px-4 py-3 text-left">拜訪內容</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visits.map((v) => (
                  <tr key={v.id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(v.date)}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{v.customerName}</td>
                    <td className="px-4 py-3 text-gray-500">{v.city || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{v.district || '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={v.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-500">{v.salesperson || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{v.content || '—'}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {deleteConfirmId === v.id ? (
                        <div className="flex items-center gap-2 justify-end">
                          <span className="text-xs text-gray-500">確認刪除？</span>
                          <button
                            onClick={() => handleDelete(v.id)}
                            disabled={deleting}
                            className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                          >
                            {deleting ? '…' : '確認'}
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="text-xs text-gray-400 hover:text-gray-600"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 justify-end">
                          <button
                            onClick={() => { setEditingVisit(v); setDeleteConfirmId(null) }}
                            className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
                          >
                            編輯
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(v.id)}
                            className="text-xs text-gray-300 hover:text-red-500 transition-colors"
                          >
                            刪除
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Visit Modal */}
      {showModal && (
        <VisitModal
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); loadVisits() }}
        />
      )}

      {/* Edit Visit Modal */}
      {editingVisit && (
        <VisitModal
          initialData={editingVisit}
          onClose={() => setEditingVisit(null)}
          onSaved={() => { setEditingVisit(null); loadVisits() }}
        />
      )}
    </div>
  )
}

// ── Shared Modal (create + edit) ──────────────────────────────

export function VisitModal({
  initialData,
  prefillCustomer,
  onClose,
  onSaved,
}: {
  initialData?: Visit
  prefillCustomer?: { id: string; name: string; city: string; district: string; address: string }
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!initialData
  const today = new Date().toISOString().slice(0, 10)

  const [form, setForm] = useState<VisitForm>({
    customerName: initialData?.customerName ?? prefillCustomer?.name ?? '',
    customerId: prefillCustomer?.id ?? '',
    date: initialData?.date ? initialData.date.slice(0, 10) : today,
    salesperson: initialData?.salesperson ?? '',
    status: initialData?.status ?? '例行拜訪',
    content: initialData?.content ?? '',
    address: initialData?.address ?? prefillCustomer?.address ?? '',
    city: initialData?.city ?? prefillCustomer?.city ?? '',
    district: initialData?.district ?? prefillCustomer?.district ?? '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Customer search — disabled when prefillCustomer is provided
  const [query, setQuery] = useState(initialData?.customerName ?? prefillCustomer?.name ?? '')
  const [suggestions, setSuggestions] = useState<CustomerSuggestion[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (prefillCustomer) return // skip search when customer is pre-filled
    if (!query || query.length < 1) { setSuggestions([]); return }
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setSearchLoading(true)
      fetch(`/api/customers/search?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((data) => setSuggestions(Array.isArray(data) ? data : []))
        .catch(() => setSuggestions([]))
        .finally(() => setSearchLoading(false))
    }, 300)
  }, [query, prefillCustomer])

  const selectCustomer = (c: CustomerSuggestion) => {
    setForm((f) => ({
      ...f,
      customerName: c.name,
      customerId: c.id,
      city: c.city,
      district: c.district,
      address: c.address || f.address,
    }))
    setQuery(c.name)
    setSuggestions([])
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.customerName.trim()) { setError('請填寫客戶名稱'); return }
    setSubmitting(true)
    setError('')
    try {
      const res = isEdit
        ? await fetch(`/api/visits/${initialData!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
          })
        : await fetch('/api/visits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
          })

      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? (isEdit ? '更新失敗' : '建立失敗'))
        return
      }
      onSaved()
    } catch {
      setError('網路錯誤，請重試')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">{isEdit ? '編輯拜訪紀錄' : '新增拜訪紀錄'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Customer search */}
          <div className="relative">
            <label className="block text-xs text-gray-500 mb-1">客戶名稱 *</label>
            <input
              type="text"
              value={query}
              readOnly={!!prefillCustomer}
              onChange={(e) => {
                if (prefillCustomer) return
                setQuery(e.target.value)
                setForm((f) => ({ ...f, customerName: e.target.value, customerId: '', city: '', district: '', address: '' }))
              }}
              placeholder="輸入客戶名稱搜尋…"
              className={`w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 ${prefillCustomer ? 'bg-gray-50 text-gray-500 cursor-default' : ''}`}
            />
            {(suggestions.length > 0 || searchLoading) && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {searchLoading ? (
                  <div className="px-4 py-3 text-sm text-gray-400">搜尋中…</div>
                ) : (
                  suggestions.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                    >
                      <div className="font-medium text-gray-800">{c.name}</div>
                      <div className="text-xs text-gray-400">{[c.city, c.district, c.type].filter(Boolean).join('・')}</div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">拜訪日期</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">業務人員</label>
              <input
                type="text"
                value={form.salesperson}
                onChange={(e) => setForm((f) => ({ ...f, salesperson: e.target.value }))}
                placeholder="業務姓名"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">拜訪性質</label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 bg-white"
            >
              {VISIT_STATUS_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">地址</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="拜訪地址（可自動從客戶帶入）"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">拜訪內容</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              rows={3}
              placeholder="記錄此次拜訪的重點內容…"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 resize-none"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-green-800 hover:bg-green-900 text-white py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50"
            >
              {submitting ? (isEdit ? '儲存中…' : '建立中…') : (isEdit ? '儲存變更' : '建立紀錄')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
