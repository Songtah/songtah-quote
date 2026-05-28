'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  PROMOTION_TYPES,
  PROMOTION_STATUS_COLOR,
  type Promotion,
  type PromotionType,
  type PromotionStatus,
} from '@/lib/promotions-notion'
import {
  ITEM_STATUS_COLOR,
  type PromotionItem,
  type ItemStatus,
} from '@/lib/promotion-items-notion'

// ── Badges ────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PromotionStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${PROMOTION_STATUS_COLOR[status]}`}>
      {status}
    </span>
  )
}

const TYPE_COLOR: Record<string, string> = {
  '季度展場': 'bg-orange-100 text-orange-700',
  '月度促銷': 'bg-blue-100   text-blue-700',
  '課程':     'bg-green-100  text-green-700',
  '其他':     'bg-gray-100   text-gray-600',
}

function TypeBadge({ type }: { type: string }) {
  if (!type) return null
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLOR[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {type}
    </span>
  )
}

function ItemStatusBadge({ status }: { status: ItemStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${ITEM_STATUS_COLOR[status]}`}>
      {status}
    </span>
  )
}

function fmtDate(d: string) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${y}/${m}/${day}`
}

// ── Product search for adding items ──────────────────────────

interface SearchResult { skuCode: string; name: string; manufacturer: string; productType: string; category: string }

function ProductSearchPicker({ onSelect }: { onSelect: (r: SearchResult) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q.trim())}&limit=20`)
        const data = await res.json()
        setResults(Array.isArray(data) ? data : [])
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 300)
  }, [q])

  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜尋貨號或品名…"
        autoFocus
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
      />
      {loading && <p className="text-xs text-gray-400 mt-2 text-center">搜尋中…</p>}
      {!loading && q.trim() && results.length === 0 && (
        <p className="text-xs text-gray-400 mt-2 text-center">找不到符合的商品</p>
      )}
      {results.length > 0 && (
        <div className="mt-2 border rounded-lg divide-y overflow-hidden max-h-64 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.skuCode}
              type="button"
              onClick={() => { onSelect(r); setQ(''); setResults([]) }}
              className="w-full text-left px-3 py-2.5 hover:bg-brand-50 transition"
            >
              <p className="text-sm font-medium text-gray-800">{r.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{r.skuCode} · {r.manufacturer}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Promotion Item Row ────────────────────────────────────────

function ItemRow({ item, onUpdate, onDelete }: {
  item:     PromotionItem
  onUpdate: (id: string, patch: Partial<PromotionItem>) => void
  onDelete: (id: string) => void
}) {
  const [editing,   setEditing]   = useState(false)
  const [condition, setCondition] = useState(item.condition)
  const [price,     setPrice]     = useState<string>(item.price != null ? String(item.price) : '')
  const [adminNote, setAdminNote] = useState(item.adminNote)
  const [saving,    setSaving]    = useState(false)
  const [deleting,  setDeleting]  = useState(false)

  const handleStatusChange = async (status: ItemStatus) => {
    onUpdate(item.id, { status })
    await fetch(`/api/promotion-items/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
  }

  const handleSave = async () => {
    setSaving(true)
    const priceNum = price !== '' ? parseFloat(price) : null
    const patch = { condition, price: isFinite(priceNum!) ? priceNum : null, adminNote }
    onUpdate(item.id, patch)
    await fetch(`/api/promotion-items/${item.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    setSaving(false)
    setEditing(false)
  }

  const handleDelete = async () => {
    if (!confirm(`確定移除「${item.skuName}」？`)) return
    setDeleting(true)
    await fetch(`/api/promotion-items/${item.id}`, { method: 'DELETE' })
    onDelete(item.id)
  }

  return (
    <div className={`border-b last:border-0 px-4 py-3 transition-colors ${item.status === '不採用' ? 'opacity-50' : ''}`}>
      {/* Top row */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-800">{item.skuName}</span>
            <span className="text-xs text-gray-400 font-mono">{item.skuCode}</span>
            {item.brand && <span className="text-xs text-gray-400">{item.brand}</span>}
          </div>

          {/* Condition + price (view) */}
          {!editing && (
            <div className="flex flex-wrap items-center gap-3 mt-1.5">
              <ItemStatusBadge status={item.status} />
              {item.condition && (
                <span className="text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">{item.condition}</span>
              )}
              {item.price != null && (
                <span className="text-xs font-semibold text-brand-700">NT${item.price.toLocaleString()}</span>
              )}
              {item.adminNote && (
                <span className="text-xs text-gray-400 italic">備注：{item.adminNote}</span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Status quick-switch */}
          {!editing && (
            <select
              value={item.status}
              onChange={(e) => handleStatusChange(e.target.value as ItemStatus)}
              className="text-xs border rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-brand-400 text-gray-600"
            >
              <option value="待定價">待定價</option>
              <option value="已確認">已確認</option>
              <option value="不採用">不採用</option>
            </select>
          )}
          <button onClick={() => setEditing((e) => !e)}
            className="px-2 py-1 rounded text-xs border border-gray-200 text-gray-500 hover:border-brand-400 hover:text-brand-600 transition">
            {editing ? '收起' : '編輯'}
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="px-2 py-1 rounded text-xs border border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-500 transition disabled:opacity-40">
            {deleting ? '…' : '移除'}
          </button>
        </div>
      </div>

      {/* Edit fields */}
      {editing && (
        <div className="mt-3 space-y-2.5 pl-0">
          <div>
            <label className="block text-[11px] font-semibold text-gray-400 mb-1">促銷條件</label>
            <input
              type="text"
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
              placeholder="例：買5送1 / 2瓶12000 / 全系列7折"
              className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[11px] font-semibold text-gray-400 mb-1">促銷價格（選填）</label>
              <input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="優惠後單價"
                className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-semibold text-gray-400 mb-1">行政備注</label>
              <input
                type="text"
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                placeholder="定價說明…"
                className="w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)}
              className="px-3 py-1.5 rounded-lg border text-xs text-gray-500 hover:bg-gray-50 transition">
              取消
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 disabled:opacity-50 transition">
              {saving ? '儲存中…' : '儲存'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Promotion Detail Panel ────────────────────────────────────

function PromotionDetailPanel({ promo, onClose, onEdit }: {
  promo:   Promotion
  onClose: () => void
  onEdit:  () => void
}) {
  const [items,       setItems]       = useState<PromotionItem[]>([])
  const [loadingItems, setLoadingItems] = useState(true)
  const [showSearch,  setShowSearch]  = useState(false)
  const [addingItem,  setAddingItem]  = useState(false)

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  useEffect(() => {
    setLoadingItems(true)
    fetch(`/api/promotions/${promo.id}/items`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setItems(data) })
      .catch(() => {})
      .finally(() => setLoadingItems(false))
  }, [promo.id])

  const handleAddProduct = async (r: SearchResult) => {
    // Check if already added
    if (items.find((it) => it.skuCode === r.skuCode)) {
      alert(`「${r.name}」已在此活動中`)
      return
    }
    setAddingItem(true)
    try {
      const res = await fetch(`/api/promotions/${promo.id}/items`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skuCode: r.skuCode, skuName: r.name, brand: r.manufacturer }),
      })
      const item = await res.json()
      if (res.ok) setItems((prev) => [...prev, item])
    } catch {}
    finally { setAddingItem(false); setShowSearch(false) }
  }

  const handleUpdateItem = (id: string, patch: Partial<PromotionItem>) => {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it))
  }

  const handleDeleteItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  // Stats
  const confirmed = items.filter((i) => i.status === '已確認').length
  const pending   = items.filter((i) => i.status === '待定價').length
  const dropped   = items.filter((i) => i.status === '不採用').length

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <motion.div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col h-full"
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <StatusBadge status={promo.status} />
                {promo.type && <TypeBadge type={promo.type} />}
              </div>
              <h2 className="text-base font-bold text-gray-900 leading-snug">{promo.name}</h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {fmtDate(promo.startDate)} – {fmtDate(promo.endDate)}
              </p>
            </div>
            <div className="flex gap-1.5 shrink-0 mt-0.5">
              <button onClick={onEdit}
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-500 hover:border-brand-400 hover:text-brand-600 transition">
                編輯活動
              </button>
              <button onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">✕</button>
            </div>
          </div>

          {/* Description */}
          {promo.description && (
            <p className="text-xs text-gray-500 mt-3 leading-relaxed whitespace-pre-wrap">{promo.description}</p>
          )}
          {promo.dmUrl && (
            <a href={promo.dmUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-xs text-brand-600 hover:underline">
              📄 查閱 DM
            </a>
          )}

          {/* Stats */}
          {items.length > 0 && (
            <div className="flex gap-4 mt-3 text-xs">
              <span className="text-green-600 font-semibold">✅ 已確認 {confirmed}</span>
              <span className="text-yellow-600 font-semibold">⏳ 待定價 {pending}</span>
              {dropped > 0 && <span className="text-red-500">❌ 不採用 {dropped}</span>}
              <span className="text-gray-400">共 {items.length} 項</span>
            </div>
          )}
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {/* Add item toolbar */}
          <div className="px-4 py-3 border-b bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">促銷品項</p>
              <button
                onClick={() => setShowSearch((s) => !s)}
                disabled={addingItem}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 disabled:opacity-50 transition"
              >
                {addingItem ? '新增中…' : '+ 新增品項'}
              </button>
            </div>
            <AnimatePresence>
              {showSearch && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="pt-1">
                    <ProductSearchPicker onSelect={handleAddProduct} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Items list */}
          {loadingItems && (
            <div className="space-y-0 divide-y">
              {[1,2,3].map((i) => <div key={i} className="h-14 px-4 py-3 animate-pulse"><div className="h-3 bg-gray-100 rounded w-3/4" /></div>)}
            </div>
          )}
          {!loadingItems && items.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-2">📋</div>
              <p className="text-sm">尚未加入任何品項</p>
              <button onClick={() => setShowSearch(true)}
                className="mt-2 text-xs text-brand-600 hover:underline font-medium">
                點擊「新增品項」開始選品
              </button>
            </div>
          )}
          {!loadingItems && items.length > 0 && (
            <div className="divide-y">
              {items.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  onUpdate={handleUpdateItem}
                  onDelete={handleDeleteItem}
                />
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── Promotion Edit Drawer ─────────────────────────────────────

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
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <motion.div className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} />
      <motion.div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col h-full"
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{isEdit ? '編輯促銷活動' : '新增促銷活動'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">活動名稱 *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="例：2026 年 Q2 季度展場"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">活動類型</label>
            <div className="flex flex-wrap gap-2">
              {(['', ...PROMOTION_TYPES] as (PromotionType | '')[]).map((t) => (
                <button key={t || 'none'} type="button" onClick={() => setType(t)}
                  className={['px-3 py-1.5 rounded-full text-xs font-medium border transition',
                    type === t ? 'bg-brand-500 border-brand-500 text-white' : 'border-gray-300 text-gray-600 hover:border-brand-400 hover:text-brand-600',
                  ].join(' ')}>
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
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="活動內容、優惠條件說明…" rows={4}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-none" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">DM 附件連結</label>
            <input type="url" value={dmUrl} onChange={(e) => setDmUrl(e.target.value)}
              placeholder="https://…（Notion 附件、Google Drive 等）"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400" />
            <p className="text-[11px] text-gray-400 mt-1">貼入公開連結，業務可直接點開查閱</p>
          </div>
        </div>
        <div className="px-6 py-4 border-t shrink-0">
          {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition">取消</button>
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

function PromotionCard({ promo, onView, onEdit, onDelete }: {
  promo:    Promotion
  onView:   () => void
  onEdit:   () => void
  onDelete: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`確定要刪除「${promo.name}」嗎？`)) return
    setDeleting(true)
    await fetch(`/api/promotions/${promo.id}`, { method: 'DELETE' }).catch(() => {})
    onDelete()
  }

  return (
    <div onClick={onView}
      className="panel p-4 hover:shadow-md transition-shadow cursor-pointer hover:border-brand-200 group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <StatusBadge status={promo.status} />
            {promo.type && <TypeBadge type={promo.type} />}
          </div>
          <h3 className="font-semibold text-gray-900 text-sm group-hover:text-brand-700 transition-colors">{promo.name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{fmtDate(promo.startDate)} – {fmtDate(promo.endDate)}</p>
          {promo.description && (
            <p className="text-xs text-gray-500 mt-1.5 line-clamp-1">{promo.description}</p>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={(e) => { e.stopPropagation(); onEdit() }}
            className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-500 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition">
            編輯
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-400 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-40">
            {deleting ? '…' : '刪除'}
          </button>
        </div>
        <div className="text-gray-300 group-hover:text-brand-400 transition-colors text-sm shrink-0 mt-0.5">›</div>
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
  const [promos,  setPromos]  = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)
  const [viewing, setViewing] = useState<Promotion | null>(null)      // detail panel
  const [editing, setEditing] = useState<Promotion | null | 'new'>(null) // edit drawer

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
      if (idx >= 0) { const next = [...prev]; next[idx] = p; return next }
      return [p, ...prev]
    })
    // If we just edited the currently-viewed promo, update the panel too
    if (viewing && viewing.id === p.id) setViewing(p)
    setEditing(null)
  }

  const handleDelete = (id: string) => {
    setPromos((prev) => prev.filter((p) => p.id !== id))
    if (viewing?.id === id) setViewing(null)
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
        <button onClick={() => setEditing('new')} className="button-primary px-4 py-2 text-sm">
          + 新增活動
        </button>
      </div>

      {loading && (
        <div className="space-y-3">
          {[1,2,3].map((i) => <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      )}

      {!loading && promos.length === 0 && (
        <div className="text-center py-24 text-gray-400">
          <div className="text-5xl mb-3">🎪</div>
          <p className="text-sm">尚未建立任何促銷活動</p>
          <button onClick={() => setEditing('new')} className="mt-3 text-xs text-brand-600 hover:underline font-medium">立即新增</button>
        </div>
      )}

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
                      onView={() => setViewing(promo)}
                      onEdit={() => { setViewing(null); setEditing(promo) }}
                      onDelete={() => handleDelete(promo.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Detail panel */}
      <AnimatePresence>
        {viewing && (
          <PromotionDetailPanel
            promo={viewing}
            onClose={() => setViewing(null)}
            onEdit={() => { setEditing(viewing); setViewing(null) }}
          />
        )}
      </AnimatePresence>

      {/* Edit drawer (z-60, above detail panel z-50) */}
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
