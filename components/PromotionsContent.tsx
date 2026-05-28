'use client'

import { useEffect, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  PROMOTION_TYPES,
  PROMOTION_STATUS_COLOR,
  type Promotion,
  type PromotionType,
  type PromotionStatus,
} from '@/lib/promotions-notion'

// ── Status badge ──────────────────────────────────────────────

function StatusBadge({ status }: { status: PromotionStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${PROMOTION_STATUS_COLOR[status]}`}>
      {status}
    </span>
  )
}

// ── Type badge ────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  '季度展場': 'bg-orange-100 text-orange-700',
  '月度促銷': 'bg-blue-100 text-blue-700',
  '課程':     'bg-green-100 text-green-700',
  '其他':     'bg-gray-100 text-gray-600',
}

function TypeBadge({ type }: { type: string }) {
  if (!type) return null
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLOR[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {type}
    </span>
  )
}

// ── Date formatting ───────────────────────────────────────────

function fmtDate(d: string): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${y}/${m}/${day}`
}

// ── Edit / Create Drawer ──────────────────────────────────────

interface DrawerProps {
  initial?: Promotion | null
  onClose:  () => void
  onSaved:  (p: Promotion) => void
}

function PromotionDrawer({ initial, onClose, onSaved }: DrawerProps) {
  const isEdit = !!initial

  const [name,        setName]        = useState(initial?.name        ?? '')
  const [type,        setType]        = useState<PromotionType | ''>(initial?.type ?? '')
  const [startDate,   setStartDate]   = useState(initial?.startDate   ?? '')
  const [endDate,     setEndDate]     = useState(initial?.endDate     ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [dmUrl,       setDmUrl]       = useState(initial?.dmUrl       ?? '')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  // Esc to close
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const handleSave = async () => {
    if (!name.trim()) { setError('請填寫活動名稱'); return }
    setError(''); setSaving(true)
    try {
      const body = { name: name.trim(), type: type || undefined, startDate: startDate || undefined, endDate: endDate || undefined, description, dmUrl: dmUrl || undefined }
      const res = isEdit
        ? await fetch(`/api/promotions/${initial!.id}`, { method: 'PUT',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/promotions',                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '儲存失敗')
      onSaved(data)
    } catch (err: any) {
      setError(err.message ?? '儲存失敗，請重試')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <motion.div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="relative w-full max-w-md bg-white shadow-2xl flex flex-col h-full"
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? '編輯促銷活動' : '新增促銷活動'}
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">✕</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">活動名稱 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：2026 年 Q2 季度展場"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">活動類型</label>
            <div className="flex flex-wrap gap-2">
              {(['', ...PROMOTION_TYPES] as (PromotionType | '')[]).map((t) => (
                <button
                  key={t || 'none'}
                  type="button"
                  onClick={() => setType(t)}
                  className={[
                    'px-3 py-1.5 rounded-full text-xs font-medium border transition',
                    type === t
                      ? 'bg-brand-500 border-brand-500 text-white'
                      : 'border-gray-300 text-gray-600 hover:border-brand-400 hover:text-brand-600',
                  ].join(' ')}
                >
                  {t || '不指定'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">開始日期</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">結束日期</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">活動說明</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="活動內容、優惠條件說明…"
              rows={4}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">DM 附件連結</label>
            <input
              type="url"
              value={dmUrl}
              onChange={(e) => setDmUrl(e.target.value)}
              placeholder="https://…（Notion 附件、Google Drive 等）"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
            <p className="text-[11px] text-gray-400 mt-1">貼入公開連結，業務可直接點開查閱</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t shrink-0">
          {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition">
              取消
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition">
              {saving ? '儲存中…' : isEdit ? '儲存變更' : '建立活動'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Promotion Card ────────────────────────────────────────────

function PromotionCard({ promo, onEdit, onDelete }: { promo: Promotion; onEdit: () => void; onDelete: () => void }) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirm(`確定要刪除「${promo.name}」嗎？`)) return
    setDeleting(true)
    await fetch(`/api/promotions/${promo.id}`, { method: 'DELETE' }).catch(() => {})
    onDelete()
  }

  return (
    <div className="panel p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <StatusBadge status={promo.status} />
            {promo.type && <TypeBadge type={promo.type} />}
          </div>
          <h3 className="font-semibold text-gray-900 text-sm truncate">{promo.name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {fmtDate(promo.startDate)} – {fmtDate(promo.endDate)}
          </p>
          {promo.description && (
            <p className="text-xs text-gray-600 mt-2 leading-relaxed line-clamp-2 whitespace-pre-wrap">{promo.description}</p>
          )}
          {promo.dmUrl && (
            <a href={promo.dmUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-xs text-brand-600 hover:text-brand-700 hover:underline">
              📄 查閱 DM
            </a>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button onClick={onEdit}
            className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-500 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition">
            編輯
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-400 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-40">
            {deleting ? '…' : '刪除'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────

const STATUS_ORDER: PromotionStatus[] = ['進行中', '規劃中', '已結束']
const STATUS_LABEL: Record<PromotionStatus, string> = {
  '進行中': '🟢 進行中',
  '規劃中': '🔵 即將開始',
  '已結束': '⚪ 已結束',
}

export function PromotionsContent() {
  const [promos,   setPromos]   = useState<Promotion[]>([])
  const [loading,  setLoading]  = useState(true)
  const [editing,  setEditing]  = useState<Promotion | null | 'new'>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetch('/api/promotions').then((r) => r.json())
      if (Array.isArray(data)) setPromos(data)
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSaved = (p: Promotion) => {
    setPromos((prev) => {
      const idx = prev.findIndex((x) => x.id === p.id)
      if (idx >= 0) {
        const next = [...prev]; next[idx] = p; return next
      }
      return [p, ...prev]
    })
    setEditing(null)
  }

  const handleDelete = (id: string) => {
    setPromos((prev) => prev.filter((p) => p.id !== id))
  }

  const grouped = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = promos.filter((p) => p.status === s)
    return acc
  }, {} as Record<PromotionStatus, Promotion[]>)

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-gray-500">
          共 {promos.length} 個活動
          {promos.filter((p) => p.status === '進行中').length > 0 && (
            <span className="ml-2 text-green-600 font-medium">
              · {promos.filter((p) => p.status === '進行中').length} 個進行中
            </span>
          )}
        </p>
        <button
          onClick={() => setEditing('new')}
          className="button-primary px-4 py-2 text-sm"
        >
          + 新增活動
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      )}

      {/* Empty */}
      {!loading && promos.length === 0 && (
        <div className="text-center py-24 text-gray-400">
          <div className="text-5xl mb-3">🎪</div>
          <p className="text-sm">尚未建立任何促銷活動</p>
          <button onClick={() => setEditing('new')}
            className="mt-3 text-xs text-brand-600 hover:underline font-medium">
            立即新增
          </button>
        </div>
      )}

      {/* Grouped list */}
      {!loading && promos.length > 0 && (
        <div className="space-y-8">
          {STATUS_ORDER.map((status) => {
            const list = grouped[status]
            if (list.length === 0) return null
            return (
              <div key={status}>
                <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
                  {STATUS_LABEL[status]} <span className="font-normal">({list.length})</span>
                </h3>
                <div className="space-y-3">
                  {list.map((promo) => (
                    <PromotionCard
                      key={promo.id}
                      promo={promo}
                      onEdit={() => setEditing(promo)}
                      onDelete={() => handleDelete(promo.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Drawer */}
      <AnimatePresence>
        {editing !== null && (
          <PromotionDrawer
            initial={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={handleSaved}
          />
        )}
      </AnimatePresence>
    </>
  )
}
