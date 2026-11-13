'use client'

import Link from 'next/link'
import { SeriesArtwork } from '@/components/product-series/SeriesArtwork'

export interface TileBadge { label: string; tone: 'muted' | 'dark' | 'warn' | 'brand' }

export interface ProductTileData {
  key: string
  href: string
  title: string
  /** 品牌 */
  eyebrow?: string
  /** 貨號，或「12 個品項」 */
  meta: string
  imageUrl?: string
  category: string
  mainCategory?: string
  priceLabel: string
  priceTone: 'price' | 'pending' | 'off'
  badges?: TileBadge[]
  /** 系列卡右上角的品項數 */
  count?: number
}

const BADGE_TONE: Record<TileBadge['tone'], string> = {
  muted: 'bg-stone-100 text-stone-500',
  dark: 'bg-stone-700 text-white',
  warn: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  brand: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200/70',
}

/** 產品格線：所有卡片同寬同高（方形照片＋固定高度的文字區）。 */
export const TILE_GRID = 'grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5'

/** 產品卡（系列與單品共用）：方形照片、兩行品名、品牌、價格，尺寸固定。 */
export function ProductTile({ tile }: { tile: ProductTileData }) {
  return (
    <Link
      href={tile.href}
      className="card-soft card-soft-hover group flex h-full flex-col overflow-hidden p-0 transition-all active:scale-[0.98]"
      data-testid="product-tile"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-white">
        {tile.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tile.imageUrl} alt="" loading="lazy" className="h-full w-full object-contain p-3 transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-cream-100 to-brand-50">
            <SeriesArtwork category={tile.category} mainCategory={tile.mainCategory} label={tile.title} />
          </div>
        )}
        {tile.count != null && (
          <span className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-stone-600 shadow-sm ring-1 ring-stone-900/[0.06]">
            {tile.count.toLocaleString()} 項
          </span>
        )}
        {tile.badges && tile.badges.length > 0 && (
          <span className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {tile.badges.slice(0, 2).map((badge) => (
              <span key={badge.label} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE_TONE[badge.tone]}`}>{badge.label}</span>
            ))}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col border-t border-stone-900/[0.05] px-3 pb-3 pt-2.5">
        <p className="h-4 truncate text-[11px] font-semibold uppercase tracking-wider text-stone-400">{tile.eyebrow || ' '}</p>
        <p className="mt-1 line-clamp-2 h-10 text-sm font-semibold leading-5 text-stone-800 transition-colors group-hover:text-brand-700">{tile.title}</p>
        <p className="mt-1 h-4 truncate font-mono text-[11px] text-stone-400">{tile.meta}</p>
        <div className="mt-2 flex h-7 items-center">
          {tile.priceTone === 'price' ? (
            <span className="price-pill max-w-full truncate">{tile.priceLabel}</span>
          ) : (
            <span className={`text-xs font-semibold ${tile.priceTone === 'pending' ? 'text-amber-600' : 'text-stone-300'}`}>{tile.priceLabel}</span>
          )}
        </div>
      </div>
    </Link>
  )
}

/** 入口卡（主分類、品牌）：和產品卡同一個外形，內容是縮圖拼貼或類別圖像。 */
export function EntryTile({ title, meta, thumbs, artwork, onClick }: {
  title: string
  meta: string
  thumbs?: string[]
  artwork?: React.ReactNode
  onClick: () => void
}) {
  const images = (thumbs ?? []).slice(0, 4)
  return (
    <button
      type="button"
      onClick={onClick}
      className="card-soft card-soft-hover group flex h-full flex-col overflow-hidden p-0 text-left transition-all active:scale-[0.98]"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-white">
        {images.length >= 4 ? (
          <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px bg-stone-900/[0.05]">
            {images.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt="" loading="lazy" className="h-full w-full bg-white object-contain p-2" />
            ))}
          </div>
        ) : images.length > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={images[0]} alt="" loading="lazy" className="h-full w-full object-contain p-4" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-cream-100 to-brand-50">{artwork}</div>
        )}
      </div>
      <div className="flex flex-1 flex-col border-t border-stone-900/[0.05] px-3 pb-3 pt-2.5">
        <p className="line-clamp-2 h-10 text-sm font-bold leading-5 text-stone-800 transition-colors group-hover:text-brand-700">{title}</p>
        <p className="mt-1 h-4 truncate text-xs text-stone-400">{meta}</p>
      </div>
    </button>
  )
}
