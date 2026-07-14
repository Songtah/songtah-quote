'use client'

import { useEffect, useMemo, useState } from 'react'
import { SeriesArtwork } from '@/components/product-series/SeriesArtwork'

export interface SeriesCatalogItem {
  code: string
  name: string
  brand: string
  productType: string
  category: string
  mainCategory?: string
  price?: number
  salePrice?: number
  spec?: string
}

interface SpecTable {
  columns: string[]
  rows: string[][]
}

interface GalleryImage {
  url: string
  pos: string
}

interface DocFile {
  name: string
  url: string
  size?: number
}

interface RichData {
  notionId: string | null
  price: number | null
  imageUrl: string
  description: string
  specsJson: string
  galleryJson: string
  docsJson: string
}

function parseJsonArray<T>(raw: string): T[] {
  try {
    const value = JSON.parse(raw || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function parseGallery(raw: string): GalleryImage[] {
  return parseJsonArray<GalleryImage | string>(raw)
    .map((image) => typeof image === 'string'
      ? { url: image, pos: '50% 50%' }
      : { url: image.url ?? '', pos: image.pos ?? '50% 50%' })
    .filter((image) => Boolean(image.url))
}

function parseSpecs(raw: string): SpecTable {
  try {
    const value = JSON.parse(raw || '{}')
    if (Array.isArray(value?.columns) && Array.isArray(value?.rows)) return value
  } catch {}
  return { columns: [], rows: [] }
}

function formatFileSize(size?: number) {
  if (!size) return ''
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-bold uppercase tracking-widest text-stone-400">{children}</h3>
}

export function SeriesSkuDetails({
  item,
  onEdit,
}: {
  item: SeriesCatalogItem | null
  onEdit: (item: SeriesCatalogItem) => void
}) {
  const [rich, setRich] = useState<RichData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!item) {
      setRich(null)
      return
    }
    let active = true
    setLoading(true)
    setError('')
    fetch(`/api/products/sku/${encodeURIComponent(item.code)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('讀取商品資料失敗')
        return response.json()
      })
      .then((data) => { if (active) setRich(data.rich ?? null) })
      .catch(() => { if (active) setError('暫時無法讀取此規格的詳細資料') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [item])

  const specs = useMemo(() => parseSpecs(rich?.specsJson ?? ''), [rich?.specsJson])
  const gallery = useMemo(() => parseGallery(rich?.galleryJson ?? ''), [rich?.galleryJson])
  const docs = useMemo(() => parseJsonArray<DocFile>(rich?.docsJson ?? ''), [rich?.docsJson])
  // 售價權威來源是 products_catalog.json；Notion rich.price 不作回退。
  const price = item?.price ?? null
  const images = item && rich
    ? [
        ...(rich.imageUrl ? [{ url: rich.imageUrl, pos: '50% 50%' }] : []),
        ...gallery,
      ].filter((image, index, all) => all.findIndex((candidate) => candidate.url === image.url) === index)
    : []

  if (!item) {
    return (
      <div className="card-soft flex min-h-48 flex-col items-center justify-center gap-2 px-5 py-8 text-center">
        <span className="text-3xl" aria-hidden="true">☝️</span>
        <p className="text-sm font-semibold text-stone-700">先選擇一個規格</p>
        <p className="max-w-sm text-xs leading-relaxed text-stone-400">選定後會在這裡顯示照片、售價、技術規格與對應技術文件。</p>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="series-sku-details">
      <div className="card-soft flex items-start gap-3 p-3 sm:p-4">
        <SeriesArtwork category={item.category} mainCategory={item.mainCategory} label={item.name} />
        <div className="min-w-0 flex-1 py-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-brand-600">目前規格</p>
          <h3 className="mt-1 text-base font-bold leading-snug text-stone-800">{item.name}</h3>
          <p className="mt-1 truncate font-mono text-xs text-stone-400">{item.code}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="chip">{item.category}</span>
            <span className="chip">{item.productType}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="hidden min-h-11 shrink-0 items-center rounded-full border border-stone-200 bg-white px-4 text-xs font-semibold text-stone-600 transition-all hover:border-brand-300 hover:text-brand-700 active:scale-95 sm:flex"
        >
          編輯資料
        </button>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-52 animate-pulse rounded-3xl bg-stone-100" />
          <div className="h-52 animate-pulse rounded-3xl bg-stone-100" />
        </div>
      ) : error ? (
        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-5">
            <section className="card-soft overflow-hidden p-4 sm:col-span-3">
              <SectionTitle>商品照片</SectionTitle>
              {images.length > 0 ? (
                <div className="mt-3 flex snap-x gap-3 overflow-x-auto pb-1">
                  {images.map((image, index) => (
                    <div key={`${image.url}-${index}`} className="aspect-square w-[78%] max-w-64 shrink-0 snap-center overflow-hidden rounded-2xl bg-white ring-1 ring-stone-900/[0.06] sm:w-52">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.url} alt={`${item.name} ${index + 1}`} className="h-full w-full object-contain" style={{ objectPosition: image.pos }} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 flex min-h-40 items-center justify-center rounded-2xl bg-cream-50 text-center">
                  <div>
                    <span className="text-4xl" aria-hidden="true">🖼️</span>
                    <p className="mt-2 text-xs text-stone-400">尚未上傳商品照片</p>
                  </div>
                </div>
              )}
            </section>

            <section className="card-soft p-4 sm:col-span-2">
              <SectionTitle>售價</SectionTitle>
              <div className="mt-4">
                {item.salePrice != null && price != null ? (
                  <>
                    <p className="text-sm text-stone-400 line-through">NT${price.toLocaleString('zh-TW')}</p>
                    <p className="mt-1 text-3xl font-bold text-emerald-700">NT${item.salePrice.toLocaleString('zh-TW')}</p>
                  </>
                ) : price != null ? (
                  <p className="text-3xl font-bold text-stone-800">NT${price.toLocaleString('zh-TW')}</p>
                ) : (
                  <span className="inline-flex rounded-full bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700">待定價</span>
                )}
                <p className="mt-3 text-xs leading-relaxed text-stone-400">實際成交價格仍依報價或訂購單成立時的價格快照為準。</p>
              </div>
              {rich?.description && (
                <div className="mt-5 border-t border-stone-900/[0.06] pt-4">
                  <SectionTitle>規格說明</SectionTitle>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-600">{rich.description}</p>
                </div>
              )}
            </section>
          </div>

          <section className="card-soft p-4">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle>技術規格</SectionTitle>
              {item.spec && <span className="text-xs text-stone-400">{item.spec}</span>}
            </div>
            {specs.columns.length > 0 && specs.rows.length > 0 ? (
              <div className="mt-3 overflow-x-auto rounded-2xl ring-1 ring-stone-900/[0.06]">
                <div className="min-w-[420px]">
                  <div className="grid bg-cream-100" style={{ gridTemplateColumns: `repeat(${specs.columns.length}, minmax(110px, 1fr))` }}>
                    {specs.columns.map((column) => <div key={column} className="px-3 py-2.5 text-xs font-bold text-stone-600">{column}</div>)}
                  </div>
                  {specs.rows.map((row, rowIndex) => (
                    <div key={rowIndex} className="grid border-t border-stone-900/[0.05]" style={{ gridTemplateColumns: `repeat(${specs.columns.length}, minmax(110px, 1fr))` }}>
                      {row.map((cell, cellIndex) => <div key={cellIndex} className="px-3 py-2.5 text-sm text-stone-600">{cell || '—'}</div>)}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-5 text-center text-xs text-stone-400">尚未建立此規格的技術參數表。</p>
            )}
          </section>

          <section className="card-soft p-4">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle>技術文件存放區</SectionTitle>
              <span className="text-xs text-stone-400">{docs.length} 份</span>
            </div>
            {docs.length > 0 ? (
              <div className="mt-3 space-y-2">
                {docs.map((doc, index) => (
                  <a
                    key={`${doc.url}-${index}`}
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-12 items-center gap-3 rounded-2xl bg-stone-50 px-3 py-2.5 transition-all hover:bg-brand-50 active:scale-[0.99]"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-lg ring-1 ring-stone-900/[0.05]">📄</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-700">{doc.name}</span>
                    {doc.size ? <span className="text-[11px] text-stone-400">{formatFileSize(doc.size)}</span> : null}
                    <span className="text-brand-600" aria-hidden="true">↗</span>
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-5 text-center text-xs text-stone-400">尚未上傳型錄、操作手冊或技術文件。</p>
            )}
          </section>

        </>
      )}
    </div>
  )
}
