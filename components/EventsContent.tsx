'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { EventItem } from '@/lib/system-notion'

const EVENT_TYPES = ['研討會', '產品發表', '培訓', '展覽', '其他']
const EVENT_STATUSES = ['籌備中', '開放報名', '已結束']

const STATUS_STYLE: Record<string, string> = {
  '籌備中': 'bg-gray-100 text-gray-600',
  '開放報名': 'bg-green-100 text-green-700',
  '已結束': 'bg-red-100 text-red-600',
}

const TYPE_STYLE: Record<string, string> = {
  '研討會': 'bg-blue-50 text-blue-700',
  '產品發表': 'bg-purple-50 text-purple-700',
  '培訓': 'bg-emerald-50 text-emerald-700',
  '展覽': 'bg-orange-50 text-orange-700',
  '其他': 'bg-gray-50 text-gray-600',
}

type FormState = {
  name: string
  date: string
  endDate: string
  location: string
  type: string
  deadline: string
  status: string
  description: string
}

const EMPTY_FORM: FormState = {
  name: '', date: '', endDate: '', location: '',
  type: '研討會', deadline: '', status: '籌備中', description: '',
}

function eventToForm(ev: EventItem): FormState {
  return {
    name: ev.name,
    date: ev.date,
    endDate: ev.endDate || '',
    location: ev.location || '',
    type: ev.type || '研討會',
    deadline: ev.deadline || '',
    status: ev.status || '籌備中',
    description: ev.description || '',
  }
}

export function EventsContent() {
  const [events, setEvents]     = useState<EventItem[]>([])
  const [loading, setLoading]   = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState<FormState>(EMPTY_FORM)
  const [editId, setEditId]     = useState<string | null>(null)
  const [saving, setSaving]     = useState(false)
  const [filter, setFilter]     = useState<string>('全部')

  useEffect(() => {
    fetch('/api/events')
      .then(r => r.json())
      .then(data => { setEvents(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function openCreate() {
    setForm(EMPTY_FORM)
    setEditId(null)
    setShowForm(true)
  }

  function openEdit(ev: EventItem, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setForm(eventToForm(ev))
    setEditId(ev.id)
    setShowForm(true)
  }

  async function handleDelete(ev: EventItem, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`確定要刪除「${ev.name}」？`)) return
    await fetch(`/api/events/${ev.id}`, { method: 'DELETE' })
    setEvents(prev => prev.filter(x => x.id !== ev.id))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name || !form.date) return
    setSaving(true)

    if (editId) {
      await fetch(`/api/events/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setEvents(prev => prev.map(ev =>
        ev.id === editId ? { ...ev, ...form } : ev
      ))
    } else {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        const created = await res.json()
        setEvents(prev => [created, ...prev])
      }
    }

    setSaving(false)
    setShowForm(false)
    setForm(EMPTY_FORM)
    setEditId(null)
  }

  const filtered = filter === '全部' ? events : events.filter(e => e.status === filter)

  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 flex-wrap">
          {['全部', ...EVENT_STATUSES].map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                filter === s
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s}
              {s !== '全部' && (
                <span className="ml-1 text-xs opacity-70">
                  ({events.filter(e => e.status === s).length})
                </span>
              )}
            </button>
          ))}
        </div>
        <button onClick={openCreate} className="button-primary">+ 新增活動</button>
      </div>

      {/* Events list */}
      {loading ? (
        <div className="py-16 text-center text-gray-400">載入中…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center text-gray-400">
          {filter === '全部' ? '尚無任何活動，點擊「新增活動」開始建立' : `沒有「${filter}」的活動`}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(ev => (
            <div key={ev.id} className="relative group rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md hover:border-gray-300 transition-all">
              {/* Edit / Delete buttons */}
              <div className="absolute top-3 right-3 hidden group-hover:flex gap-1 z-10">
                <button
                  onClick={e => openEdit(ev, e)}
                  className="rounded-lg bg-white border border-gray-200 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 shadow-sm"
                >
                  編輯
                </button>
                <button
                  onClick={e => handleDelete(ev, e)}
                  className="rounded-lg bg-white border border-gray-200 px-2 py-1 text-xs text-red-500 hover:bg-red-50 shadow-sm"
                >
                  刪除
                </button>
              </div>

              <Link href={`/events/${ev.id}`} className="block p-5">
                <div className="flex items-start justify-between gap-2 mb-3 pr-16">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLE[ev.type] ?? 'bg-gray-50 text-gray-600'}`}>
                    {ev.type || '未分類'}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[ev.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {ev.status}
                  </span>
                </div>
                <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-2">
                  {ev.name}
                </h3>
                <div className="mt-2 space-y-1 text-sm text-gray-500">
                  <p>📅 {ev.date}{ev.endDate && ev.endDate !== ev.date ? ` — ${ev.endDate}` : ''}</p>
                  {ev.location && <p>📍 {ev.location}</p>}
                  {ev.deadline && <p>⏰ 報名截止：{ev.deadline}</p>}
                </div>
                {ev.description && (
                  <p className="mt-3 text-sm text-gray-400 line-clamp-2">{ev.description}</p>
                )}
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editId ? '編輯活動' : '新增活動'}</h2>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditId(null) }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >✕</button>
            </div>

            <div>
              <label className="label">活動名稱 *</label>
              <input
                className="input w-full"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
                placeholder="例：2025 台北牙科研討會"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">活動類型</label>
                <select
                  className="input w-full"
                  value={form.type}
                  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                >
                  {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">狀態</label>
                <select
                  className="input w-full"
                  value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                >
                  {EVENT_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">開始日期 *</label>
                <input
                  type="date"
                  className="input w-full"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="label">結束日期</label>
                <input
                  type="date"
                  className="input w-full"
                  value={form.endDate}
                  onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">地點</label>
                <input
                  className="input w-full"
                  value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="例：台北世貿中心"
                />
              </div>
              <div>
                <label className="label">報名截止日</label>
                <input
                  type="date"
                  className="input w-full"
                  value={form.deadline}
                  onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="label">活動簡介</label>
              <textarea
                className="input w-full"
                rows={3}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="簡短說明活動內容"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditId(null) }}
                className="button-secondary"
              >取消</button>
              <button type="submit" disabled={saving} className="button-primary">
                {saving ? (editId ? '儲存中…' : '建立中…') : (editId ? '儲存' : '建立活動')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
