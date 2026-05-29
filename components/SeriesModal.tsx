'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useSession } from 'next-auth/react'
import { YMHToothGridPanel, buildFromPattern } from '@/components/FamilySpecPicker'
import type { ProductFamily } from '@/components/FamilySpecPicker'

// ── Types ─────────────────────────────────────────────────────

interface CatalogItem {
  code: string
  name: string
  brand: string
  productType: string
  category: string
}

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
  onView: (item: CatalogItem) => void
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

  const inputCls =
    'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 resize-y'

  if (seriesLoading) {
    return (
      <div className="px-5 py-4 border-b border-gray-100 space-y-2 animate-pulse">
        <div className="h-3 bg-gray-100 rounded w-full" />
        <div className="h-3 bg-gray-100 rounded w-3/4" />
      </div>
    )
  }

  if (editing) {
    return (
      <div className="px-5 py-4 border-b border-gray-100 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">系列介紹編輯</p>

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
        <div className="grid grid-cols-2 gap-2">
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
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2 rounded-xl text-sm font-medium bg-brand-500 text-white hover:bg-brand-600 transition disabled:opacity-50"
          >
            {saving ? '儲存中…' : '儲存'}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="px-4 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
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
    <div className="px-5 py-4 border-b border-gray-100">
      {hasContent ? (
        <div className="flex gap-3">
          {seriesData?.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={seriesData.imageUrl}
              alt={family.seriesName}
              className="w-20 h-20 object-cover rounded-xl shrink-0 border border-gray-100 bg-gray-50"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
          <div className="flex-1 min-w-0">
            {seriesData?.description && (
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {seriesData.description}
              </p>
            )}
            {(seriesData?.technicalSpecs || seriesData?.applicableScope) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
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
      ) : (
        <p className="text-sm text-gray-400 italic">暫無系列介紹</p>
      )}

      {isAdmin && (
        <button
          onClick={() => setEditing(true)}
          className="mt-3 text-xs text-brand-500 hover:text-brand-700 transition font-medium"
        >
          {hasContent ? '✏ 編輯系列介紹' : '+ 新增系列介紹'}
        </button>
      )}
    </div>
  )
}

// ── Case B: Spec-driven modal content ────────────────────────

function SpecDrivenContent({
  family,
  allItems,
  onView,
  onEdit,
}: {
  family: ProductFamily
  allItems: CatalogItem[]
  onView: (item: CatalogItem) => void
  onEdit: (item: CatalogItem) => void
}) {
  const firstSpec = family.specs[0]
  const subSpecs = family.specs.slice(1)

  const [selectedTab, setSelectedTab] = useState(firstSpec?.options[0] ?? '')
  const [subSelections, setSubSelections] = useState<Record<string, string>>({})

  // Reset sub-selections when tab changes
  useEffect(() => { setSubSelections({}) }, [selectedTab])

  // Compute valid options for each sub-spec given current selections
  function getValidOptions(specIndex: number): string[] {
    if (!family.skuMap) return family.specs[specIndex]?.options ?? []
    const prefixParts = [selectedTab]
    for (let i = 1; i < specIndex; i++) {
      const key = family.specs[i]?.key
      if (key && subSelections[key]) {
        prefixParts.push(subSelections[key])
      } else {
        return family.specs[specIndex]?.options ?? []
      }
    }
    const prefix = prefixParts.join('|')
    const validValues = new Set<string>()
    for (const k of Object.keys(family.skuMap)) {
      if (k.startsWith(prefix + '|') || k === prefix) {
        const parts = k.split('|')
        const val = parts[specIndex]
        if (val) validValues.add(val)
      }
    }
    if (validValues.size === 0) return family.specs[specIndex]?.options ?? []
    return family.specs[specIndex]?.options.filter((o) => validValues.has(o)) ?? []
  }

  function resolveSkuCode(): string | null {
    if (subSpecs.length === 0) {
      if (family.skuMap) return family.skuMap[selectedTab] ?? null
      if (family.skuPattern) return buildFromPattern(family.skuPattern, { [firstSpec.key]: selectedTab })
      return null
    }
    const allSelected = subSpecs.every((s) => subSelections[s.key])
    if (!allSelected) return null
    if (family.skuMap) {
      const key = [selectedTab, ...subSpecs.map((s) => subSelections[s.key])].join('|')
      return family.skuMap[key] ?? null
    }
    if (family.skuPattern) {
      return buildFromPattern(family.skuPattern, { [firstSpec.key]: selectedTab, ...subSelections })
    }
    return null
  }

  function resolveSkuName(skuCode: string): string {
    if (family.namePattern) {
      return buildFromPattern(family.namePattern, { [firstSpec.key]: selectedTab, ...subSelections })
    }
    return allItems.find((it) => it.code === skuCode)?.name ?? skuCode
  }

  const resolvedSkuCode = resolveSkuCode()
  const resolvedItem = resolvedSkuCode ? allItems.find((it) => it.code === resolvedSkuCode) : null

  function makeItem(code: string): CatalogItem {
    return resolvedItem ?? {
      code,
      name: resolveSkuName(code),
      brand: family.brand,
      productType: family.productType,
      category: family.category,
    }
  }

  return (
    <>
      {/* First spec tabs */}
      <div className="flex flex-wrap gap-2 px-5 pt-4 pb-3 border-b border-gray-100">
        <span className="text-xs text-gray-400 self-center">{firstSpec?.label}：</span>
        {firstSpec?.options.map((opt) => (
          <button
            key={opt}
            onClick={() => setSelectedTab(opt)}
            className={[
              'px-4 py-1.5 rounded-full text-sm font-medium border transition-all',
              selectedTab === opt
                ? 'bg-brand-500 border-brand-500 text-white'
                : 'bg-white border-gray-300 text-gray-600 hover:border-brand-400',
            ].join(' ')}
          >
            {opt}
          </button>
        ))}
      </div>

      {/* Sub-specs */}
      {subSpecs.length > 0 && (
        <div className="px-5 py-3 space-y-3 border-b border-gray-100">
          {subSpecs.map((spec, idx) => {
            const validOpts = getValidOptions(idx + 1)
            return (
              <div key={spec.key}>
                <p className="text-xs text-gray-500 mb-1.5">{spec.label}：</p>
                <div className="flex flex-wrap gap-1.5">
                  {validOpts.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setSubSelections((prev) => ({ ...prev, [spec.key]: opt }))}
                      className={[
                        'px-3 py-1 rounded-full text-xs font-medium border transition-all',
                        subSelections[spec.key] === opt
                          ? 'bg-brand-500 border-brand-500 text-white'
                          : 'bg-white border-gray-300 text-gray-600 hover:border-brand-400',
                      ].join(' ')}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* SKU result */}
      <div className="px-5 py-3 flex items-center gap-3">
        {resolvedSkuCode ? (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400">SKU</p>
              <p className="text-sm font-mono text-gray-800 truncate">{resolvedSkuCode}</p>
            </div>
            <button
              onClick={() => onView(makeItem(resolvedSkuCode))}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 transition shrink-0"
            >
              查看詳情
            </button>
            <button
              onClick={() => onEdit(makeItem(resolvedSkuCode))}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold border border-gray-300 text-gray-600 hover:border-brand-400 hover:text-brand-600 transition shrink-0"
            >
              編輯
            </button>
          </>
        ) : (
          <p className="text-sm text-gray-400">請選擇規格</p>
        )}
      </div>
    </>
  )
}

// ── Case C: Member list content ────────────────────────────────

function MemberListContent({
  family,
  onView,
}: {
  family: ProductFamily
  onView: (item: CatalogItem) => void
}) {
  const [members, setMembers] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [memberSearch, setMemberSearch] = useState('')

  useEffect(() => {
    fetch(`/api/products/families/${encodeURIComponent(family.id)}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.members)) {
          setMembers(
            data.members.map((m: any) => ({
              code: m.code,
              name: m.name,
              brand: m.brand ?? family.brand,
              productType: m.productType ?? family.productType,
              category: m.category ?? family.category,
            }))
          )
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [family])

  const filtered = memberSearch
    ? members.filter(
        (m) =>
          m.code.toLowerCase().includes(memberSearch.toLowerCase()) ||
          m.name.toLowerCase().includes(memberSearch.toLowerCase())
      )
    : members

  return (
    <div className="px-5 py-4 space-y-3">
      <input
        type="search"
        value={memberSearch}
        onChange={(e) => setMemberSearch(e.target.value)}
        placeholder="搜尋貨號或品名…"
        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
      />
      <div className="max-h-80 overflow-y-auto space-y-0.5">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 rounded-lg bg-gray-100 animate-pulse" />
          ))
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">找不到品項</p>
        ) : (
          filtered.map((m) => (
            <button
              key={m.code}
              onClick={() => onView(m)}
              className="w-full flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-gray-50 text-left transition-colors"
            >
              <span className="font-mono text-[11px] text-gray-400 w-28 shrink-0">{m.code}</span>
              <span className="text-sm text-gray-700 flex-1 truncate">{m.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ── Main SeriesModal ──────────────────────────────────────────

export function SeriesModal({ family, allItems, onView, onEdit, onClose }: SeriesModalProps) {
  const { data: session } = useSession()
  const s = session as any
  const isAdmin =
    s?.user?.role === 'admin' ||
    s?.user?.accountType === '行政' ||
    s?.user?.accountType === '中央管理'

  const [seriesData, setSeriesData] = useState<SeriesData | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(true)

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
  const hasSpecDriven = !isYMH && (family.skuMap || family.skuPattern) && family.specs.length > 0
  const isMemberList = !isYMH && !hasSpecDriven

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex-1 min-w-0 pr-3">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-gray-900">{family.seriesName}</h2>
              {family.brand && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  {family.brand}
                </span>
              )}
              {family.productType && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 border border-blue-100 text-blue-600">
                  {family.productType}
                </span>
              )}
            </div>
            {family.category && (
              <p className="text-xs text-gray-400 mt-0.5">{family.category}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-gray-400 hover:text-gray-600 transition p-1 rounded-lg hover:bg-gray-100"
            aria-label="關閉"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Series info (shared across all modes) */}
        <SeriesInfoSection
          family={family}
          seriesData={seriesData}
          seriesLoading={seriesLoading}
          isAdmin={isAdmin}
          onSeries={setSeriesData}
        />

        {/* Product selection content */}
        {isYMH ? (
          <div className="px-5 py-4">
            <YMHToothGridPanel
              family={family}
              onAdd={(skuCode) => {
                const item = allItems.find((it) => it.code === skuCode)
                if (item) onView(item)
              }}
              actionLabel="查看詳情"
            />
          </div>
        ) : hasSpecDriven ? (
          <SpecDrivenContent
            family={family}
            allItems={allItems}
            onView={onView}
            onEdit={onEdit}
          />
        ) : (
          <MemberListContent family={family} onView={onView} />
        )}
      </motion.div>
    </div>
  )
}
