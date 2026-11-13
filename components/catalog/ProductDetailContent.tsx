'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnimatePresence } from 'framer-motion'
import { FamilySpecPanel, YMHToothGridPanel } from '@/components/FamilySpecPicker'
import type { ProductFamily } from '@/components/FamilySpecPicker'
import { MemberListContent, SeriesInfoSection } from '@/components/SeriesModal'
import { SeriesSkuDetails } from '@/components/product-series/SeriesSkuDetails'
import { SeriesArtwork } from '@/components/product-series/SeriesArtwork'
import { ProductEditDrawer } from '@/components/CatalogManagerContent'
import { PRODUCT_LABELS } from '@/lib/product-labels'

interface DetailItem {
  code: string
  name: string
  officialName?: string
  erpPending?: boolean
  brand: string
  productType: string
  category: string
  mainCategory?: string
  price?: number
  salePrice?: number
  priceSource?: 'override' | 'catalog' | 'unset'
  spec?: string
  discontinued?: boolean
  status?: string
  disabled?: boolean
  imageUrl?: string
}

interface SeriesData {
  id: string; seriesCode: string; seriesName: string; brand: string
  description: string; imageUrl: string; technicalSpecs: string; applicableScope: string; notes: string
}

const money = (value: number) => `NT$${value.toLocaleString('zh-TW')}`

function priceRange(items: DetailItem[]): string {
  const sellable = items.filter((item) => !item.discontinued && !item.disabled)
  if (sellable.length === 0) return PRODUCT_LABELS.discontinued
  const prices = sellable.map((item) => item.price).filter((price): price is number => typeof price === 'number')
  if (prices.length === 0) return PRODUCT_LABELS.unpriced
  const min = Math.min(...prices), max = Math.max(...prices)
  return min === max ? money(min) : `${money(min)}～${max.toLocaleString('zh-TW')}`
}

/** 產品專屬頁：系列一頁（/products/series/[id]）、未歸入系列的單品一頁（/products/item/[code]）。 */
export function ProductDetailContent({ seriesId, code, initialSku, canManageProducts }: {
  seriesId?: string
  code?: string
  initialSku?: string
  canManageProducts: boolean
}) {
  const router = useRouter()
  const [family, setFamily] = useState<ProductFamily | null>(null)
  const [items, setItems] = useState<DetailItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [selectedCode, setSelectedCode] = useState(initialSku || code || '')
  const [editingCode, setEditingCode] = useState('')
  const [allFamilies, setAllFamilies] = useState<ProductFamily[]>([])
  const [tableOpen, setTableOpen] = useState(false)

  const [seriesData, setSeriesData] = useState<SeriesData | null>(null)
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [seriesError, setSeriesError] = useState('')
  const [seriesAttempt, setSeriesAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    const query = seriesId ? `series=${encodeURIComponent(seriesId)}` : `code=${encodeURIComponent(code ?? '')}`
    fetch(`/api/products/detail?${query}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.error || `產品資料讀取失敗（HTTP ${response.status}）`)
        return data
      })
      .then((data) => {
        if (!active) return
        // 單品網址但這個貨號其實屬於某個系列 → 轉到系列頁並選好該規格
        if (!seriesId && data.family) {
          router.replace(`/products/series/${encodeURIComponent(data.family.id)}?sku=${encodeURIComponent(code ?? '')}`)
          return
        }
        setFamily(data.family)
        setItems(Array.isArray(data.items) ? data.items : [])
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '產品資料暫時無法讀取') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [seriesId, code, attempt, router])

  useEffect(() => {
    if (!family?.seriesCode) return
    let active = true
    setSeriesLoading(true)
    setSeriesError('')
    fetch(`/api/products/series/${encodeURIComponent(family.seriesCode)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`產品介紹讀取失敗（HTTP ${response.status}）`)
        return response.json()
      })
      .then((data) => { if (active) setSeriesData(data ?? null) })
      .catch((reason) => { if (active) setSeriesError(reason instanceof Error ? reason.message : '產品介紹暫時無法讀取') })
      .finally(() => { if (active) setSeriesLoading(false) })
    return () => { active = false }
  }, [family?.seriesCode, seriesAttempt])

  const isYMH = family?.uiVariant === 'ymh-tooth-grid'
  const hasSpecDriven = Boolean(family) && !isYMH && Boolean(family?.skuMap) && (family?.specs.length ?? 0) > 0
  const selected = useMemo(() => {
    const found = items.find((item) => item.code === selectedCode)
    if (found) return found
    // 規格組合器／牙位表要使用者自己選；清單型系列與單品預設第一項
    return family && (isYMH || hasSpecDriven) ? null : (items[0] ?? null)
  }, [items, selectedCode, family, isYMH, hasSpecDriven])

  const openEdit = useCallback(async (skuCode: string) => {
    if (allFamilies.length === 0) {
      try {
        const response = await fetch('/api/products/families/manage', { cache: 'no-store' })
        if (response.ok) setAllFamilies(await response.json())
      } catch { /* 系列清單讀不到時仍可編輯其他欄位 */ }
    }
    setEditingCode(skuCode)
  }, [allFamilies.length])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-40 animate-pulse rounded-full bg-stone-100 motion-reduce:animate-none" />
        <div className="h-72 animate-pulse rounded-3xl bg-stone-100 motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded-3xl bg-stone-100 motion-reduce:animate-none" />
      </div>
    )
  }

  if (error || items.length === 0) {
    return (
      <div className="card-soft flex flex-col items-center px-5 py-12 text-center" role="alert">
        <h3 className="text-base font-bold text-stone-800">這個產品頁打不開</h3>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-stone-500">{error || '找不到這個產品，可能已停售或暫停販售。'}</p>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={() => setAttempt((value) => value + 1)} className="button-secondary min-h-11 px-5">重新載入</button>
          <Link href="/products/catalog" className="flex min-h-11 items-center rounded-full bg-brand-500 px-5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95">回產品總覽</Link>
        </div>
      </div>
    )
  }

  const representative = selected ?? items[0]
  const title = family ? family.seriesName : (representative.officialName || representative.name)
  const heroImage = selected?.imageUrl || seriesData?.imageUrl || items.find((item) => item.imageUrl)?.imageUrl || ''
  const brand = family?.brand || representative.brand
  const sellableCount = items.filter((item) => !item.discontinued && !item.disabled).length
  const unpricedCount = items.filter((item) => !item.discontinued && !item.disabled && item.price == null).length

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-10">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push('/products/catalog'))}
          className="flex min-h-10 items-center gap-1 rounded-full border border-stone-200 bg-white px-4 font-semibold text-stone-600 transition-all hover:border-brand-300 hover:text-brand-700 active:scale-95">
          <span aria-hidden="true">←</span>返回
        </button>
        <nav aria-label="所在位置" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-stone-400">
          <Link href="/products/catalog" className="rounded-full px-2 py-1 transition-colors hover:bg-brand-50 hover:text-brand-700">產品</Link>
          {representative.mainCategory && <><span aria-hidden="true">›</span>
            <Link href={`/products/catalog?main=${encodeURIComponent(representative.mainCategory)}`} className="rounded-full px-2 py-1 transition-colors hover:bg-brand-50 hover:text-brand-700">{representative.mainCategory}</Link></>}
          {representative.mainCategory && representative.category && <><span aria-hidden="true">›</span>
            <Link href={`/products/catalog?main=${encodeURIComponent(representative.mainCategory)}&cat=${encodeURIComponent(representative.category)}`} className="rounded-full px-2 py-1 transition-colors hover:bg-brand-50 hover:text-brand-700">{representative.category}</Link></>}
        </nav>
      </div>

      {/* 主卡：大圖＋名稱＋價格 */}
      <section className="card-soft overflow-hidden p-0">
        <div className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="relative flex aspect-square items-center justify-center bg-white md:aspect-auto md:min-h-[360px]">
            {heroImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={heroImage} alt={title} className="max-h-[420px] w-full object-contain p-6" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-cream-100 to-brand-50 py-16">
                <SeriesArtwork category={representative.category} mainCategory={representative.mainCategory} label={title} />
              </div>
            )}
          </div>
          <div className="flex flex-col border-t border-stone-900/[0.05] p-5 sm:p-7 md:border-l md:border-t-0">
            <Link href={`/products/catalog?brand=${encodeURIComponent(brand)}`} className="self-start text-[11px] font-bold uppercase tracking-widest text-brand-600 transition-colors hover:text-brand-700">{brand}</Link>
            <h2 className="mt-1 text-2xl font-bold leading-tight text-stone-800 sm:text-3xl">{title}</h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">{representative.category}</span>
              <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 ring-1 ring-brand-200/60">{representative.productType}</span>
              {family && <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600">{items.length} 個品項</span>}
            </div>

            <div className="mt-5">
              <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">{family && !selected ? '系列售價' : '售價'}</p>
              {selected ? (
                selected.discontinued ? <p className="mt-1 text-2xl font-bold text-stone-300">{selected.status || PRODUCT_LABELS.discontinued}</p>
                : selected.price != null ? <p className="mt-1 text-3xl font-bold tabular-nums text-stone-800">{money(selected.price)}</p>
                : <p className="mt-1 text-2xl font-bold text-amber-600">{PRODUCT_LABELS.unpriced}</p>
              ) : (
                <p className="mt-1 text-3xl font-bold tabular-nums text-stone-800">{priceRange(items)}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {selected?.disabled && <span className="rounded-full bg-stone-700 px-2 py-0.5 font-semibold text-white">{PRODUCT_LABELS.paused}</span>}
                {canManageProducts && selected?.priceSource === 'override' && <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">{PRODUCT_LABELS.manualPrice}</span>}
                {family && unpricedCount > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{unpricedCount} 項{PRODUCT_LABELS.unpriced}</span>}
                {family && sellableCount < items.length && <span className="rounded-full bg-stone-100 px-2 py-0.5 font-semibold text-stone-500">{items.length - sellableCount} 項不販售</span>}
              </div>
            </div>

            {selected && (
              <div className="mt-5 rounded-2xl bg-stone-50 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">{family ? '目前規格' : '貨號'}</p>
                {family && <p className="mt-1 text-sm font-semibold text-stone-800">{selected.officialName || selected.name}</p>}
                <p className="mt-0.5 font-mono text-xs text-stone-500">{selected.erpPending ? '尚無 ERP 料號' : selected.code}</p>
                {selected.officialName && <p className="mt-0.5 text-xs text-stone-400">ERP 品名：{selected.name}</p>}
              </div>
            )}

            {canManageProducts && selected && (
              <button type="button" onClick={() => openEdit(selected.code)}
                className="mt-auto self-start rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95">
                編輯{family ? '此規格' : '產品'}的照片、售價與文件
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 選擇規格（系列才有） */}
      {family && (
        <section className="card-soft overflow-hidden p-0">
          <div className="px-4 pb-1 pt-4 sm:px-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">選擇規格</p>
            <p className="mt-1 text-xs leading-relaxed text-stone-500">選定後，上方會切換成該貨號的照片與售價，下方是它的規格與文件。</p>
          </div>
          {isYMH ? (
            <div className="px-1 pb-3 sm:px-2"><YMHToothGridPanel family={family} onAdd={setSelectedCode} actionLabel="查看此規格" resetAfterAction={false} /></div>
          ) : hasSpecDriven ? (
            <FamilySpecPanel family={family} onAdd={setSelectedCode} actionLabel="查看此規格" resetAfterAction={false} />
          ) : (
            <div className="px-4 pb-4 pt-3 sm:px-5">
              <MemberListContent members={items} selectedCode={selected?.code} onSelect={(item) => setSelectedCode(item.code)} />
            </div>
          )}
        </section>
      )}

      {/* 產品介紹（系列層） */}
      {family && (
        <section className="card-soft overflow-hidden p-0">
          <div className="px-4 pt-4 sm:px-5"><p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">產品介紹</p></div>
          <SeriesInfoSection
            family={family}
            seriesData={seriesData}
            seriesLoading={seriesLoading}
            seriesError={seriesError}
            isAdmin={canManageProducts}
            onSeries={setSeriesData}
            onRetry={() => setSeriesAttempt((value) => value + 1)}
          />
        </section>
      )}

      {/* 選定貨號的照片、規格、文件 */}
      {selected && <SeriesSkuDetails item={selected} />}

      {/* 全系列價格表 */}
      {family && items.length > 1 && (
        <section className="card-soft overflow-hidden p-0">
          <button type="button" onClick={() => setTableOpen((open) => !open)} aria-expanded={tableOpen}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-all hover:bg-brand-50/40 active:scale-[0.99] sm:px-5">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-stone-700">全系列價格表</span>
              <span className="mt-0.5 block text-xs text-stone-400">{items.length} 個品項 · {priceRange(items)}</span>
            </span>
            <span className="text-xs font-semibold text-brand-600">{tableOpen ? '收合' : '展開'}</span>
          </button>
          {tableOpen && (
            <div className="max-h-[60vh] overflow-y-auto overscroll-contain border-t border-stone-900/[0.06] px-2 py-2 sm:px-4">
              {items.map((item) => (
                <button type="button" key={item.code} onClick={() => { setSelectedCode(item.code); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-all active:scale-[0.99] ${selected?.code === item.code ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-brand-50/50'}`}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-stone-900/[0.05]">
                    {item.imageUrl
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={item.imageUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
                      : <span className="text-stone-300" aria-hidden="true">◇</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-stone-700">{item.officialName || item.name}</span>
                    <span className="block truncate font-mono text-[11px] text-stone-400">{item.erpPending ? '尚無 ERP 料號' : item.code}</span>
                  </span>
                  {item.disabled && <span className="shrink-0 rounded-full bg-stone-700 px-2 py-0.5 text-[10px] font-semibold text-white">{PRODUCT_LABELS.paused}</span>}
                  {item.discontinued ? <span className="shrink-0 text-[11px] font-medium text-stone-300">{item.status || PRODUCT_LABELS.discontinued}</span>
                    : item.price != null ? <span className="price-pill shrink-0">{money(item.price)}</span>
                    : <span className="shrink-0 text-[11px] font-semibold text-amber-600">{PRODUCT_LABELS.unpriced}</span>}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <AnimatePresence>
        {canManageProducts && editingCode && (
          <ProductEditDrawer
            key={editingCode}
            skuCode={editingCode}
            onClose={() => setEditingCode('')}
            onSaved={() => setAttempt((value) => value + 1)}
            onFamilyChanged={async () => { setAttempt((value) => value + 1) }}
            allFamilies={allFamilies as never}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
