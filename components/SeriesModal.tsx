'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useSession } from 'next-auth/react'
import { FamilySpecPanel, YMHToothGridPanel } from '@/components/FamilySpecPicker'
import type { ProductFamily } from '@/components/FamilySpecPicker'
import { SeriesSkuDetails, SeriesSkuSummary, type SeriesCatalogItem } from '@/components/product-series/SeriesSkuDetails'
import { explicitFamilySkuCodes } from '@/lib/product-family-members'

// ── Types ─────────────────────────────────────────────────────

interface CatalogItem extends SeriesCatalogItem {}

interface SeriesData {
  id: string
  seriesCode: string
  seriesName: string
  brand: string
  description: string
  imageUrl: string
  technicalSpecs: string
  applicableScope: string
  notes: string
}

interface SeriesModalProps {
  family: ProductFamily
  allItems: CatalogItem[]
  onEdit: (item: CatalogItem) => void
  onClose: () => void
}

// ── Series Info Section ───────────────────────────────────────

function SeriesInfoSection({
  family,
  seriesData,
  seriesLoading,
  isAdmin,
  onSeries,
}: {
  family: ProductFamily
  seriesData: SeriesData | null
  seriesLoading: boolean
  isAdmin: boolean
  onSeries: (data: SeriesData) => void
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    description: '',
    imageUrl: '',
    technicalSpecs: '',
    applicableScope: '',
  })

  // When series data loads, seed form
  useEffect(() => {
    if (seriesData) {
      setForm({
        description: seriesData.description ?? '',
        imageUrl: seriesData.imageUrl ?? '',
        technicalSpecs: seriesData.technicalSpecs ?? '',
        applicableScope: seriesData.applicableScope ?? '',
      })
    }
  }, [seriesData])

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/products/series/${encodeURIComponent(family.seriesCode)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seriesName: family.seriesName,
          brand: family.brand,
          ...form,
        }),
      })
      if (res.ok) {
        const updated = await res.json()
        if (updated) onSeries(updated)
        setEditing(false)
      }
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'input-soft min-h-11 w-full resize-y text-sm'

  if (seriesLoading) {
    return (
      <div className="space-y-2 px-4 py-4 animate-pulse sm:px-5">
        <div className="h-3 w-full rounded-full bg-stone-100" />
        <div className="h-3 w-3/4 rounded-full bg-stone-100" />
      </div>
    )
  }

  if (editing) {
    return (
      <div className="space-y-3 px-4 py-4 sm:px-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-stone-500">系列介紹編輯</p>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">介紹說明</label>
          <textarea
            rows={3}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="輸入系列整體介紹文字…"
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">主圖 URL</label>
          <input
            type="url"
            value={form.imageUrl}
            onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
            placeholder="https://…"
            className={inputCls}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">技術參數</label>
            <textarea
              rows={2}
              value={form.technicalSpecs}
              onChange={(e) => setForm((f) => ({ ...f, technicalSpecs: e.target.value }))}
              placeholder="彎曲強度、燒結溫度…"
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">適用範圍</label>
            <textarea
              rows={2}
              value={form.applicableScope}
              onChange={(e) => setForm((f) => ({ ...f, applicableScope: e.target.value }))}
              placeholder="牙冠、橋體…"
              className={inputCls}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            onClick={handleSave}
            disabled={saving}
            className="min-h-12 flex-1 rounded-full bg-brand-500 px-5 py-2 text-sm font-medium text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50"
          >
            {saving ? '儲存中…' : '儲存'}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="min-h-12 rounded-full border border-stone-200 px-5 py-2 text-sm text-stone-600 transition-all hover:bg-stone-50 active:scale-95"
          >
            取消
          </button>
        </div>
      </div>
    )
  }

  // Display mode
  const hasContent = seriesData?.description || seriesData?.imageUrl || seriesData?.technicalSpecs || seriesData?.applicableScope

  return (
    <div className="px-4 py-4 sm:px-5">
      {hasContent ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          {seriesData?.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={seriesData.imageUrl}
              alt={family.seriesName}
              className="h-44 w-full shrink-0 rounded-2xl bg-stone-50 object-contain ring-1 ring-stone-900/[0.05] sm:h-24 sm:w-24"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
          <div className="flex-1 min-w-0">
            {seriesData?.description && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-600">
                {seriesData.description}
              </p>
            )}
            {(seriesData?.technicalSpecs || seriesData?.applicableScope) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-400">
                {seriesData?.applicableScope && (
                  <span>適用：{seriesData.applicableScope}</span>
                )}
                {seriesData?.technicalSpecs && (
                  <span>{seriesData.technicalSpecs}</span>
                )}
              </div>
            )}
          </div>
        </div>
      ) : isAdmin ? (
        <div className="flex items-start gap-3 px-1 py-2">
          <span className="text-2xl shrink-0 opacity-40">📝</span>
          <div>
            <p className="text-sm font-medium text-gray-500">尚無系列介紹</p>
            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
              新增介紹說明、封面圖及技術參數，讓業務同仁快速掌握產品特色
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">暫無系列介紹</p>
      )}

      {isAdmin && (
        <button
          onClick={() => setEditing(true)}
          className="mt-3 min-h-11 rounded-full border px-4 py-2 text-xs font-medium transition-all active:scale-95
            bg-brand-50 border-brand-200 text-brand-600 hover:bg-brand-100 hover:border-brand-400"
        >
          {hasContent ? '✏ 編輯系列介紹' : '＋ 新增系列介紹'}
        </button>
      )}
    </div>
  )
}

// ── Case C: Member list content ────────────────────────────────

function MemberListContent({
  members,
  selectedCode,
  onSelect,
}: {
  members: CatalogItem[]
  selectedCode?: string
  onSelect: (item: CatalogItem) => void
}) {
  const [memberSearch, setMemberSearch] = useState('')

  const filtered = memberSearch
    ? members.filter(
        (m) =>
          m.code.toLowerCase().includes(memberSearch.toLowerCase()) ||
          m.name.toLowerCase().includes(memberSearch.toLowerCase())
      )
    : members

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={memberSearch}
        onChange={(e) => setMemberSearch(e.target.value)}
        placeholder="搜尋貨號或品名…"
        className="input-soft min-h-11 w-full text-sm"
      />
      <div className="max-h-72 space-y-1 overflow-y-auto overscroll-contain pr-1">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-stone-400">找不到品項</p>
        ) : (
          filtered.map((m) => (
            <button
              key={m.code}
              onClick={() => onSelect(m)}
              className={`flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-all active:scale-[0.99] ${selectedCode === m.code ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-brand-50/50'}`}
            >
              <span className="w-24 shrink-0 truncate font-mono text-[11px] text-stone-400 sm:w-32">{m.code}</span>
              <span className="flex-1 truncate text-sm font-medium text-stone-700">{m.name}</span>
              <span className="text-brand-600" aria-hidden="true">›</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ── Main SeriesModal ──────────────────────────────────────────

export function SeriesModal({ family, allItems, onEdit, onClose }: SeriesModalProps) {
  const { data: session } = useSession()
  const s = session as any
  const isAdmin =
    s?.user?.role === 'admin' ||
    s?.user?.accountType === '行政' ||
    s?.user?.accountType === '中央管理'

  const [seriesData, setSeriesData] = useState<SeriesData | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(true)
  const memberItems = useMemo(() => {
    const itemByCode = new Map(allItems.map((item) => [item.code, item]))
    return explicitFamilySkuCodes(family)
      .map((code) => itemByCode.get(code))
      .filter((item): item is CatalogItem => Boolean(item))
  }, [allItems, family])
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null)

  useEffect(() => {
    setSelectedItem((current) => {
      if (current) {
        const refreshed = memberItems.find((item) => item.code === current.code)
        if (refreshed) return refreshed
      }
      return memberItems[0] ?? null
    })
  }, [family.id, memberItems])

  // Fetch series-level data from new DB
  useEffect(() => {
    if (!family.seriesCode) { setSeriesLoading(false); return }
    setSeriesLoading(true)
    fetch(`/api/products/series/${encodeURIComponent(family.seriesCode)}`)
      .then((r) => r.json())
      .then((data) => setSeriesData(data ?? null))
      .catch(() => setSeriesData(null))
      .finally(() => setSeriesLoading(false))
  }, [family.seriesCode])

  // Scroll trap
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const isYMH = family.uiVariant === 'ymh-tooth-grid'
  // skuPattern 無法表達缺號／例外 SKU；只有精確 skuMap 才啟用規格組合器。
  const hasSpecDriven = !isYMH && Boolean(family.skuMap) && family.specs.length > 0
  const representative = memberItems[0]
  const selectSku = (skuCode: string) => {
    const item = memberItems.find((candidate) => candidate.code === skuCode)
    if (item) setSelectedItem(item)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="presentation"
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.98 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="flex max-h-[96dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-[#fcfbf8] shadow-2xl ring-1 ring-stone-900/[0.06] sm:max-h-[92vh] sm:rounded-3xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="series-modal-title"
      >
        {/* Header */}
        <div className="glass-bar z-20 flex items-start justify-between border-b border-stone-900/[0.06] px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex-1 min-w-0 pr-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 id="series-modal-title" className="text-lg font-bold text-stone-800 sm:text-xl">{family.seriesName}</h2>
              {family.brand && (
                <span className="chip">
                  {family.brand}
                </span>
              )}
              {(representative?.productType || family.productType) && (
                <span className="chip-active">
                  {representative?.productType || family.productType}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-stone-400">{representative?.category || family.category} · {memberItems.length} 個明確對應規格</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-700 active:scale-95"
            aria-label="關閉"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-3 pb-5 sm:px-6 sm:pb-6">
          <section className="mt-3 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-stone-900/[0.05] sm:mt-5">
            <div className="px-4 pb-1 pt-4 sm:px-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">選擇規格</p>
              <p className="mt-1 text-xs leading-relaxed text-stone-500">同系列規格集中於此；選定後，下方資料會切換成該貨號的照片、售價、規格與文件。</p>
            </div>
            {isYMH ? (
              <div className="px-1 pb-3 sm:px-2">
                <YMHToothGridPanel family={family} onAdd={selectSku} actionLabel="查看此規格" />
              </div>
            ) : hasSpecDriven ? (
              <FamilySpecPanel family={family} onAdd={selectSku} actionLabel="查看此規格" />
            ) : (
              <div className="px-4 pb-4 pt-3 sm:px-5">
                <MemberListContent members={memberItems} selectedCode={selectedItem?.code} onSelect={setSelectedItem} />
              </div>
            )}
          </section>

          <section className="mt-3 sm:mt-4">
            <SeriesSkuSummary item={selectedItem} onEdit={(item) => onEdit(item as CatalogItem)} />
          </section>

          <section className="mt-3 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-stone-900/[0.05] sm:mt-4">
            <div className="px-4 pt-4 sm:px-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">產品介紹</p>
            </div>
            <SeriesInfoSection
              family={family}
              seriesData={seriesData}
              seriesLoading={seriesLoading}
              isAdmin={isAdmin}
              onSeries={setSeriesData}
            />
          </section>

          <section className="mt-3 sm:mt-4">
            <SeriesSkuDetails item={selectedItem} />
          </section>
        </div>
        {selectedItem && (
          <div className="glass-bar z-20 border-t border-stone-900/[0.06] p-3 sm:hidden">
            <button
              type="button"
              onClick={() => onEdit(selectedItem)}
              className="flex min-h-12 w-full items-center justify-center rounded-full bg-brand-500 px-5 text-sm font-bold text-white shadow-md shadow-brand-500/25 transition-all active:scale-[0.98]"
            >
              編輯此規格的照片、規格與文件
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )
}
