'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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

interface SeriesModalProps {
  family: ProductFamily
  allItems: CatalogItem[]
  onView: (item: CatalogItem) => void
  onEdit: (item: CatalogItem) => void
  onClose: () => void
}

interface TabContent {
  imageUrl: string
  description: string
  notionId: string | null
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
  const [tabContent, setTabContent] = useState<TabContent | null>(null)
  const [tabLoading, setTabLoading] = useState(false)
  const [subSelections, setSubSelections] = useState<Record<string, string>>({})

  // Fetch content for the selected tab
  useEffect(() => {
    if (!selectedTab) return

    let firstSkuCode: string | undefined

    if (family.skuMap) {
      // Find first SKU whose key starts with selectedTab| or equals selectedTab
      const matchKey = Object.keys(family.skuMap).find(
        (k) => k === selectedTab || k.startsWith(`${selectedTab}|`)
      )
      if (matchKey) firstSkuCode = family.skuMap[matchKey]
    } else if (family.skuPattern) {
      // Fallback: find catalog item by prefix + name match
      const fallback = allItems.find(
        (it) =>
          it.code.startsWith(family.seriesCode) &&
          it.name.includes(selectedTab)
      )
      if (fallback) firstSkuCode = fallback.code
    }

    if (!firstSkuCode) {
      setTabContent(null)
      return
    }

    setTabLoading(true)
    fetch(`/api/products/sku/${encodeURIComponent(firstSkuCode)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.rich) {
          setTabContent({
            imageUrl: data.rich.imageUrl ?? '',
            description: data.rich.description ?? '',
            notionId: data.rich.notionId ?? null,
          })
        } else {
          setTabContent(null)
        }
      })
      .catch(() => setTabContent(null))
      .finally(() => setTabLoading(false))
  }, [selectedTab, family, allItems])

  // Reset sub-selections when tab changes
  useEffect(() => {
    setSubSelections({})
  }, [selectedTab])

  // Compute valid options for each sub-spec given current selections
  function getValidOptions(specIndex: number): string[] {
    if (!family.skuMap) return family.specs[specIndex]?.options ?? []

    // Build prefix from selectedTab + all previous sub-spec selections
    const prefixParts = [selectedTab]
    for (let i = 1; i < specIndex; i++) {
      const key = family.specs[i]?.key
      if (key && subSelections[key]) {
        prefixParts.push(subSelections[key])
      } else {
        // Not fully selected up to this point — return all options
        return family.specs[specIndex]?.options ?? []
      }
    }
    const prefix = prefixParts.join('|')
    const validValues = new Set<string>()
    for (const k of Object.keys(family.skuMap)) {
      const parts = k.split('|')
      if (k.startsWith(prefix + '|') || k === prefix) {
        const val = parts[specIndex]
        if (val) validValues.add(val)
      }
    }
    // If no valid values found from skuMap filtering, fall back to full options
    if (validValues.size === 0) return family.specs[specIndex]?.options ?? []
    return family.specs[specIndex]?.options.filter((o) => validValues.has(o)) ?? []
  }

  // Resolve SKU from current selections
  function resolveSkuCode(): string | null {
    if (subSpecs.length === 0) {
      // Only one spec — selectedTab directly maps to SKU
      if (family.skuMap) {
        return family.skuMap[selectedTab] ?? null
      }
      if (family.skuPattern) {
        return buildFromPattern(family.skuPattern, { [firstSpec.key]: selectedTab })
      }
      return null
    }

    const allSelected = subSpecs.every((s) => subSelections[s.key])
    if (!allSelected) return null

    if (family.skuMap) {
      const key = [selectedTab, ...subSpecs.map((s) => subSelections[s.key])].join('|')
      return family.skuMap[key] ?? null
    }
    if (family.skuPattern) {
      return buildFromPattern(family.skuPattern, {
        [firstSpec.key]: selectedTab,
        ...subSelections,
      })
    }
    return null
  }

  function resolveSkuName(skuCode: string): string {
    if (family.namePattern) {
      return buildFromPattern(family.namePattern, {
        [firstSpec.key]: selectedTab,
        ...subSelections,
      })
    }
    const found = allItems.find((it) => it.code === skuCode)
    return found?.name ?? skuCode
  }

  const resolvedSkuCode = resolveSkuCode()
  const resolvedItem = resolvedSkuCode
    ? allItems.find((it) => it.code === resolvedSkuCode)
    : null

  function handleView() {
    if (!resolvedSkuCode) return
    if (resolvedItem) {
      onView(resolvedItem)
    } else {
      onView({
        code: resolvedSkuCode,
        name: resolveSkuName(resolvedSkuCode),
        brand: family.brand,
        productType: family.productType,
        category: family.category,
      })
    }
  }

  function handleEdit() {
    if (!resolvedSkuCode) return
    if (resolvedItem) {
      onEdit(resolvedItem)
    } else {
      onEdit({
        code: resolvedSkuCode,
        name: resolveSkuName(resolvedSkuCode),
        brand: family.brand,
        productType: family.productType,
        category: family.category,
      })
    }
  }

  return (
    <>
      {/* First spec tabs */}
      <div className="flex flex-wrap gap-2 px-5 pt-4 pb-3 border-b border-gray-100">
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

      {/* Content area */}
      <div className="px-5 py-4 flex gap-4 border-b border-gray-100 min-h-[100px]">
        {tabLoading ? (
          <>
            <div className="w-24 h-24 rounded-xl bg-gray-100 animate-pulse shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 bg-gray-100 rounded animate-pulse w-3/4" />
              <div className="h-3 bg-gray-100 rounded animate-pulse w-full" />
              <div className="h-3 bg-gray-100 rounded animate-pulse w-1/2" />
            </div>
          </>
        ) : (
          <>
            {tabContent?.imageUrl && tabContent.notionId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/notion-image?pageId=${tabContent.notionId}`}
                alt={selectedTab}
                className="w-24 h-24 rounded-xl object-cover shrink-0 border border-gray-100 bg-gray-50"
              />
            )}
            <p className="text-sm text-gray-600 leading-relaxed">
              {tabContent?.description || '暫無介紹'}
            </p>
          </>
        )}
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
                      onClick={() =>
                        setSubSelections((prev) => ({
                          ...prev,
                          [spec.key]: opt,
                        }))
                      }
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

      {/* Result */}
      <div className="px-5 py-3 flex items-center gap-3">
        {resolvedSkuCode ? (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400">SKU</p>
              <p className="text-sm font-mono text-gray-800 truncate">{resolvedSkuCode}</p>
            </div>
            <button
              onClick={handleView}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 transition shrink-0"
            >
              查看詳情
            </button>
            <button
              onClick={handleEdit}
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
  // Trap scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const isYMH = family.uiVariant === 'ymh-tooth-grid'
  const hasSpecDriven =
    !isYMH && (family.skuMap || family.skuPattern) && family.specs.length > 0
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

        {/* Content */}
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
