'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ProductSeriesAdminDrawer } from '@/components/ProductSeriesAdminDrawer'
import { MainCategoryArtwork } from '@/components/product-series/SeriesArtwork'
import { EntryTile, ProductTile, TILE_GRID, type ProductTileData, type TileBadge } from '@/components/catalog/ProductTile'
import { PRODUCT_LABELS } from '@/lib/product-labels'
import { useRouter, useSearchParams } from 'next/navigation'
import { buildExactFamilyIndex, explicitFamilySkuCodes } from '@/lib/product-family-members'
import { useBodyScrollLock, useDialogFocus } from '@/lib/use-dialog-focus'

// ── Types ─────────────────────────────────────────────────────

/** Each image in the form gallery, with an adjustable focal-point position */
export interface GalleryImage {
  url: string
  pos: string   // CSS object-position, e.g. "50% 30%"
}

/** Parse raw galleryJson — handles old string[] and new GalleryImage[] formats */
function parseGallery(raw: string): GalleryImage[] {
  try {
    const p = JSON.parse(raw)
    if (!Array.isArray(p)) return []
    return p.map((item) =>
      typeof item === 'string'
        ? { url: item, pos: '50% 50%' }
        : { url: item.url ?? '', pos: item.pos ?? '50% 50%' },
    )
  } catch {
    return []
  }
}

/** Parse "X% Y%" → [x, y] numbers */
function parsePos(pos: string): [number, number] {
  const parts = (pos || '50% 50%').split(' ')
  return [parseFloat(parts[0]) || 50, parseFloat(parts[1]) || 50]
}

export interface SpecTable {
  columns: string[]
  rows:    string[][]
}

function defaultSpecs(): SpecTable {
  return { columns: ['規格項目', '規格值'], rows: [] }
}

function parseSpecs(raw: string): SpecTable {
  if (!raw) return defaultSpecs()
  try {
    const p = JSON.parse(raw)
    if (p && Array.isArray(p.columns) && Array.isArray(p.rows)) return p as SpecTable
  } catch {}
  return defaultSpecs()
}

interface CatalogItem {
  code: string
  name: string          // ERP 品名
  officialName?: string // 官方標準名（有值時優先顯示）
  erpPending?: boolean  // ERP 還沒有料號（code 為暫時代號）
  brand: string
  productType: string   // 商品型態(9 種)
  category: string      // 功能分類(62 種)
  mainCategory?: string // 主分類(11 種)
  seriesName?: string   // 總表系列
  needsReview?: boolean // 分類待確認
  price?: number      // 有效售價（中央覆寫優先、目錄基準價次之）
  basePrice?: number | null
  priceSource?: 'override' | 'catalog' | 'unset'
  salePrice?: number
  spec?: string
  discontinued?: boolean
  status?: string   // 已停售／未販售
  disabled?: boolean // 中央管理人工停用（可恢復）
  imageUrl?: string   // Notion 富內容圖片索引
}

interface FamilySpec {
  key: string
  label: string
  options: string[]
}

interface ProductFamily {
  id: string
  seriesCode: string
  seriesName: string
  brand: string
  productType: string
  category: string
  specs: FamilySpec[]
  skuMap?: Record<string, string>
  skuNameMap?: Record<string, string>
  skuPattern?: string
  namePattern?: string
  uiVariant?: string
  coveredSkuCodes?: string[]
  manualAssignedSkuCodes?: string[]
  unavailableSkuCodes?: string[]
  source?: 'catalog' | 'notion'
}

interface RichData {
  notionId: string | null
  price: number | null
  imageUrl: string
  description: string
}

// ── Props ─────────────────────────────────────────────────────

interface Props {
  taxonomy: TaxonomyBrowser
  canManageProducts: boolean
}

// 主分類→功能分類主樹(伺服器端由 data/product-taxonomy.json + catalog 計數而來)
interface TaxonomyFunc { id: string; name: string; count: number }
interface TaxonomyMain { id: string; name: string; count: number; funcs: TaxonomyFunc[] }
interface TaxonomyBrowser {
  version: string
  mains: TaxonomyMain[]
  productForms: { name: string; count: number }[]
}

interface CategorySelection {
  main: string
  category?: string
}

// ── Client-side compression (keeps payload under Vercel's 4.5MB limit) ──────

/**
 * Compress image before upload.
 * - Normalizes every upload to a 1200 × 1200 square canvas
 * - Keeps the full image visible with contain-style scaling (no crop)
 * - Fills white background (so PNG transparency becomes white, not black/transparent)
 * - Outputs as JPEG at the given quality
 * Always runs (even on small files) so the white-background conversion always applies.
 */
async function compressForUpload(file: File, quality = 0.85): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      if (Math.min(img.width, img.height) < 600) {
        reject(new Error('圖片解析度不足，寬與高都需要至少 600px'))
        return
      }
      const outputSize = 1200
      const scale = Math.min(outputSize / img.width, outputSize / img.height)
      const w = Math.round(img.width  * scale)
      const h = Math.round(img.height * scale)
      const x = Math.round((outputSize - w) / 2)
      const y = Math.round((outputSize - h) / 2)
      const canvas = document.createElement('canvas')
      canvas.width  = outputSize
      canvas.height = outputSize
      const ctx = canvas.getContext('2d')!
      // ① White background — handles PNG transparency
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, outputSize, outputSize)
      // ② Center the complete image on the square canvas without cropping
      ctx.drawImage(img, x, y, w, h)
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }))
          else reject(new Error('壓縮失敗'))
        },
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('圖片讀取失敗')) }
    img.src = URL.createObjectURL(file)
  })
}

/** Fetch wrapper that always returns parsed JSON and a clear error string */
async function postForm(url: string, fd: FormData): Promise<{ ok: boolean; data: any; errMsg: string }> {
  try {
    const res  = await fetch(url, { method: 'POST', body: fd })
    const text = await res.text()
    let data: any = {}
    try { data = JSON.parse(text) } catch {
      // Server returned non-JSON (e.g. Vercel HTML 413 page)
      data = { error: `伺服器錯誤（HTTP ${res.status}）` }
    }
    return { ok: res.ok, data, errMsg: res.ok ? '' : (data.error ?? `上傳失敗（${res.status}）`) }
  } catch (err: any) {
    return { ok: false, data: {}, errMsg: err.message ?? '網路中斷，請稍後再試' }
  }
}

// ── Image Upload Zone (drag-and-drop) ────────────────────────

function ImageUploadZone({
  imageUrl,
  onUrlChange,
  disabled,
}: {
  imageUrl: string
  onUrlChange: (url: string) => void
  disabled: boolean
}) {
  const [tab,       setTab]       = useState<'upload' | 'url'>('upload')
  const [dragging,  setDragging]  = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress,  setProgress]  = useState(0)
  const [imgError,  setImgError]  = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const previewUrl = imageUrl.trim()

  const uploadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setUploadErr('只支援圖片格式（JPG、PNG、WebP、GIF）')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadErr('圖片大小不能超過 10 MB')
      return
    }
    setUploadErr('')
    setUploading(true)
    setProgress(10)

    const interval = setInterval(() => {
      setProgress((p) => Math.min(p + 12, 80))
    }, 200)

    try {
      // Compress large images before upload (Vercel body limit: 4.5 MB)
      const toUpload = await compressForUpload(file)
      const fd = new FormData()
      fd.append('file', toUpload)

      const { ok, data, errMsg } = await postForm('/api/products/upload-image', fd)
      clearInterval(interval)

      if (!ok) {
        setUploadErr(errMsg)
      } else {
        setProgress(100)
        onUrlChange(data.url)
        setImgError(false)
        setTimeout(() => setProgress(0), 600)
      }
    } catch (err: any) {
      clearInterval(interval)
      setUploadErr(err.message ?? '上傳失敗，請稍後再試')
    } finally {
      setUploading(false)
    }
  }, [onUrlChange])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }, [uploadFile])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadFile(file)
    e.target.value = ''
  }

  return (
    <div>
      <div className="mb-3 flex w-fit gap-1 rounded-full bg-stone-100 p-1">
        {(['upload', 'url'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={[
              'min-h-10 rounded-full px-4 py-1.5 text-xs font-semibold transition-all active:scale-95',
              tab === t ? 'bg-white shadow text-stone-900' : 'text-stone-500 hover:text-stone-700',
            ].join(' ')}
          >
            {t === 'upload' ? '📁 上傳圖片' : '🔗 貼入網址'}
          </button>
        ))}
      </div>

      {tab === 'upload' ? (
        <>
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !disabled && !uploading && fileRef.current?.click()}
            onKeyDown={(event) => {
              if (disabled || uploading || (event.key !== 'Enter' && event.key !== ' ')) return
              event.preventDefault()
              fileRef.current?.click()
            }}
            role="button"
            tabIndex={disabled || uploading ? -1 : 0}
            aria-label={previewUrl ? '更換商品圖片' : '上傳商品圖片'}
            aria-disabled={disabled || uploading}
            className={[
              'relative w-full rounded-2xl border-2 border-dashed transition cursor-pointer overflow-hidden',
              dragging  ? 'border-brand-400 bg-brand-50 scale-[1.01]' :
              uploading ? 'border-brand-300 bg-brand-50 cursor-default' :
                          'border-stone-200 bg-stone-50 hover:border-brand-300 hover:bg-brand-50/40',
              disabled  ? 'opacity-50 pointer-events-none' : '',
            ].join(' ')}
            style={{ minHeight: 180 }}
          >
            {/* Progress bar */}
            {uploading && progress > 0 && (
              <div className="absolute top-0 left-0 h-1 bg-brand-400 rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }} />
            )}

            {previewUrl && !imgError ? (
              /* Preview — white background handles PNG transparency */
              <div className="relative bg-white">
                <img
                  src={previewUrl}
                  alt="商品圖片"
                  className="w-full object-contain max-h-56"
                  onError={() => setImgError(true)}
                />
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition flex items-center justify-center">
                  <span className="text-white text-sm font-medium opacity-0 hover:opacity-100 bg-black/50 px-3 py-1 rounded-full">
                    點擊或拖曳更換
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 py-10 px-4">
                {uploading ? (
                  <>
                    <svg className="animate-spin motion-reduce:animate-none h-8 w-8 text-brand-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    <span className="text-sm text-brand-500 font-medium">上傳中…</span>
                  </>
                ) : dragging ? (
                  <>
                    <span className="text-4xl">📥</span>
                    <span className="text-sm font-semibold text-brand-600">放開以上傳</span>
                  </>
                ) : (
                  <>
                    <span className="text-4xl text-stone-300">🖼</span>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-stone-600">拖曳圖片到這裡</p>
                      <p className="text-xs text-stone-400 mt-1">或點擊選擇檔案</p>
                    </div>
                    <span className="text-xs text-stone-300 bg-white border border-stone-200 px-3 py-1 rounded-full">
                      JPG / PNG / WebP · 最大 5 MB
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />

          {uploadErr && (
            <p className="mt-2 text-xs text-red-500" role="alert">{uploadErr}</p>
          )}
          {previewUrl && !imgError && (
            <button
              type="button"
              onClick={() => { onUrlChange(''); setImgError(false) }}
              className="mt-2 text-xs text-stone-400 hover:text-red-500 transition"
            >
              ✕ 移除圖片
            </button>
          )}
        </>
      ) : (
        /* URL tab */
        <>
          {previewUrl && !imgError && (
            <div className="mb-3 w-full h-44 rounded-2xl overflow-hidden bg-stone-50 border border-stone-200">
              <img src={previewUrl} alt="預覽" className="w-full h-full object-contain"
                onError={() => setImgError(true)} />
            </div>
          )}
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => { onUrlChange(e.target.value); setImgError(false) }}
            placeholder="貼上圖片網址（https://…）"
            aria-label="商品圖片網址"
            className="input-soft min-h-11 w-full text-sm"
            disabled={disabled}
          />
          <p className="text-xs text-stone-400 mt-1.5">
            可貼入 Google Drive 公開連結、Notion 附件連結或任何公開圖片 URL。
          </p>
        </>
      )}
    </div>
  )
}

// ── Multi-Image Upload Zone ──────────────────────────────────────

type UploadTask = {
  id:      string
  preview: string  // object URL for thumbnail preview
  status:  'compressing' | 'uploading' | 'done' | 'error'
  errMsg?: string
}

function MultiImageUploadZone({
  images,
  onAddImage,
  onRemoveImage,
  onReorder,
  disabled,
}: {
  images:        GalleryImage[]
  onAddImage:    (img: GalleryImage) => void
  onRemoveImage: (index: number) => void
  onReorder:     (newImages: GalleryImage[]) => void
  disabled:      boolean
}) {
  const [dragging,   setDragging]   = useState(false)
  const [tasks,      setTasks]      = useState<UploadTask[]>([])
  const [dragSrc,    setDragSrc]    = useState<number | null>(null)
  const [dragOver,   setDragOver]   = useState<number | null>(null)
  const [posEditIdx, setPosEditIdx] = useState<number | null>(null)  // which thumb is in position-edit mode
  const fileRef    = useRef<HTMLInputElement>(null)
  const counterRef = useRef(0)

  function updateTask(id: string, patch: Partial<UploadTask>) {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t))
  }
  function removeTask(id: string) {
    setTasks((prev) => {
      const t = prev.find((t) => t.id === id)
      if (t?.preview) URL.revokeObjectURL(t.preview)
      return prev.filter((t) => t.id !== id)
    })
  }

  const processFiles = useCallback(async (fileList: File[]) => {
    const valid = fileList.filter((f) => f.type.startsWith('image/') && f.size <= 10 * 1024 * 1024)
    if (!valid.length) return

    const newTasks: UploadTask[] = valid.map((f) => ({
      id:      String(++counterRef.current),
      preview: URL.createObjectURL(f),
      status:  'compressing' as const,
    }))
    setTasks((prev) => [...prev, ...newTasks])

    // Upload sequentially — safer than parallel for Vercel serverless
    for (let i = 0; i < valid.length; i++) {
      const file = valid[i]
      const task = newTasks[i]
      try {
        updateTask(task.id, { status: 'compressing' })
        const compressed = await compressForUpload(file)

        updateTask(task.id, { status: 'uploading' })
        const fd = new FormData()
        fd.append('file', compressed)
        const { ok, data, errMsg } = await postForm('/api/products/upload-image', fd)

        if (!ok) {
          updateTask(task.id, { status: 'error', errMsg })
        } else {
          updateTask(task.id, { status: 'done' })
          onAddImage({ url: data.url, pos: '50% 50%' })
          // Fade out the task card after brief success pause
          setTimeout(() => removeTask(task.id), 900)
        }
      } catch (err: any) {
        updateTask(task.id, { status: 'error', errMsg: err.message ?? '上傳失敗' })
      }
    }
  }, [onAddImage])

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    // Only handle external file drops; internal reorder is handled by thumbnails
    if (!e.dataTransfer.types.includes('Files')) return
    processFiles(Array.from(e.dataTransfer.files))
  }, [processFiles])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(Array.from(e.target.files))
    e.target.value = ''
  }

  // Reorder helpers
  function doReorder(srcIdx: number, destIdx: number) {
    if (srcIdx === destIdx) return
    const next = [...images]
    const [removed] = next.splice(srcIdx, 1)
    next.splice(destIdx, 0, removed)
    onReorder(next)
  }

  // Position-edit drag: mouse down on a thumbnail in posEditMode
  function handlePosMouseDown(e: React.MouseEvent<HTMLDivElement>, idx: number) {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    const [origX, origY] = parsePos(images[idx].pos)
    const startX = e.clientX
    const startY = e.clientY

    function onMove(me: MouseEvent) {
      const dx = me.clientX - startX
      const dy = me.clientY - startY
      // Drag the full container width/height = 100% change in position
      const sensX = 100 / rect.width
      const sensY = 100 / rect.height
      const newX = Math.max(0, Math.min(100, origX - dx * sensX))
      const newY = Math.max(0, Math.min(100, origY - dy * sensY))
      const newPos = `${newX.toFixed(1)}% ${newY.toFixed(1)}%`
      onReorder(images.map((img, i) => i === idx ? { ...img, pos: newPos } : img))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const isEmpty      = images.length === 0 && tasks.length === 0
  const isUploading  = tasks.some((t) => t.status === 'compressing' || t.status === 'uploading')

  return (
    <div>
      {/* Drop zone — only for external file drags */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          // Only light up for external file drags, not internal reorder drags
          if (e.dataTransfer.types.includes('Files')) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleFileDrop}
        onClick={() => !disabled && !isUploading && fileRef.current?.click()}
        onKeyDown={(event) => {
          if (disabled || isUploading || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          fileRef.current?.click()
        }}
        role="button"
        tabIndex={disabled || isUploading ? -1 : 0}
        aria-label="上傳多張形象素材"
        aria-disabled={disabled || isUploading}
        className={[
          'relative w-full rounded-2xl border-2 border-dashed transition',
          disabled || isUploading ? 'cursor-default' : 'cursor-pointer',
          dragging   ? 'border-brand-400 bg-brand-50 scale-[1.01]' :
          isUploading ? 'border-brand-300 bg-brand-50' :
                        'border-stone-200 bg-stone-50 hover:border-brand-300 hover:bg-brand-50/40',
          disabled   ? 'opacity-50 pointer-events-none' : '',
        ].join(' ')}
        style={{ minHeight: isEmpty ? 140 : 64 }}
      >
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8 px-4">
            {dragging ? (
              <>
                <span className="text-4xl">📥</span>
                <span className="text-sm font-semibold text-brand-600">放開以上傳</span>
              </>
            ) : (
              <>
                <span className="text-4xl text-stone-300">🗂</span>
                <div className="text-center">
                  <p className="text-sm font-semibold text-stone-600">拖曳多張圖片到這裡</p>
                  <p className="text-xs text-stone-400 mt-1">或點擊選擇檔案（可複選）</p>
                </div>
                <span className="text-xs text-stone-300 bg-white border border-stone-200 px-3 py-1 rounded-full">
                  JPG / PNG / WebP · 支援批次上傳
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-4 px-4">
            {isUploading ? (
              <>
                <svg className="animate-spin motion-reduce:animate-none h-4 w-4 text-brand-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span className="text-sm text-brand-500 font-medium">上傳中，請稍候…</span>
              </>
            ) : dragging ? (
              <>
                <span className="text-lg">📥</span>
                <span className="text-sm font-semibold text-brand-600">放開以繼續上傳</span>
              </>
            ) : (
              <>
                <span className="text-base text-stone-400">＋</span>
                <span className="text-sm font-medium text-stone-500">繼續新增圖片</span>
              </>
            )}
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Thumbnail grid */}
      {(images.length > 0 || tasks.length > 0) && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {/* Saved images — draggable to reorder, click ⊕ to adjust position */}
          {images.map((img, i) => {
            const isPosEdit = posEditIdx === i
            return (
              <div
                key={`${img.url}-${i}`}
                draggable={!disabled && !isPosEdit}
                onDragStart={(e) => {
                  if (isPosEdit) { e.preventDefault(); return }
                  setDragSrc(i)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('application/x-gallery-reorder', String(i))
                }}
                onDragOver={(e) => {
                  e.preventDefault(); e.stopPropagation()
                  if (dragSrc === null || dragSrc === i) return
                  setDragOver(i)
                }}
                onDragLeave={(e) => { e.stopPropagation(); setDragOver(null) }}
                onDrop={(e) => {
                  e.preventDefault(); e.stopPropagation()
                  if (dragSrc !== null) doReorder(dragSrc, i)
                  setDragSrc(null); setDragOver(null)
                }}
                onDragEnd={() => { setDragSrc(null); setDragOver(null) }}
                // Position-edit: mouse down anywhere in the thumb drags the focal point
                onMouseDown={isPosEdit ? (e) => handlePosMouseDown(e, i) : undefined}
                className={[
                  'group relative aspect-square rounded-xl overflow-hidden bg-white border transition-all select-none',
                  isPosEdit
                    ? 'ring-2 ring-brand-500 border-brand-400 cursor-move'
                    : disabled
                    ? 'cursor-default border-stone-200'
                    : dragSrc === i
                    ? 'opacity-40 scale-95 border-brand-300 border-dashed cursor-grabbing'
                    : dragOver === i
                    ? 'ring-2 ring-brand-400 ring-offset-1 scale-[1.04] border-brand-300 cursor-grab'
                    : 'border-stone-200 cursor-grab active:cursor-grabbing',
                ].join(' ')}
              >
                <img
                  src={img.url}
                  alt={`形象素材 ${i + 1}`}
                  className="w-full h-full object-cover pointer-events-none"
                  style={{ objectPosition: img.pos }}
                />

                {/* ── Hover controls (hidden in pos-edit mode) ── */}
                {!isPosEdit && (
                  <>
                    {/* Drag handle (top-left) */}
                    <div className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 transition pointer-events-none">
                      <div className="rounded-full bg-black/40 px-1 py-0.5 text-[10px] leading-none text-white">⠿</div>
                    </div>
                    {/* Delete (top-right) */}
                    <button
                      type="button"
                      onClick={() => onRemoveImage(i)}
                      disabled={disabled}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px]
                                 flex items-center justify-center opacity-0 group-hover:opacity-100 transition
                                 hover:bg-red-500 disabled:hidden"
                    >✕</button>
                    {/* Position-edit button (bottom-right) */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setPosEditIdx(i) }}
                      disabled={disabled}
                      title="調整圖片顯示位置"
                      className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white text-[11px]
                                 flex items-center justify-center opacity-0 group-hover:opacity-100 transition
                                 hover:bg-brand-500 disabled:hidden"
                    >⊕</button>
                    {/* Order badge (bottom-left) */}
                    <div className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-black/40 px-1 py-0.5 text-[9px] text-white">
                      {i + 1}
                    </div>
                  </>
                )}

                {/* ── Position-edit mode overlay ── */}
                {isPosEdit && (
                  <>
                    <div className="absolute inset-0 bg-brand-900/10 pointer-events-none" />
                    <div className="absolute top-1 left-1 right-1 flex items-center justify-between pointer-events-none">
                      <span className="rounded-full bg-brand-600/90 px-1.5 py-0.5 text-[9px] font-medium text-white">
                        拖曳調整位置
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setPosEditIdx(null) }}
                      className="absolute bottom-1 right-1 bg-brand-600 text-white text-[9px] px-2 py-0.5
                                 rounded-full font-medium hover:bg-brand-700 transition"
                    >
                      完成
                    </button>
                  </>
                )}
              </div>
            )
          })}

          {/* Uploading tasks */}
          {tasks.map((task) => (
            <div key={task.id}
              className="relative aspect-square rounded-xl overflow-hidden bg-white border border-stone-200">
              <img src={task.preview} alt="上傳中" className="w-full h-full object-cover" />
              {/* Status overlay */}
              <div className={[
                'absolute inset-0 flex flex-col items-center justify-center gap-1',
                task.status === 'error' ? 'bg-red-900/65' :
                task.status === 'done'  ? 'bg-brand-900/50' :
                                          'bg-black/55',
              ].join(' ')}>
                {(task.status === 'compressing' || task.status === 'uploading') && (
                  <svg className="animate-spin motion-reduce:animate-none h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                )}
                {task.status === 'done' && (
                  <span className="text-white text-xl font-bold">✓</span>
                )}
                {task.status === 'error' && (
                  <>
                    <span className="text-white text-lg">✕</span>
                    <button type="button" onClick={() => removeTask(task.id)}
                      className="text-[10px] text-white/80 hover:text-white underline mt-0.5">
                      移除
                    </button>
                  </>
                )}
              </div>
              {/* Status label */}
              <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-0.5">
                <p className="text-[9px] text-white text-center truncate">
                  {task.status === 'compressing' ? '壓縮中…' :
                   task.status === 'uploading'   ? '上傳中…' :
                   task.status === 'done'         ? '完成' :
                   (task.errMsg ?? '失敗')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <p className="mt-1.5 text-[11px] text-stone-400">
          已上傳 {images.length} 張
          {images.length > 1 && '・拖曳排列順序'}
          ・點 ⊕ 調整顯示位置・PNG 自動轉白底
        </p>
      )}
    </div>
  )
}

// ── Document Upload Zone ──────────────────────────────────────

export interface DocFile {
  name: string
  url:  string
  size: number   // bytes
}

type DocTask = {
  id:      string
  name:    string
  size:    number
  status:  'uploading' | 'done' | 'error'
  errMsg?: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024)             return `${bytes} B`
  if (bytes < 1024 * 1024)     return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function docIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf')                       return '📕'
  if (['doc', 'docx'].includes(ext))       return '📝'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊'
  if (['ppt', 'pptx'].includes(ext))       return '📋'
  if (['zip', 'rar', '7z'].includes(ext))  return '🗜'
  if (ext === 'txt')                       return '📄'
  return '📎'
}

function DocUploadZone({
  docs,
  onAddDoc,
  onRemoveDoc,
  disabled,
}: {
  docs:        DocFile[]
  onAddDoc:    (doc: DocFile) => void
  onRemoveDoc: (index: number) => void
  disabled:    boolean
}) {
  const [dragging,  setDragging]  = useState(false)
  const [tasks,     setTasks]     = useState<DocTask[]>([])
  const fileRef     = useRef<HTMLInputElement>(null)
  const counterRef  = useRef(0)

  function updateTask(id: string, patch: Partial<DocTask>) {
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t))
  }
  function removeTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }

  const processFiles = useCallback(async (fileList: File[]) => {
    // Basic client-side validation
    const ALLOWED_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rar', '7z'])
    const valid = fileList.filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      return ALLOWED_EXT.has(ext) && f.size <= 4 * 1024 * 1024
    })
    const tooLarge = fileList.filter((f) => f.size > 4 * 1024 * 1024)

    // Show size-limit errors immediately as failed tasks
    if (tooLarge.length) {
      const errTasks: DocTask[] = tooLarge.map((f) => ({
        id:     String(++counterRef.current),
        name:   f.name,
        size:   f.size,
        status: 'error',
        errMsg: `超過 4 MB 限制（${formatFileSize(f.size)}）`,
      }))
      setTasks((prev) => [...prev, ...errTasks])
    }
    if (!valid.length) return

    const newTasks: DocTask[] = valid.map((f) => ({
      id:     String(++counterRef.current),
      name:   f.name,
      size:   f.size,
      status: 'uploading',
    }))
    setTasks((prev) => [...prev, ...newTasks])

    for (let i = 0; i < valid.length; i++) {
      const file = valid[i]
      const task = newTasks[i]
      try {
        const fd = new FormData()
        fd.append('file', file)
        const { ok, data, errMsg } = await postForm('/api/products/upload-doc', fd)
        if (!ok) {
          updateTask(task.id, { status: 'error', errMsg })
        } else {
          updateTask(task.id, { status: 'done' })
          onAddDoc({ name: file.name, url: data.url, size: file.size })
          setTimeout(() => removeTask(task.id), 1000)
        }
      } catch (err: any) {
        updateTask(task.id, { status: 'error', errMsg: err.message ?? '上傳失敗' })
      }
    }
  }, [onAddDoc])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    processFiles(Array.from(e.dataTransfer.files))
  }, [processFiles])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) processFiles(Array.from(e.target.files))
    e.target.value = ''
  }

  const isUploading = tasks.some((t) => t.status === 'uploading')
  const isEmpty     = docs.length === 0 && tasks.length === 0

  return (
    <div>
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && !isUploading && fileRef.current?.click()}
        onKeyDown={(event) => {
          if (disabled || isUploading || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          fileRef.current?.click()
        }}
        role="button"
        tabIndex={disabled || isUploading ? -1 : 0}
        aria-label="上傳產品文件"
        aria-disabled={disabled || isUploading}
        className={[
          'relative w-full rounded-2xl border-2 border-dashed transition',
          disabled || isUploading ? 'cursor-default' : 'cursor-pointer',
          dragging    ? 'border-brand-400 bg-brand-50 scale-[1.01]' :
          isUploading ? 'border-brand-300 bg-brand-50' :
                        'border-stone-200 bg-stone-50 hover:border-brand-300 hover:bg-brand-50/40',
          disabled    ? 'opacity-50 pointer-events-none' : '',
        ].join(' ')}
        style={{ minHeight: isEmpty ? 120 : 56 }}
      >
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center gap-2.5 py-7 px-4">
            {dragging ? (
              <>
                <span className="text-4xl">📥</span>
                <span className="text-sm font-semibold text-brand-600">放開以上傳</span>
              </>
            ) : (
              <>
                <span className="text-3xl text-stone-300">📁</span>
                <div className="text-center">
                  <p className="text-sm font-semibold text-stone-600">拖曳文件到這裡</p>
                  <p className="text-xs text-stone-400 mt-0.5">或點擊選擇檔案</p>
                </div>
                <span className="text-xs text-stone-300 bg-white border border-stone-200 px-3 py-1 rounded-full">
                  PDF · Word · Excel · PPT · ZIP · 最大 4 MB
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-3.5 px-4">
            {isUploading ? (
              <>
                <svg className="animate-spin motion-reduce:animate-none h-4 w-4 text-brand-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span className="text-sm text-brand-500 font-medium">上傳中，請稍候…</span>
              </>
            ) : dragging ? (
              <>
                <span>📥</span>
                <span className="text-sm font-semibold text-brand-600">放開以繼續上傳</span>
              </>
            ) : (
              <>
                <span className="text-stone-400">＋</span>
                <span className="text-sm font-medium text-stone-500">繼續上傳文件</span>
              </>
            )}
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* File list */}
      {(docs.length > 0 || tasks.length > 0) && (
        <div className="mt-2 rounded-xl border border-stone-200 overflow-hidden divide-y divide-stone-100">
          {/* Saved docs */}
          {docs.map((doc, i) => (
            <div key={`${doc.url}-${i}`}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-stone-50 group transition">
              <span className="text-xl shrink-0">{docIcon(doc.name)}</span>
              <div className="flex-1 min-w-0">
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-stone-800 hover:text-brand-600 hover:underline truncate block"
                  title={doc.name}
                >
                  {doc.name}
                </a>
                <p className="text-[11px] text-stone-400 mt-0.5">{formatFileSize(doc.size)}</p>
              </div>
              {/* Download */}
              <a
                href={doc.url}
                download={doc.name}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-500
                           hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition"
                title="下載"
              >
                ↓
              </a>
              {/* Delete */}
              <button
                type="button"
                onClick={() => onRemoveDoc(i)}
                disabled={disabled}
                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[11px]
                           text-stone-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100
                           transition disabled:hidden"
                title="移除"
              >✕</button>
            </div>
          ))}

          {/* Uploading tasks */}
          {tasks.map((task) => (
            <div key={task.id} className={[
              'flex items-center gap-3 px-3 py-2.5',
              task.status === 'error' ? 'bg-red-50' : 'bg-brand-50/40',
            ].join(' ')}>
              <span className="text-xl shrink-0">
                {task.status === 'uploading' ? (
                  <svg className="animate-spin motion-reduce:animate-none h-5 w-5 text-brand-400 mt-0.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : task.status === 'done' ? '✅' : '❌'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-stone-700 truncate">{task.name}</p>
                <p className="text-[11px] mt-0.5">
                  {task.status === 'uploading' ? (
                    <span className="text-brand-500">上傳中…</span>
                  ) : task.status === 'done' ? (
                    <span className="text-emerald-600">完成</span>
                  ) : (
                    <span className="text-red-500">{task.errMsg ?? '上傳失敗'}</span>
                  )}
                </p>
              </div>
              {task.status === 'error' && (
                <button type="button" onClick={() => removeTask(task.id)}
                  className="shrink-0 text-xs text-stone-400 hover:text-red-500 transition">
                  移除
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {docs.length > 0 && (
        <p className="mt-1.5 text-[11px] text-stone-400">
          {docs.length} 份文件・點擊檔名或 ↓ 下載
        </p>
      )}
    </div>
  )
}

// ── Specs Editor ──────────────────────────────────────────────

function SpecsEditor({
  specs,
  onChange,
  disabled,
}: {
  specs:    SpecTable
  onChange: (s: SpecTable) => void
  disabled: boolean
}) {
  const cellRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const colCount = specs.columns.length
  const rowCount = specs.rows.length

  function regRef(ri: number, ci: number, el: HTMLInputElement | null) {
    const key = `${ri}-${ci}`
    if (el) cellRefs.current.set(key, el)
    else cellRefs.current.delete(key)
  }
  function focusCell(ri: number, ci: number) {
    setTimeout(() => cellRefs.current.get(`${ri}-${ci}`)?.focus(), 30)
  }

  // ── Column ops ────────────────────────────────────────────
  function updateCol(ci: number, val: string) {
    onChange({ ...specs, columns: specs.columns.map((c, i) => i === ci ? val : c) })
  }
  function addCol() {
    onChange({
      columns: [...specs.columns, `欄位 ${colCount + 1}`],
      rows:    specs.rows.map(r => [...r, '']),
    })
  }
  function removeCol(ci: number) {
    if (colCount <= 1) return
    onChange({
      columns: specs.columns.filter((_, i) => i !== ci),
      rows:    specs.rows.map(r => r.filter((_, i) => i !== ci)),
    })
  }

  // ── Row ops ───────────────────────────────────────────────
  function updateCell(ri: number, ci: number, val: string) {
    onChange({
      ...specs,
      rows: specs.rows.map((r, i) =>
        i === ri ? r.map((c, j) => j === ci ? val : c) : r
      ),
    })
  }
  function addRow(focusAfter = false) {
    const newRowIdx = rowCount
    onChange({ ...specs, rows: [...specs.rows, Array(colCount).fill('')] })
    if (focusAfter) focusCell(newRowIdx, 0)
  }
  function removeRow(ri: number) {
    onChange({ ...specs, rows: specs.rows.filter((_, i) => i !== ri) })
  }

  // Tab key: move to next cell, or create new row on last cell
  function handleCellTab(e: React.KeyboardEvent, ri: number, ci: number) {
    if (e.key !== 'Tab') return
    e.preventDefault()
    if (ci + 1 < colCount) {
      focusCell(ri, ci + 1)
    } else if (ri + 1 < rowCount) {
      focusCell(ri + 1, 0)
    } else {
      addRow(true)
    }
  }

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${colCount}, minmax(96px, 1fr)) 44px`,
  }

  const hdrInput = [
    'w-full px-2.5 py-2 text-xs font-semibold text-stone-600 bg-transparent',
    'min-h-11 rounded-2xl border-0 focus:outline-none focus:bg-brand-50/70',
    'placeholder:text-stone-300 disabled:opacity-50',
  ].join(' ')

  const cellInput = [
    'w-full px-2.5 py-2 text-sm text-stone-800 bg-transparent',
    'min-h-11 rounded-2xl border-0 focus:outline-none focus:bg-brand-50/70',
    'placeholder:text-stone-300 disabled:opacity-50',
  ].join(' ')

  return (
    <div>
      <div className="overflow-x-auto rounded-2xl ring-1 ring-stone-900/[0.06]">

        {/* ── Header row ─────────────────────────────────────── */}
        <div style={gridStyle} className="bg-stone-50 border-b border-stone-200">
          {specs.columns.map((col, ci) => (
            <div key={ci} className="relative group flex items-center border-r border-stone-200"
              style={ci === colCount - 1 ? { borderRight: 'none' } : {}}>
              <input
                value={col}
                onChange={e => updateCol(ci, e.target.value)}
                className={hdrInput}
                placeholder={`欄 ${ci + 1}`}
                disabled={disabled}
              />
              {/* Delete column — appears on hover, only when >1 col */}
              {colCount > 1 && (
                <button
                  type="button"
                  onClick={() => removeCol(ci)}
                  disabled={disabled}
                  title="刪除此欄"
                  aria-label={`刪除第 ${ci + 1} 欄`}
                  className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-full
                             text-xs leading-none text-stone-300 transition-all hover:bg-red-50 hover:text-red-500
                             opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 active:scale-95 disabled:hidden"
                >✕</button>
              )}
            </div>
          ))}
          {/* Add column */}
          <div className="flex items-center justify-center border-l border-stone-200">
            <button
              type="button"
              onClick={addCol}
              disabled={disabled}
              title="新增欄"
              aria-label="新增規格欄"
              className="flex h-11 w-11 items-center justify-center rounded-full
                         text-sm font-bold leading-none text-stone-400 transition-all
                         hover:bg-brand-50 hover:text-brand-600 active:scale-95 disabled:opacity-30"
            >＋</button>
          </div>
        </div>

        {/* ── Data rows ──────────────────────────────────────── */}
        {specs.rows.map((row, ri) => (
          <div key={ri} style={gridStyle}
            className="group border-b border-stone-100 last:border-0 hover:bg-stone-50/60 transition-colors">
            {row.map((cell, ci) => (
              <div key={ci} className="border-r border-stone-100"
                style={ci === colCount - 1 ? { borderRight: 'none' } : {}}>
                <input
                  ref={el => regRef(ri, ci, el)}
                  value={cell}
                  onChange={e => updateCell(ri, ci, e.target.value)}
                  onKeyDown={e => handleCellTab(e, ri, ci)}
                  className={cellInput}
                  placeholder="—"
                  disabled={disabled}
                />
              </div>
            ))}
            {/* Delete row — appears on hover */}
            <div className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => removeRow(ri)}
                disabled={disabled}
                title="刪除此列"
                aria-label={`刪除第 ${ri + 1} 列`}
                className="flex h-11 w-11 items-center justify-center rounded-full text-[11px] leading-none
                           text-stone-300 opacity-100 transition-all hover:bg-red-50 hover:text-red-500
                           sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus:opacity-100 active:scale-95 disabled:hidden"
              >✕</button>
            </div>
          </div>
        ))}

        {/* ── Empty state ────────────────────────────────────── */}
        {rowCount === 0 && (
          <div className="py-5 text-center text-xs text-stone-400 select-none">
            尚無規格，點擊下方「新增列」開始填寫
          </div>
        )}
      </div>

      {/* Add row */}
      <button
        type="button"
        onClick={() => addRow(true)}
        disabled={disabled}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600
                   hover:text-brand-700 transition disabled:opacity-40"
      >
        <span className="text-base leading-none">＋</span> 新增列
      </button>
    </div>
  )
}

// ── Product Edit Drawer ───────────────────────────────────────

export function ProductEditDrawer({
  skuCode,
  onClose,
  onSaved,
  onFamilyChanged,
  allFamilies,
}: {
  skuCode: string
  onClose: () => void
  onSaved: (skuCode: string, price: number | null, disabled: boolean, priceSource: CatalogItem['priceSource'], imageUrl: string) => void
  onFamilyChanged: () => Promise<void>
  allFamilies: ProductFamily[]
}) {
  const [catalog, setCatalog] = useState<CatalogItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  // Form state
  const [imageUrl,      setImageUrl]      = useState('')
  const [description,   setDescription]   = useState('')
  const [specs,         setSpecs]         = useState<SpecTable>(defaultSpecs())
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([])
  const [docs,          setDocs]          = useState<DocFile[]>([])
  const [centralDisabled, setCentralDisabled] = useState(false)
  const [priceOverrideInput, setPriceOverrideInput] = useState('')

  // Family assignment state
  const [selectedFamilyId, setSelectedFamilyId] = useState('')
  const [originalFamilyId, setOriginalFamilyId] = useState('')
  const [familySaving,     setFamilySaving]      = useState(false)
  const [familySaved,      setFamilySaved]        = useState(false)
  const [familyError,      setFamilyError]        = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  useDialogFocus(dialogRef, onClose)
  useBodyScrollLock()

  useEffect(() => {
    setLoading(true)
    setError('')
    fetch(`/api/products/sku/${encodeURIComponent(skuCode)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return }
        setCatalog(data.catalog)
        setImageUrl(data.rich.imageUrl ?? '')
        setDescription(data.rich.description ?? '')
        setCentralDisabled(Boolean(data.catalog.disabled ?? data.rich.disabled))
        setPriceOverrideInput(data.rich.price != null ? String(data.rich.price) : '')
        setSpecs(parseSpecs(data.rich.specsJson ?? ''))
        setGalleryImages(parseGallery(data.rich.galleryJson ?? '[]'))
        const manualFamilyId = data.rich.familyId ?? ''
        const deployedFamilyId = allFamilies.find((family) => explicitFamilySkuCodes(family).includes(skuCode))?.id ?? ''
        setSelectedFamilyId(manualFamilyId)
        setOriginalFamilyId(manualFamilyId || deployedFamilyId)
        try {
          const parsed = JSON.parse(data.rich.docsJson ?? '[]')
          setDocs(Array.isArray(parsed) ? parsed : [])
        } catch {
          setDocs([])
        }
      })
      .catch(() => setError('無法載入商品資料'))
      .finally(() => setLoading(false))
  }, [allFamilies, skuCode])

  const handleSaveFamily = async (familyIdToSave: string) => {
    if (familyIdToSave !== originalFamilyId && originalFamilyId) {
      const previousName = allFamilies.find((family) => family.id === originalFamilyId)?.seriesName ?? originalFamilyId
      const nextName = allFamilies.find((family) => family.id === familyIdToSave)?.seriesName
      const message = familyIdToSave
        ? `此品項目前屬於「${previousName}」。確定要移到「${nextName ?? familyIdToSave}」嗎？`
        : `確定要清除「${previousName}」的手動歸類嗎？`
      if (!window.confirm(message)) return
    }
    setFamilySaving(true)
    setFamilyError('')
    setFamilySaved(false)
    try {
      const res = await fetch(`/api/products/sku/${encodeURIComponent(skuCode)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId: familyIdToSave }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        let msg = `儲存失敗（HTTP ${res.status}）`
        try { msg = JSON.parse(text)?.error ?? msg } catch {}
        setFamilyError(msg)
      } else {
        setSelectedFamilyId(familyIdToSave)
        setOriginalFamilyId(familyIdToSave)
        setFamilySaved(true)
        try {
          await onFamilyChanged()
        } catch {
          setFamilyError('歸類已儲存，但系列清單重新整理失敗；請重新載入頁面確認。')
        }
        setTimeout(() => setFamilySaved(false), 2000)
      }
    } catch (err: any) {
      setFamilyError(err.message ?? '網路中斷，請稍後再試')
    } finally {
      setFamilySaving(false)
    }
  }

  const handleSave = async () => {
    if (!catalog) {
      setError('產品資料尚未完整載入，請重新整理後再試')
      return
    }
    const trimmedPrice = priceOverrideInput.trim()
    const priceOverride = trimmedPrice ? Number(trimmedPrice) : null
    if (priceOverride != null && (!Number.isFinite(priceOverride) || priceOverride <= 0)) {
      setError('售價必須是大於 0 的數字；若要回到主檔售價請清空欄位')
      return
    }
    setSaving(true)
    setError('')
    // Only save specs if there's actual data (at least one non-empty row)
    const hasSpecs = specs.rows.some(r => r.some(c => c.trim()))
    const specsJson = hasSpecs ? JSON.stringify(specs) : ''
    const galleryJson = galleryImages.length > 0 ? JSON.stringify(galleryImages) : ''
    const docsJson    = docs.length > 0 ? JSON.stringify(docs) : ''
    let res: Response | null = null
    try {
      res = await fetch(`/api/products/sku/${encodeURIComponent(skuCode)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price: priceOverride, imageUrl: imageUrl.trim(), description, specsJson, galleryJson, docsJson, disabled: centralDisabled }),
      })
    } catch (err: any) {
      setError(err.message ?? '網路中斷，請稍後再試')
      setSaving(false)
      return
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let errMsg = `儲存失敗（HTTP ${res.status}）`
      try { errMsg = JSON.parse(text)?.error ?? errMsg } catch {}
      setError(errMsg)
      setSaving(false)
      return
    }
    const saved = await res.json().catch(() => null)
    setSaving(false)
    onSaved(
      skuCode,
      saved?.price ?? priceOverride ?? catalog.basePrice ?? null,
      centralDisabled,
      saved?.priceSource ?? (priceOverride != null ? 'override' : catalog.basePrice != null ? 'catalog' : 'unset'),
      imageUrl.trim(),
    )
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <motion.div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        initial={{ opacity: reduceMotion ? 1 : 0 }} animate={{ opacity: 1 }} exit={{ opacity: reduceMotion ? 1 : 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.2 }} onClick={onClose}
      />

      <motion.div
        ref={dialogRef}
        className="relative ml-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden bg-[#fdfdfb] shadow-2xl ring-1 ring-stone-900/[0.06] sm:rounded-l-3xl"
        initial={{ x: reduceMotion ? 0 : '100%' }} animate={{ x: 0 }} exit={{ x: reduceMotion ? 0 : '100%' }}
        transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-edit-title"
        tabIndex={-1}
      >
        {/* Header */}
        <div className="glass-bar flex items-start justify-between gap-4 border-b border-stone-900/[0.06] px-4 pb-4 pt-5 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-500 mb-1">編輯商品</p>
            <h2 id="product-edit-title" className="text-lg font-bold text-stone-800 leading-snug">
              {loading ? '載入中…' : (catalog?.name ?? skuCode)}
            </h2>
            <p className="text-xs font-mono text-stone-400 mt-0.5">{skuCode}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-dialog-initial-focus
            aria-label="關閉商品編輯"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-700 active:scale-95">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
          {error && (
            <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>
          )}

          {catalog && (
            <div className="rounded-2xl bg-stone-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-2">基本資料</p>
              {[['品牌', catalog.brand], ['分類', catalog.category], ['商品類型', catalog.productType]].map(
                ([label, val]) => val ? (
                  <div key={label} className="flex gap-3 text-sm py-1">
                    <span className="text-stone-400 w-20 shrink-0">{label}</span>
                    <span className="text-stone-700 font-medium">{val}</span>
                  </div>
                ) : null
              )}
            </div>
          )}

          <div className={`rounded-2xl p-4 ${centralDisabled ? 'bg-red-50' : 'bg-brand-50/70'}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">販售狀態</p>
                <p className={`mt-1 text-sm font-bold ${centralDisabled ? 'text-red-700' : 'text-emerald-700'}`}>
                  {centralDisabled ? PRODUCT_LABELS.paused : PRODUCT_LABELS.onSale}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={centralDisabled}
                aria-label={centralDisabled ? '恢復販售此商品' : '暫停販售此商品'}
                onClick={() => setCentralDisabled((current) => !current)}
                disabled={loading || saving || !catalog}
                className={`relative min-h-11 w-20 shrink-0 rounded-full p-1 transition-all active:scale-95 disabled:opacity-50 ${
                  centralDisabled ? 'bg-brand-500' : 'bg-stone-300'
                }`}
              >
                <span className={`block h-9 w-9 rounded-full bg-white shadow-md transition-transform ${centralDisabled ? 'translate-x-9' : 'translate-x-0'}`} />
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-stone-600">
              暫停販售後，一般產品頁、訂購、報價及促銷選品器都看不到這個品項；既有單據與產品資料不會刪除，可隨時恢復販售。
            </p>
            {catalog?.discontinued && (
              <p className="mt-2 rounded-2xl bg-white/70 px-3 py-2 text-xs text-red-600">
                此品項另有主檔狀態「{catalog.status || '已停售'}」，恢復販售不會解除主檔的停售狀態。
              </p>
            )}
          </div>

          {/* 系列群組 — family assignment */}
          <div className="mb-0 rounded-2xl bg-stone-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">系列群組</p>
            <div className="space-y-3">
              <select
                id="product-family-group"
                value={selectedFamilyId}
                onChange={(e) => setSelectedFamilyId(e.target.value)}
                disabled={loading || familySaving || !catalog}
                aria-label="系列群組"
                className="select-soft min-h-11 w-full text-sm disabled:opacity-50"
              >
                <option value="">— 未指定（依貨號自動歸類）—</option>
                {[...allFamilies].sort((a, b) => a.seriesName.localeCompare(b.seriesName, 'zh-TW')).map((f) => (
                  <option key={f.id} value={f.id}>{f.seriesName} ({f.brand})</option>
                ))}
              </select>

              {familyError && (
                <p className="text-xs text-red-500" role="alert">{familyError}</p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSaveFamily(selectedFamilyId)}
                  disabled={loading || familySaving || !catalog}
                  className="flex min-h-11 items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50"
                >
                  {familySaving ? (
                    <>
                      <svg className="animate-spin motion-reduce:animate-none h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                      儲存中…
                    </>
                  ) : familySaved ? '✓ 已儲存' : '儲存群組設定'}
                </button>

                {selectedFamilyId && (
                  <button
                    type="button"
                    onClick={() => handleSaveFamily('')}
                    disabled={loading || familySaving || !catalog}
                    className="min-h-11 rounded-full border border-stone-200 bg-white px-4 py-2 text-xs font-medium text-stone-500 transition-all hover:border-red-300 hover:bg-red-50 hover:text-red-500 active:scale-95 disabled:opacity-50"
                  >
                    清除手動指定
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 中央管理售價覆寫；清空後回到 Excel/目錄主檔售價。 */}
          <div className="rounded-2xl bg-stone-50 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label htmlFor="product-price-override" className="text-xs font-semibold uppercase tracking-widest text-stone-400">手動調價</label>
                <div className="relative mt-2">
                  <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-sm font-semibold text-stone-400">NT$</span>
                  <input
                    id="product-price-override"
                    type="number"
                    inputMode="decimal"
                    min="1"
                    step="1"
                    value={priceOverrideInput}
                    onChange={(event) => setPriceOverrideInput(event.target.value)}
                    placeholder={catalog?.basePrice != null ? String(catalog.basePrice) : '輸入售價'}
                    disabled={loading || saving || !catalog}
                    className="input-soft min-h-12 w-full pl-14 text-base font-bold"
                  />
                </div>
              </div>
              {priceOverrideInput && (
                <button
                  type="button"
                  onClick={() => setPriceOverrideInput('')}
                  disabled={loading || saving || !catalog}
                  className="min-h-11 rounded-full border border-stone-200 bg-white px-4 text-xs font-semibold text-stone-600 transition-all hover:border-brand-400 hover:text-brand-600 active:scale-95 disabled:opacity-50"
                >
                  清除覆寫
                </button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
              <span>主檔售價：{catalog?.basePrice != null ? `NT$${catalog.basePrice.toLocaleString('zh-TW')}` : '尚未定價'}</span>
              <span className="font-semibold text-brand-700">
                儲存後售價：{priceOverrideInput.trim() && Number(priceOverrideInput) > 0
                  ? `NT$${Number(priceOverrideInput).toLocaleString('zh-TW')}`
                  : catalog?.basePrice != null ? `NT$${catalog.basePrice.toLocaleString('zh-TW')}` : '待定價'}
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-400">留空會回到 Excel／產品目錄主檔售價；新售價只影響之後選入的品項，既有單據仍保留原價格快照。</p>
          </div>

          {/* 商品圖片 */}
          <div>
            <label className="block text-sm font-semibold text-stone-700 mb-2">商品圖片</label>
            <ImageUploadZone
              imageUrl={imageUrl}
              onUrlChange={setImageUrl}
              disabled={loading}
            />
          </div>

          {/* 形象素材 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold text-stone-700">形象素材</label>
              <span className="text-[10px] text-stone-400">可上傳多張・拖曳或點選圖片複選</span>
            </div>
            <MultiImageUploadZone
              images={galleryImages}
              onAddImage={(img) => setGalleryImages((prev) => [...prev, img])}
              onRemoveImage={(i) => setGalleryImages((prev) => prev.filter((_, idx) => idx !== i))}
              onReorder={setGalleryImages}
              disabled={loading}
            />
          </div>

          {/* 文件資料 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold text-stone-700">文件資料</label>
              <span className="text-[10px] text-stone-400">PDF / Word / Excel / PPT・最大 4 MB</span>
            </div>
            <DocUploadZone
              docs={docs}
              onAddDoc={(doc) => setDocs((prev) => [...prev, doc])}
              onRemoveDoc={(i) => setDocs((prev) => prev.filter((_, idx) => idx !== i))}
              disabled={loading}
            />
          </div>

          {/* 商品介紹 */}
          <div>
            <label htmlFor="product-description" className="mb-1.5 block text-sm font-semibold text-stone-700">商品介紹</label>
            <textarea
              id="product-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="填入產品特色、規格說明、使用注意事項…"
              rows={6}
              className="input-soft w-full resize-none text-sm leading-relaxed"
              disabled={loading}
            />
          </div>

          {/* 技術規格 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold text-stone-700">技術規格</label>
              <span className="text-[10px] text-stone-400">點擊欄位名稱可修改・Tab 鍵跳格・最後格自動新增列</span>
            </div>
            <SpecsEditor
              specs={specs}
              onChange={setSpecs}
              disabled={loading}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="glass-bar flex items-center justify-end gap-3 border-t border-stone-900/[0.06] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
          <button type="button" onClick={onClose} disabled={saving}
            className="min-h-11 rounded-full border border-stone-200 bg-white px-5 py-2 text-sm font-medium text-stone-600 transition-all hover:bg-stone-50 active:scale-95 disabled:opacity-50">
            取消
          </button>
          <button type="button" onClick={handleSave} disabled={loading || saving || !catalog}
            className="flex min-h-11 items-center gap-2 rounded-full bg-brand-500 px-6 py-2 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50">
            {saving && (
              <svg className="animate-spin motion-reduce:animate-none h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            )}
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── SKU Row ───────────────────────────────────────────────────

// ── Main Component ────────────────────────────────────────────

// ── 批次設定圖片（中央管理）──────────────────────────────────────
// 對目前搜尋／篩選結果的所有品項套用同一張主圖；先預覽會更新／略過幾筆，再確認寫入。
function BatchImageModal({ items, onClose, onDone }: {
  items: CatalogItem[]
  onClose: () => void
  onDone: (updated: string[], imageUrl: string) => void
}) {
  const [imageUrl, setImageUrl] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [preview, setPreview] = useState<{ willUpdate: number; skipped: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ updated: number; skipped: number; failed: { skuCode: string; error: string }[] } | null>(null)

  async function call(dryRun: boolean) {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/products/images/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skuCodes: items.map((i) => i.code), imageUrl, overwrite, dryRun }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '批次設定失敗')
      if (dryRun) setPreview({ willUpdate: data.willUpdate.length, skipped: data.skipped.length })
      else {
        setResult({ updated: data.updated.length, skipped: data.skipped.length, failed: data.failed ?? [] })
        onDone(data.updated, imageUrl)
      }
    } catch (e) { setError(e instanceof Error ? e.message : '批次設定失敗') }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-[#fdfdfb] p-5 shadow-2xl sm:rounded-3xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-stone-800">批次設定圖片</h2>
            <p className="mt-0.5 text-xs text-stone-500">套用到目前搜尋結果的 {items.length.toLocaleString()} 個品項</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100">✕</button>
        </div>

        {result ? (
          <div className="space-y-3 text-sm">
            <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-emerald-700">已更新 {result.updated} 個品項{result.skipped ? `，略過 ${result.skipped} 個` : ''}。縮圖已同步更新。</p>
            {result.failed.length > 0 && (
              <p className="rounded-2xl bg-red-50 px-4 py-3 text-red-700">失敗 {result.failed.length} 個：{result.failed.slice(0, 5).map((f) => f.skuCode).join('、')}{result.failed.length > 5 ? '…' : ''}（可再按一次重試）</p>
            )}
            <button type="button" onClick={onClose} className="button-primary w-full py-3">完成</button>
          </div>
        ) : (
          <div className="space-y-4">
            <ImageUploadZone imageUrl={imageUrl} onUrlChange={(url) => { setImageUrl(url); setPreview(null) }} disabled={busy} />
            <label className="flex items-start gap-2 text-sm text-stone-600">
              <input type="checkbox" checked={overwrite} onChange={(e) => { setOverwrite(e.target.checked); setPreview(null) }} className="mt-0.5 accent-brand-500" />
              <span>覆蓋已有圖片<span className="block text-xs text-stone-400">不勾選時，已經有圖的品項會保留原圖</span></span>
            </label>
            <details className="text-xs text-stone-500">
              <summary className="cursor-pointer text-stone-400 hover:text-stone-600">查看套用的品項</summary>
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto rounded-xl bg-stone-50 p-2">
                {items.slice(0, 300).map((i) => <li key={i.code} className="truncate"><span className="font-mono text-stone-400">{i.code}</span>　{i.name}</li>)}
                {items.length > 300 && <li className="text-stone-400">…另有 {items.length - 300} 個</li>}
              </ul>
            </details>
            {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            {preview ? (
              <div className="space-y-2">
                <p className="rounded-2xl bg-cream-100 px-4 py-3 text-sm text-stone-700">
                  將更新 <b>{preview.willUpdate}</b> 個品項{preview.skipped ? `，略過 ${preview.skipped} 個` : ''}。
                </p>
                <button type="button" disabled={busy || preview.willUpdate === 0} onClick={() => call(false)} className="button-primary w-full py-3">
                  {busy ? '寫入中…（品項多時約需一分鐘）' : `確認套用到 ${preview.willUpdate} 個品項`}
                </button>
              </div>
            ) : (
              <button type="button" disabled={busy || !imageUrl} onClick={() => call(true)} className="button-primary w-full py-3">
                {busy ? '檢查中…' : imageUrl ? '下一步：預覽影響範圍' : '請先上傳圖片'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

type StatusKey = 'unpriced' | 'override' | 'disabled' | 'discontinued' | 'review'
const STATUS_FILTERS: { key: StatusKey; label: string; manageOnly?: boolean; tone: string }[] = [
  { key: 'unpriced', label: '待定價', tone: 'text-amber-700' },
  { key: 'override', label: PRODUCT_LABELS.manualPrice, manageOnly: true, tone: 'text-brand-700' },
  { key: 'disabled', label: PRODUCT_LABELS.paused, manageOnly: true, tone: 'text-stone-700' },
  { key: 'discontinued', label: PRODUCT_LABELS.discontinued, manageOnly: true, tone: 'text-stone-500' },
  { key: 'review', label: PRODUCT_LABELS.needsReview, manageOnly: true, tone: 'text-amber-700' },
]
function matchesStatus(item: CatalogItem, key: StatusKey) {
  switch (key) {
    case 'unpriced': return !item.discontinued && !item.disabled && item.price == null
    case 'override': return item.priceSource === 'override'
    case 'disabled': return !!item.disabled
    case 'discontinued': return !!item.discontinued
    case 'review': return !!item.needsReview
  }
}

// 產品總覽資料在同一個分頁內快取 5 分鐘：從產品專屬頁按返回時不必重新下載 6,000 筆目錄。
let catalogCache: { at: number; manage: boolean; families: ProductFamily[]; items: CatalogItem[] } | null = null
const CATALOG_CACHE_MS = 5 * 60_000
const TILE_PAGE = 60
const SERIES_PREVIEW = 10

type BrowseMode = 'categories' | 'brands' | 'series'
const BROWSE_MODES: { key: BrowseMode; label: string }[] = [
  { key: 'categories', label: '分類' },
  { key: 'brands', label: '品牌' },
  { key: 'series', label: '系列' },
]

const money = (value: number) => `NT$${value.toLocaleString('zh-TW')}`

function itemTile(item: CatalogItem, canManage: boolean): ProductTileData {
  const badges: TileBadge[] = []
  if (item.disabled) badges.push({ label: PRODUCT_LABELS.paused, tone: 'dark' })
  if (canManage && item.needsReview) badges.push({ label: PRODUCT_LABELS.needsReview, tone: 'warn' })
  if (canManage && !item.discontinued && item.priceSource === 'override') badges.push({ label: PRODUCT_LABELS.manualPrice, tone: 'brand' })
  return {
    key: `sku:${item.code}`,
    href: `/products/item/${encodeURIComponent(item.code)}`,
    title: item.officialName || item.name,
    eyebrow: item.brand,
    meta: item.erpPending ? '尚無 ERP 料號' : item.code,
    imageUrl: item.imageUrl,
    category: item.category,
    mainCategory: item.mainCategory,
    priceLabel: item.discontinued ? (item.status || PRODUCT_LABELS.discontinued) : item.price != null ? money(item.price) : PRODUCT_LABELS.unpriced,
    priceTone: item.discontinued ? 'off' : item.price != null ? 'price' : 'pending',
    badges,
  }
}

function familyTile(family: ProductFamily, members: CatalogItem[]): ProductTileData {
  const sellable = members.filter((item) => !item.discontinued && !item.disabled)
  const prices = sellable.map((item) => item.price).filter((price): price is number => typeof price === 'number')
  const min = prices.length ? Math.min(...prices) : null
  const max = prices.length ? Math.max(...prices) : null
  const representative = members[0]
  const unpriced = sellable.length - prices.length
  const badges: TileBadge[] = []
  if (sellable.length > 0 && prices.length > 0 && unpriced > 0) badges.push({ label: `${unpriced} 項${PRODUCT_LABELS.unpriced}`, tone: 'warn' })
  return {
    key: `family:${family.id}`,
    href: `/products/series/${encodeURIComponent(family.id)}`,
    title: family.seriesName,
    eyebrow: family.brand || representative.brand,
    meta: representative.category,
    imageUrl: members.find((item) => item.imageUrl)?.imageUrl,
    category: representative.category,
    mainCategory: representative.mainCategory,
    priceLabel: sellable.length === 0 ? PRODUCT_LABELS.discontinued
      : min == null ? PRODUCT_LABELS.unpriced
      : min === max ? money(min) : `${money(min)}～${max!.toLocaleString('zh-TW')}`,
    priceTone: sellable.length === 0 ? 'off' : min == null ? 'pending' : 'price',
    badges,
    count: members.length,
  }
}

export function CatalogManagerContent({ taxonomy, canManageProducts }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const param = (key: string) => searchParams.get(key) ?? ''
  const cached = catalogCache && catalogCache.manage === canManageProducts && Date.now() - catalogCache.at < CATALOG_CACHE_MS ? catalogCache : null

  const [families,     setFamilies]     = useState<ProductFamily[]>(cached?.families ?? [])
  const [allItems,     setAllItems]     = useState<CatalogItem[]>(cached?.items ?? [])
  const [loading,      setLoading]      = useState(!cached)
  const [loadError,    setLoadError]    = useState('')
  const [loadAttempt,  setLoadAttempt]  = useState(0)

  // 搜尋與篩選條件都放在網址上：進產品專屬頁再按返回，會回到同一個清單
  const [search, setSearch] = useState(param('q'))
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [brandFilter, setBrandFilter] = useState(param('brand'))
  const [mainCategoryFilter, setMainCategoryFilter] = useState(param('main'))
  const [categoryFilter, setCategoryFilter] = useState(param('cat'))
  const [productTypeFilter, setProductTypeFilter] = useState(param('type'))
  const [statusFilter, setStatusFilter] = useState<'' | StatusKey>((STATUS_FILTERS.find((f) => f.key === param('status'))?.key) ?? '')
  const [browseMode, setBrowseMode] = useState<BrowseMode>((BROWSE_MODES.find((m) => m.key === param('mode'))?.key) ?? 'categories')
  const [openFamilyGroups, setOpenFamilyGroups] = useState<Set<string>>(new Set())
  const [visibleTiles, setVisibleTiles] = useState(TILE_PAGE)

  const [seriesAdminOpen, setSeriesAdminOpen] = useState(false)
  const [seriesAdminError, setSeriesAdminError] = useState('')
  const [batchImageOpen, setBatchImageOpen] = useState(false)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (cached && loadAttempt === 0) return
    setLoading(true)
    setLoadError('')
    Promise.all([
      fetch(canManageProducts ? '/api/products/families?includeDisabled=1' : '/api/products/families').then(async (response) => {
        if (!response.ok) throw new Error(`系列資料讀取失敗（HTTP ${response.status}）`)
        return response.json()
      }),
      fetch('/api/products/catalog-raw', { cache: 'no-store' }).then(async (response) => {
        if (!response.ok) throw new Error(`產品資料讀取失敗（HTTP ${response.status}）`)
        return response.json()
      }),
    ])
      .then(([fams, raw]) => {
        const nextFamilies: ProductFamily[] = Array.isArray(fams) ? fams : []
        const nextItems: CatalogItem[] = Array.isArray(raw) ? raw : []
        setFamilies(nextFamilies)
        setAllItems(nextItems)
        catalogCache = { at: Date.now(), manage: canManageProducts, families: nextFamilies, items: nextItems }
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : '產品資料暫時無法讀取'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageProducts, loadAttempt])

  const refreshFamilies = useCallback(async () => {
    const response = await fetch('/api/products/families/manage', { cache: 'no-store' })
    if (!response.ok) throw new Error(`系列資料讀取失敗（HTTP ${response.status}）`)
    const data = await response.json()
    setFamilies(Array.isArray(data) ? data : [])
    catalogCache = null
  }, [])

  const openSeriesAdmin = useCallback(async () => {
    setSeriesAdminError('')
    try {
      await refreshFamilies()
      setSeriesAdminOpen(true)
    } catch {
      setSeriesAdminError('系列管理資料無法完整讀取，已停用編輯以避免覆蓋現有歸屬。')
    }
  }, [refreshFamilies])

  // Debounced 關鍵字（全目錄已在記憶體，搜尋在 client-side 完成）
  const [debouncedQ, setDebouncedQ] = useState(search.trim().toLowerCase())
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebouncedQ(search.trim().toLowerCase()), 250)
  }, [search])

  // 條件 → 網址（replace，不塞歷史紀錄）
  useEffect(() => {
    const next = new URLSearchParams()
    if (debouncedQ) next.set('q', search.trim())
    if (brandFilter) next.set('brand', brandFilter)
    if (mainCategoryFilter) next.set('main', mainCategoryFilter)
    if (categoryFilter) next.set('cat', categoryFilter)
    if (productTypeFilter) next.set('type', productTypeFilter)
    if (statusFilter) next.set('status', statusFilter)
    if (browseMode !== 'categories') next.set('mode', browseMode)
    const query = next.toString()
    if (query !== searchParams.toString()) router.replace(query ? `/products/catalog?${query}` : '/products/catalog', { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ, brandFilter, mainCategoryFilter, categoryFilter, productTypeFilter, statusFilter, browseMode])

  useEffect(() => { setVisibleTiles(TILE_PAGE) }, [debouncedQ, brandFilter, mainCategoryFilter, categoryFilter, productTypeFilter, statusFilter])

  // 停售品（主檔已停售／未販售）一律隱藏；中央管理點「停售」篩選才列出
  const showDiscontinued = statusFilter === 'discontinued'
  const listedItems = useMemo(
    () => (showDiscontinued ? allItems : allItems.filter((item) => !item.discontinued)),
    [allItems, showDiscontinued],
  )

  const filterOptions = useMemo(() => {
    const sortedUnique = (values: string[]) =>
      Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    return {
      brands: sortedUnique(listedItems.map((item) => item.brand)),
      mainCategories: sortedUnique(listedItems.map((item) => item.mainCategory ?? '')),
      categories: sortedUnique(
        listedItems
          .filter((item) => !mainCategoryFilter || item.mainCategory === mainCategoryFilter)
          .map((item) => item.category),
      ),
      productTypes: sortedUnique(listedItems.map((item) => item.productType)),
    }
  }, [listedItems, mainCategoryFilter])

  const activeFilterCount = [brandFilter, mainCategoryFilter, categoryFilter, productTypeFilter, statusFilter].filter(Boolean).length
  const statusCounts = useMemo(() => {
    const c = {} as Record<StatusKey, number>
    for (const f of STATUS_FILTERS) c[f.key] = allItems.filter((item) => matchesStatus(item, f.key)).length
    return c
  }, [allItems])
  const hasFilters = activeFilterCount > 0
  const isSearching = Boolean(debouncedQ) || hasFilters
  const searchResults = useMemo(() => {
    if (!isSearching) return []
    return listedItems.filter((item) => {
      const matchesKeyword = !debouncedQ ||
        item.code.toLowerCase().includes(debouncedQ) ||
        item.name.toLowerCase().includes(debouncedQ) ||
        (item.officialName || '').toLowerCase().includes(debouncedQ) ||
        (item.brand || '').toLowerCase().includes(debouncedQ) ||
        (item.seriesName || '').toLowerCase().includes(debouncedQ)
      return matchesKeyword &&
        (!brandFilter || item.brand === brandFilter) &&
        (!mainCategoryFilter || item.mainCategory === mainCategoryFilter) &&
        (!categoryFilter || item.category === categoryFilter) &&
        (!productTypeFilter || item.productType === productTypeFilter) &&
        (!statusFilter || matchesStatus(item, statusFilter))
    })
  }, [isSearching, listedItems, debouncedQ, brandFilter, mainCategoryFilter, categoryFilter, productTypeFilter, statusFilter])

  const clearSearchAndFilters = () => {
    setSearch('')
    setDebouncedQ('')
    setBrandFilter('')
    setMainCategoryFilter('')
    setCategoryFilter('')
    setProductTypeFilter('')
    setStatusFilter('')
  }

  const itemByCode = useMemo(() => new Map(listedItems.map((item) => [item.code, item])), [listedItems])
  const exactFamilyIndex = useMemo(() => buildExactFamilyIndex(families), [families])
  const familyById = useMemo(() => new Map(families.map((family) => [family.id, family])), [families])

  // 結果卡片：同系列的品項收成一張系列卡（只算符合條件的成員），沒有系列的各自一張
  const resultTiles = useMemo(() => {
    if (!isSearching) return []
    const membersByFamily = new Map<string, CatalogItem[]>()
    const singles: CatalogItem[] = []
    for (const item of searchResults) {
      const familyId = exactFamilyIndex.familyIdBySku.get(item.code)
      if (familyId && familyById.has(familyId)) {
        const list = membersByFamily.get(familyId) ?? []
        list.push(item)
        membersByFamily.set(familyId, list)
      } else singles.push(item)
    }
    const seriesTiles = Array.from(membersByFamily.entries()).map(([familyId, members]) => familyTile(familyById.get(familyId)!, members))
    return [...seriesTiles, ...singles.map((item) => itemTile(item, canManageProducts))]
  }, [isSearching, searchResults, exactFamilyIndex, familyById, canManageProducts])

  // 系列模式：依主分類分組
  const familyGroups = useMemo(() => {
    const byMain = new Map<string, ProductTileData[]>()
    for (const family of families) {
      const members = explicitFamilySkuCodes(family).map((code) => itemByCode.get(code)).filter((item): item is CatalogItem => Boolean(item))
      if (members.length === 0) continue
      const main = members[0].mainCategory || '其他'
      const list = byMain.get(main) ?? []
      list.push(familyTile(family, members))
      byMain.set(main, list)
    }
    const order = new Map(taxonomy.mains.map((m, i) => [m.name, i]))
    return Array.from(byMain.entries())
      .map(([main, tiles]) => ({ main, tiles }))
      .sort((a, b) => (order.get(a.main) ?? 999) - (order.get(b.main) ?? 999))
  }, [families, itemByCode, taxonomy])

  // 入口卡的縮圖：各主分類／品牌前 4 張不同的產品照
  const { thumbsByMain, brandCards } = useMemo(() => {
    const mainThumbs = new Map<string, string[]>()
    const brands = new Map<string, { count: number; thumbs: string[]; families: Set<string> }>()
    for (const item of allItems) {
      if (item.discontinued || item.disabled) continue
      const brand = brands.get(item.brand) ?? { count: 0, thumbs: [], families: new Set<string>() }
      brand.count += 1
      const familyId = exactFamilyIndex.familyIdBySku.get(item.code)
      if (familyId) brand.families.add(familyId)
      if (item.imageUrl && brand.thumbs.length < 4 && !brand.thumbs.includes(item.imageUrl)) brand.thumbs.push(item.imageUrl)
      if (item.brand) brands.set(item.brand, brand)
      if (item.mainCategory && item.imageUrl) {
        const list = mainThumbs.get(item.mainCategory) ?? []
        if (list.length < 4 && !list.includes(item.imageUrl)) { list.push(item.imageUrl); mainThumbs.set(item.mainCategory, list) }
      }
    }
    return {
      thumbsByMain: mainThumbs,
      brandCards: Array.from(brands.entries())
        .map(([name, info]) => ({ name, count: info.count, thumbs: info.thumbs, seriesCount: info.families.size }))
        .sort((a, b) => b.count - a.count),
    }
  }, [allItems, exactFamilyIndex])

  // 結果頁的子分類膠囊：選了主分類 → 它的功能分類；只選品牌 → 該品牌有的主分類
  const subChips = useMemo(() => {
    if (mainCategoryFilter) {
      const scope = listedItems.filter((item) => item.mainCategory === mainCategoryFilter && (!brandFilter || item.brand === brandFilter))
      const counts = new Map<string, number>()
      for (const item of scope) counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
      return { kind: 'cat' as const, chips: Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })) }
    }
    if (brandFilter) {
      const counts = new Map<string, number>()
      for (const item of listedItems) if (item.brand === brandFilter && item.mainCategory) counts.set(item.mainCategory, (counts.get(item.mainCategory) ?? 0) + 1)
      return { kind: 'main' as const, chips: Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })) }
    }
    return null
  }, [listedItems, mainCategoryFilter, brandFilter])

  const mainCounts = useMemo(() => {
    const counts = new Map<string, { count: number; cats: Set<string> }>()
    for (const item of listedItems) {
      if (!item.mainCategory) continue
      const entry = counts.get(item.mainCategory) ?? { count: 0, cats: new Set<string>() }
      entry.count += 1
      entry.cats.add(item.category)
      counts.set(item.mainCategory, entry)
    }
    return counts
  }, [listedItems])

  const scopeTitle = [brandFilter, categoryFilter || mainCategoryFilter].filter(Boolean).join(' · ') ||
    (statusFilter ? STATUS_FILTERS.find((f) => f.key === statusFilter)?.label : '') || (debouncedQ ? `「${search.trim()}」` : '篩選結果')

  const toggleFamilyGroup = (main: string) => {
    setOpenFamilyGroups((prev) => {
      const next = new Set(prev)
      if (next.has(main)) next.delete(main); else next.add(main)
      return next
    })
  }

  return (
    <>
      {seriesAdminError && <div className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{seriesAdminError}</div>}

      {/* 工具列：搜尋＋瀏覽方式＋篩選＋（管理）工具 */}
      <div className="card-soft mb-5 space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="搜尋產品"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋貨號、品名、品牌或系列…"
            className="input-soft min-w-[200px] flex-1 rounded-full px-5 py-2.5"
          />
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="catalog-filters"
            className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-all active:scale-95 sm:hidden ${
              hasFilters ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'bg-stone-100 text-stone-600'}`}
          >
            篩選{activeFilterCount > 0 && <span className="tabular-nums">{activeFilterCount}</span>}
          </button>
          <div className="flex rounded-full bg-stone-100 p-1" role="group" aria-label="瀏覽方式">
            {BROWSE_MODES.map((mode) => (
              <button key={mode.key} type="button" aria-pressed={!isSearching && browseMode === mode.key}
                onClick={() => { clearSearchAndFilters(); setBrowseMode(mode.key) }}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all active:scale-95 ${!isSearching && browseMode === mode.key ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'}`}>
                {mode.label}
              </button>
            ))}
          </div>
          {canManageProducts && (
            <button type="button"
              onClick={() => (isSearching && searchResults.length > 0 ? setBatchImageOpen(true) : undefined)}
              disabled={!isSearching || searchResults.length === 0}
              title={isSearching ? '把同一張主圖套用到目前搜尋結果的所有品項' : '先搜尋或篩選出要換圖的品項'}
              className="button-secondary min-h-10 px-4 disabled:cursor-not-allowed">
              {isSearching && searchResults.length > 0 ? `批次設定圖片（${searchResults.length.toLocaleString()}）` : '批次設定圖片'}
            </button>
          )}
          {canManageProducts && (
            <button type="button" onClick={openSeriesAdmin} title="中央管理：維護系列與品項歸屬"
              className="button-secondary min-h-10 px-4">管理系列</button>
          )}
        </div>

        <div id="catalog-filters" className={`${filtersOpen ? 'grid' : 'hidden'} grid-cols-2 gap-2 sm:grid lg:grid-cols-4`}>
          <select aria-label="品牌" value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)} className="select-soft w-full">
            <option value="">全部品牌</option>
            {filterOptions.brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
          </select>
          <select aria-label="主分類" value={mainCategoryFilter} onChange={(event) => { setMainCategoryFilter(event.target.value); setCategoryFilter('') }} className="select-soft w-full">
            <option value="">全部主分類</option>
            {filterOptions.mainCategories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select aria-label="細分類" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="select-soft w-full">
            <option value="">全部細分類</option>
            {filterOptions.categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <select aria-label="商品類型" value={productTypeFilter} onChange={(event) => setProductTypeFilter(event.target.value)} className="select-soft w-full">
            <option value="">全部商品類型</option>
            {filterOptions.productTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>

        {!loading && !loadError && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="mr-1 text-stone-400">
              {isSearching
                ? <>符合 <b className="text-stone-700">{searchResults.length.toLocaleString()}</b> 個品項</>
                : <>共 {listedItems.length.toLocaleString()} 個在售品項 · {familyGroups.reduce((n, g) => n + g.tiles.length, 0)} 個系列 · {brandCards.length} 個品牌</>}
            </span>
            {STATUS_FILTERS.filter((f) => (canManageProducts || !f.manageOnly) && statusCounts[f.key] > 0).map((f) => (
              <button key={f.key} type="button" onClick={() => setStatusFilter((v) => (v === f.key ? '' : f.key))}
                aria-pressed={statusFilter === f.key}
                className={`rounded-full px-2.5 py-1 transition-all active:scale-95 ${statusFilter === f.key ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : `bg-stone-100 hover:bg-stone-200 ${f.tone}`}`}>
                {f.label} <span className="tabular-nums">{statusCounts[f.key].toLocaleString()}</span>
              </button>
            ))}
            {isSearching && (
              <button type="button" onClick={clearSearchAndFilters} className="ml-auto rounded-full px-2.5 py-1 font-medium text-brand-700 transition-all hover:bg-brand-50 active:scale-95">清除條件</button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className={TILE_GRID}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-stone-100 motion-reduce:animate-none" />
          ))}
        </div>
      ) : loadError ? (
        <div className="card-soft flex flex-col items-center px-5 py-10 text-center" role="alert">
          <h3 className="text-base font-bold text-stone-800">產品資料載入失敗</h3>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-stone-500">{loadError}</p>
          <button
            type="button"
            onClick={() => setLoadAttempt((attempt) => attempt + 1)}
            className="mt-5 min-h-11 rounded-full bg-brand-500 px-5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95"
          >
            重新載入
          </button>
        </div>
      ) : isSearching ? (
        /* ── 結果：搜尋、分類、品牌、狀態都走同一個卡片格線 ── */
        <div data-testid="catalog-results">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={clearSearchAndFilters}
              className="flex min-h-10 items-center gap-1 rounded-full border border-stone-200 bg-white px-4 text-sm font-semibold text-stone-600 transition-all hover:border-brand-300 hover:text-brand-700 active:scale-95">
              <span aria-hidden="true">←</span>全部產品
            </button>
            <h3 className="min-w-0 truncate text-lg font-bold text-stone-800">{scopeTitle}</h3>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">{resultTiles.length.toLocaleString()} 張卡 · {searchResults.length.toLocaleString()} 個品項</span>
          </div>

          {subChips && subChips.chips.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              <button type="button"
                onClick={() => (subChips.kind === 'cat' ? setCategoryFilter('') : setMainCategoryFilter(''))}
                className={`chip ${(subChips.kind === 'cat' ? !categoryFilter : !mainCategoryFilter) ? 'chip-active' : ''}`}>全部</button>
              {subChips.chips.map((chip) => {
                const active = subChips.kind === 'cat' ? categoryFilter === chip.name : mainCategoryFilter === chip.name
                return (
                  <button key={chip.name} type="button"
                    onClick={() => (subChips.kind === 'cat' ? setCategoryFilter(active ? '' : chip.name) : setMainCategoryFilter(chip.name))}
                    className={`chip ${active ? 'chip-active' : ''}`}>
                    {chip.name} <span className="tabular-nums opacity-60">{chip.count}</span>
                  </button>
                )
              })}
            </div>
          )}

          {resultTiles.length === 0 ? (
            <div className="card-soft px-5 py-12 text-center text-sm text-stone-400">找不到符合的產品，換個關鍵字或清除條件試試。</div>
          ) : (
            <>
              <div className={TILE_GRID}>
                {resultTiles.slice(0, visibleTiles).map((tile) => <ProductTile key={tile.key} tile={tile} />)}
              </div>
              {visibleTiles < resultTiles.length && (
                <div className="py-6 text-center">
                  <button type="button" onClick={() => setVisibleTiles((count) => count + TILE_PAGE)}
                    className="min-h-11 rounded-full bg-brand-50 px-6 text-sm font-semibold text-brand-700 transition-all hover:bg-brand-100 active:scale-95">
                    再顯示 {Math.min(TILE_PAGE, resultTiles.length - visibleTiles)} 張（還有 {(resultTiles.length - visibleTiles).toLocaleString()} 張）
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      ) : browseMode === 'categories' ? (
        <div>
          <div className="mb-3 flex items-baseline gap-2">
            <h3 className="text-sm font-bold text-stone-700">依分類找產品</h3>
            <span className="text-[11px] text-stone-400">{mainCounts.size} 個主分類</span>
          </div>
          <div className={TILE_GRID}>
            {taxonomy.mains.filter((m) => (mainCounts.get(m.name)?.count ?? 0) > 0).map((m) => (
              <EntryTile
                key={m.id}
                title={m.name}
                meta={`${(mainCounts.get(m.name)?.count ?? 0).toLocaleString()} 個品項 · ${mainCounts.get(m.name)?.cats.size ?? 0} 個細分類`}
                thumbs={thumbsByMain.get(m.name)}
                artwork={<MainCategoryArtwork categoryId={m.id} compact />}
                onClick={() => { setMainCategoryFilter(m.name); setCategoryFilter('') }}
              />
            ))}
          </div>
        </div>
      ) : browseMode === 'brands' ? (
        <div>
          <div className="mb-3 flex items-baseline gap-2">
            <h3 className="text-sm font-bold text-stone-700">依品牌找產品</h3>
            <span className="text-[11px] text-stone-400">{brandCards.length} 個品牌，依品項數排列</span>
          </div>
          <div className={TILE_GRID}>
            {brandCards.map((brand) => (
              <EntryTile
                key={brand.name}
                title={brand.name}
                meta={`${brand.count.toLocaleString()} 個品項${brand.seriesCount ? ` · ${brand.seriesCount} 個系列` : ''}`}
                thumbs={brand.thumbs}
                artwork={<span className="px-3 text-center text-lg font-bold text-brand-600">{brand.name}</span>}
                onClick={() => setBrandFilter(brand.name)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {familyGroups.length === 0 && <p className="py-12 text-center text-sm text-stone-400">目前沒有系列資料</p>}
          {familyGroups.map(({ main, tiles }) => {
            const open = openFamilyGroups.has(main)
            const shown = open ? tiles : tiles.slice(0, SERIES_PREVIEW)
            return (
              <section key={main}>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-bold text-stone-700">{main}</h3>
                  <span className="text-[11px] text-stone-400">{tiles.length} 個系列</span>
                  {tiles.length > SERIES_PREVIEW && (
                    <button type="button" onClick={() => toggleFamilyGroup(main)} aria-expanded={open}
                      className="ml-auto rounded-full px-3 py-1 text-xs font-semibold text-brand-700 transition-all hover:bg-brand-50 active:scale-95">
                      {open ? '收合' : `看全部 ${tiles.length} 個`}
                    </button>
                  )}
                </div>
                <div className={TILE_GRID}>
                  {shown.map((tile) => <ProductTile key={tile.key} tile={tile} />)}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {canManageProducts && batchImageOpen && (
        <BatchImageModal
          items={searchResults}
          onClose={() => setBatchImageOpen(false)}
          onDone={(updated, url) => {
            const set = new Set(updated)
            setAllItems((items) => items.map((item) => (set.has(item.code) ? { ...item, imageUrl: url } : item)))
            catalogCache = null
          }}
        />
      )}

      <AnimatePresence>
        {canManageProducts && seriesAdminOpen && (
          <ProductSeriesAdminDrawer
            families={families}
            allItems={allItems}
            onClose={() => setSeriesAdminOpen(false)}
            onChanged={refreshFamilies}
          />
        )}
      </AnimatePresence>
    </>
  )
}
