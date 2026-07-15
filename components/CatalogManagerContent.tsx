'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { SeriesModal } from '@/components/SeriesModal'
import { ProductSeriesAdminDrawer } from '@/components/ProductSeriesAdminDrawer'
import { MainCategoryArtwork, SeriesArtwork } from '@/components/product-series/SeriesArtwork'
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
  name: string
  brand: string
  productType: string   // 商品型態(9 種)
  category: string      // 功能分類(62 種)
  mainCategory?: string // 主分類(11 種)
  seriesName?: string   // 總表系列
  needsReview?: boolean // 分類待覆核
  price?: number      // 有效售價（中央覆寫優先、目錄基準價次之）
  basePrice?: number | null
  priceSource?: 'override' | 'catalog' | 'unset'
  salePrice?: number
  spec?: string
  discontinued?: boolean
  status?: string   // 已停售／未販售
  disabled?: boolean // 中央管理人工停用（可恢復）
}

interface FamilySpec {
  key: string
  label: string
  options: string[]
}

interface ProductFamily {
  id: string
  collectionName?: string
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

function splitFamilyCollections(families: ProductFamily[]): {
  collections: { name: string; families: ProductFamily[] }[]
  ungrouped: ProductFamily[]
} {
  const byName = new Map<string, ProductFamily[]>()
  const ungrouped: ProductFamily[] = []
  for (const family of families) {
    if (!family.collectionName) {
      ungrouped.push(family)
      continue
    }
    const group = byName.get(family.collectionName) ?? []
    group.push(family)
    byName.set(family.collectionName, group)
  }
  return {
    collections: Array.from(byName.entries()).map(([name, groupedFamilies]) => ({ name, families: groupedFamilies })),
    ungrouped,
  }
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
 * - Resizes to maxPx on the long edge
 * - Fills white background (so PNG transparency becomes white, not black/transparent)
 * - Outputs as JPEG at the given quality
 * Always runs (even on small files) so the white-background conversion always applies.
 */
async function compressForUpload(file: File, maxPx = 1800, quality = 0.85): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
      const w = Math.round(img.width  * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width  = w
      canvas.height = h
      const ctx = canvas.getContext('2d')!
      // ① White background — handles PNG transparency
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      // ② Draw the image on top
      ctx.drawImage(img, 0, 0, w, h)
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
                task.status === 'done'  ? 'bg-emerald-900/50' :
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

function ProductEditDrawer({
  skuCode,
  onClose,
  onSaved,
  onFamilyChanged,
  allFamilies,
}: {
  skuCode: string
  onClose: () => void
  onSaved: (skuCode: string, price: number | null, disabled: boolean, priceSource: CatalogItem['priceSource']) => void
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
        className="relative ml-auto flex h-[100dvh] max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden bg-[#fcfbf8] shadow-2xl ring-1 ring-stone-900/[0.06] sm:rounded-l-3xl"
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

          <div className={`rounded-2xl p-4 ${centralDisabled ? 'bg-red-50' : 'bg-emerald-50/70'}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">商品使用狀態</p>
                <p className={`mt-1 text-sm font-bold ${centralDisabled ? 'text-red-700' : 'text-emerald-700'}`}>
                  {centralDisabled ? '中央停用' : '使用中'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={centralDisabled}
                aria-label={centralDisabled ? '恢復使用此商品' : '停用此商品'}
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
              停用後會從一般產品頁、訂購、報價及促銷選品器隱藏；既有單據與產品資料不會刪除，可隨時恢復。
            </p>
            {catalog?.discontinued && (
              <p className="mt-2 rounded-2xl bg-white/70 px-3 py-2 text-xs text-red-600">
                此品項另有主檔狀態「{catalog.status || '已停售'}」，恢復中央停用不會解除主檔停售。
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
                <label htmlFor="product-price-override" className="text-xs font-semibold uppercase tracking-widest text-stone-400">後台售價覆寫</label>
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

function SkuRow({
  item,
  priceCache,
  onEdit,
  canManageProducts,
}: {
  item: CatalogItem
  priceCache: Map<string, number | null>
  onEdit: (item: CatalogItem) => void
  canManageProducts: boolean
}) {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<IntroData | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const summaryFetched = useRef(false)
  const reduceMotion = useReducedMotion()
  const hasPrice = priceCache.has(item.code)
  const price    = priceCache.get(item.code)

  const handleToggle = () => {
    const next = !open
    setOpen(next)
    if (!next || summaryFetched.current) return
    summaryFetched.current = true
    setSummaryLoading(true)
    fetch(`/api/products/sku/${encodeURIComponent(item.code)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (!data?.rich) return
        setSummary({
          notionId: data.rich.notionId ?? null,
          imageUrl: data.rich.imageUrl ?? '',
          description: data.rich.description ?? '',
        })
      })
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false))
  }

  return (
    <div className="border-b border-stone-900/[0.05] py-1 last:border-0" data-testid="inline-sku-summary">
      <div className="group flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-brand-50/40">
        <button
          type="button"
          onClick={handleToggle}
          className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-2xl text-left transition-all active:scale-[0.99]"
          aria-expanded={open}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-medium text-stone-800">{item.name}</p>
              {item.discontinued && (
                <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-500">
                  {item.status || '未販售'}
                </span>
              )}
              {item.disabled && (
                <span className="shrink-0 rounded-full bg-stone-700 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  中央停用
                </span>
              )}
              {item.needsReview && (
                <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-600">
                  分類待覆核
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="truncate font-mono text-[11px] text-stone-400">{item.code}</p>
              {item.brand && <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-medium text-stone-600">{item.brand}</span>}
              {item.category && <span className="hidden text-[10px] text-stone-400 sm:inline">{item.category}</span>}
            </div>
          </div>

          <div className="shrink-0 text-right">
            {item.discontinued ? (
              <span className="text-[11px] font-medium text-stone-300">未販售</span>
            ) : hasPrice && price != null ? (
              <span className="price-pill">NT${price.toLocaleString('zh-TW')}</span>
            ) : (
              <span className="text-[11px] font-medium text-amber-600">待定價</span>
            )}
            {!item.discontinued && item.priceSource === 'override' && (
              <span className="ml-1 inline-flex rounded-full bg-brand-50 px-2 py-1 text-[10px] font-semibold text-brand-700">後台價</span>
            )}
            <span className={`ml-2 inline-block text-stone-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
          </div>
        </button>

        {canManageProducts && (
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="flex min-h-11 shrink-0 items-center rounded-full border border-stone-200 bg-white px-3 text-xs font-medium text-stone-500 transition-all hover:border-brand-400 hover:text-brand-600 active:scale-95"
          >
            編輯
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: reduceMotion ? 'auto' : 0, opacity: reduceMotion ? 1 : 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: reduceMotion ? 'auto' : 0, opacity: reduceMotion ? 1 : 0 }}
            className="overflow-hidden"
          >
            <div className="mx-2 mb-2 flex flex-col gap-3 rounded-2xl bg-stone-50 p-3 sm:flex-row">
              {summaryLoading ? (
                <div className="h-20 w-full animate-pulse motion-reduce:animate-none rounded-2xl bg-stone-100" />
              ) : (
                <>
                  {summary?.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={summary.notionId ? `/api/notion-image?pageId=${summary.notionId}` : summary.imageUrl}
                      alt={item.name}
                      className="h-36 w-full shrink-0 rounded-2xl bg-white object-contain ring-1 ring-stone-900/[0.05] sm:h-24 sm:w-24"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">產品介紹</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-600">
                      {summary?.description || '尚未建立產品介紹。'}
                    </p>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Family Card ───────────────────────────────────────────────

const PAGE_SIZE = 100

type IntroData = { notionId: string | null; imageUrl: string; description: string }

function FamilyCard({
  family,
  allItems,
  priceCache,
  onEdit,
  onOpenModal,
  canManageProducts,
  allowedSkuCodes,
}: {
  family: ProductFamily
  allItems: CatalogItem[]
  priceCache: Map<string, number | null>
  onEdit: (item: CatalogItem) => void
  onOpenModal?: () => void
  canManageProducts: boolean
  allowedSkuCodes?: ReadonlySet<string>
}) {
  const [open,         setOpen]         = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [introLoading, setIntroLoading] = useState(false)
  const [introData,    setIntroData]    = useState<IntroData | null>(null)
  const introFetched = useRef(false)
  const reduceMotion = useReducedMotion()

  // 系列成員只接受明確 SKU 對照，不用貨號前綴猜測。
  const skuCodes = explicitFamilySkuCodes(family).filter((code) => !allowedSkuCodes || allowedSkuCodes.has(code))

  // Match to catalog items
  const items = skuCodes.map((c) => allItems.find((it) => it.code === c)).filter(Boolean) as CatalogItem[]

  if (items.length === 0) return null

  const sellableItems = items.filter((item) => !item.discontinued)
  const discontinuedCount = items.length - sellableItems.length
  const priceSetCount = sellableItems.filter((it) => priceCache.has(it.code) && priceCache.get(it.code) != null).length
  const priceValues = sellableItems
    .map((item) => item.price ?? priceCache.get(item.code))
    .filter((price): price is number => typeof price === 'number')
  const minPrice = priceValues.length > 0 ? Math.min(...priceValues) : null
  const maxPrice = priceValues.length > 0 ? Math.max(...priceValues) : null
  const allDiscontinued = sellableItems.length === 0
  const priceSummary = allDiscontinued
    ? '未販售'
    : minPrice == null
    ? '待定價'
    : minPrice === maxPrice
      ? `NT$${minPrice.toLocaleString('zh-TW')}`
      : `NT$${minPrice.toLocaleString('zh-TW')}～${maxPrice!.toLocaleString('zh-TW')}`
  const visibleItems  = items.slice(0, visibleCount)
  const remaining     = items.length - visibleCount

  const handleToggle = () => {
    setOpen((v) => {
      const next = !v
      // Lazy-fetch intro the first time we open
      if (next && !introFetched.current && items.length > 0) {
        introFetched.current = true
        setIntroLoading(true)
        ;(async () => {
          let found: IntroData | null = null
          try {
            const seriesResponse = await fetch(`/api/products/series/${encodeURIComponent(family.seriesCode)}`)
            if (seriesResponse.ok) {
              const series = await seriesResponse.json()
              if (series?.imageUrl || series?.description) {
                found = {
                  notionId: null,
                  imageUrl: series.imageUrl ?? '',
                  description: series.description ?? '',
                }
              }
            }
          } catch { /* fallback to SKU content */ }

          // 系列資料未建立時，回退前 5 個 SKU 的既有介紹。
          const candidates = found ? [] : items.slice(0, 5)
          for (const item of candidates) {
            try {
              const res = await fetch(`/api/products/sku/${encodeURIComponent(item.code)}`)
              if (!res.ok) continue
              const data = await res.json()
              if (data.rich?.imageUrl || data.rich?.description) {
                found = {
                  notionId:    data.rich.notionId    ?? null,
                  imageUrl:    data.rich.imageUrl    ?? '',
                  description: data.rich.description ?? '',
                }
                break
              }
            } catch { /* skip */ }
          }
          setIntroData(found)
          setIntroLoading(false)
        })()
      }
      if (!next) setVisibleCount(PAGE_SIZE)
      return next
    })
  }

  const representative = items[0]
  return (
    <div className="card-soft card-soft-hover overflow-hidden" data-testid="series-result-card">
      {/* Family header */}
      <div className="group flex w-full items-start gap-3 p-3 sm:items-center sm:px-5 sm:py-4">
        <SeriesArtwork category={representative.category} mainCategory={representative.mainCategory} label={family.seriesName} />
        <button type="button"
          onClick={handleToggle}
          className={`flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-full text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-700 active:scale-95 ${open ? 'rotate-90' : ''}`}
          aria-label={open ? '收合系列品項' : '展開系列品項'}
        >
          ▶
        </button>
        <button type="button"
          onClick={onOpenModal}
          className="min-w-0 flex-1 rounded-2xl px-1 py-1 text-left transition-all hover:bg-brand-50/50 active:scale-[0.99]"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-bold text-stone-800 group-hover:text-brand-700 transition-colors">{family.seriesName}</span>
            {family.collectionName && (
              <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-200/60">
                {family.collectionName} 集合
              </span>
            )}
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-500 font-medium">{family.brand}</span>
            {family.productType && (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-200/60 font-medium">{family.productType}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs text-stone-400">{items.length} 個品項</span>
            <span className={allDiscontinued ? 'text-xs font-medium text-stone-300' : minPrice == null ? 'text-xs font-semibold text-amber-600' : 'price-pill'}>{priceSummary}</span>
            {priceSetCount > 0 && priceSetCount < sellableItems.length && <span className="text-[11px] text-stone-400">{sellableItems.length - priceSetCount} 項待定價</span>}
            {discontinuedCount > 0 && <span className="text-[11px] font-medium text-stone-300">{discontinuedCount} 項未販售</span>}
            <span className="text-[11px] font-medium text-brand-600">照片・規格・文件 ›</span>
          </div>
        </button>
        <span className="hidden shrink-0 text-xs text-stone-400 lg:block">{representative.category}</span>
      </div>

      {/* Expanded: series overview card */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: reduceMotion ? 'auto' : 0, opacity: reduceMotion ? 1 : 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: reduceMotion ? 'auto' : 0, opacity: reduceMotion ? 1 : 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-stone-100 px-5 py-4 space-y-5">

              {/* ── 介紹 ── */}
              {introLoading ? (
                <div className="flex gap-4">
                  <div className="w-24 h-24 rounded-xl bg-stone-100 animate-pulse motion-reduce:animate-none shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 w-3/4 animate-pulse motion-reduce:animate-none rounded-full bg-stone-100 motion-reduce:animate-none" />
                    <div className="h-3 w-full animate-pulse motion-reduce:animate-none rounded-full bg-stone-100 motion-reduce:animate-none" />
                    <div className="h-3 w-2/3 animate-pulse motion-reduce:animate-none rounded-full bg-stone-100 motion-reduce:animate-none" />
                  </div>
                </div>
              ) : introData?.imageUrl || introData?.description ? (
                <div className="flex gap-4">
                  {introData.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={introData.notionId ? `/api/notion-image?pageId=${introData.notionId}` : introData.imageUrl}
                      alt={family.seriesName}
                      className="w-24 h-24 rounded-xl object-cover shrink-0 border border-stone-100 bg-stone-50"
                    />
                  )}
                  {introData.description && (
                    introData.description.includes('|') ? (
                      <ul className="space-y-1">
                        {introData.description.split('|').map((part, i) => {
                          const t = part.trim()
                          return t ? (
                            <li key={i} className="flex gap-2 text-sm text-stone-600 leading-relaxed">
                              <span className="text-brand-400 shrink-0 mt-0.5 select-none">·</span>
                              <span>{t}</span>
                            </li>
                          ) : null
                        })}
                      </ul>
                    ) : (
                      <p className="text-sm text-stone-600 leading-relaxed">{introData.description}</p>
                    )
                  )}
                </div>
              ) : null}

              {/* ── 品項清單 ── */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400 mb-2">
                  品項（{items.length}）
                </p>
                <div className="space-y-0.5">
                  {visibleItems.map((item) => (
                    <div key={item.code} className="group flex min-h-12 flex-col items-stretch gap-2 rounded-2xl px-2 py-2 transition-colors hover:bg-brand-50/40 sm:flex-row sm:items-center sm:gap-3">
                      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                        <span className="block truncate font-mono text-[11px] text-stone-400 sm:w-32 sm:shrink-0">{item.code}</span>
                        <span className="mt-1 block truncate text-sm font-medium text-stone-700 sm:mt-0">{item.name}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        {item.discontinued ? (
                          <span className="shrink-0 text-[11px] font-medium text-stone-300">未販售</span>
                        ) : (item.price ?? priceCache.get(item.code)) != null ? (
                          <span className="price-pill shrink-0">NT${(item.price ?? priceCache.get(item.code) as number).toLocaleString('zh-TW')}</span>
                        ) : (
                          <span className="shrink-0 text-[11px] font-medium text-amber-600">待定價</span>
                        )}
                        {canManageProducts && (
                          <button
                            type="button"
                            onClick={() => onEdit(item)}
                            className="flex min-h-11 shrink-0 items-center rounded-full border border-stone-200 bg-white px-3 text-xs text-stone-500 transition-all hover:border-brand-400 hover:text-brand-600 active:scale-95"
                          >
                            編輯
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {remaining > 0 && (
                    <div className="pt-2 text-center">
                      <button type="button"
                        onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                        className="text-xs font-medium text-brand-600 hover:text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-4 py-1.5 rounded-full transition"
                      >
                        顯示更多 {Math.min(remaining, PAGE_SIZE)} 筆（還剩 {remaining} 筆）
                      </button>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Category Browser ──────────────────────────────────────────

function CategoryBrowserModal({
  selection,
  totalItems,
  itemCodes,
  families,
  standaloneItems,
  allItems,
  priceCache,
  canManageProducts,
  onClose,
  onOpenFamily,
  onEdit,
}: {
  selection: CategorySelection
  totalItems: number
  itemCodes: ReadonlySet<string>
  families: ProductFamily[]
  standaloneItems: CatalogItem[]
  allItems: CatalogItem[]
  priceCache: Map<string, number | null>
  canManageProducts: boolean
  onClose: () => void
  onOpenFamily: (family: ProductFamily) => void
  onEdit: (item: CatalogItem) => void
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const dialogRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  useDialogFocus(dialogRef, onClose)
  useBodyScrollLock()

  const title = selection.category || selection.main

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-stone-900/40 sm:items-center sm:p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-browser-title"
        tabIndex={-1}
        // 不做進場動畫(initial=false):大分類(千項)開窗時的重渲染會把 rAF 動畫凍在半途,
        // 使用者會看到半透明疊影的彈窗;直接以完全不透明呈現,退場動畫保留。
        initial={false}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 24, scale: reduceMotion ? 1 : 0.98 }}
        transition={{ duration: reduceMotion ? 0 : 0.2 }}
        className="flex max-h-[96dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-[#fcfbf8] shadow-2xl ring-1 ring-stone-900/[0.06] sm:max-h-[90vh] sm:rounded-3xl"
      >
        <header className="glass-bar flex shrink-0 items-center gap-3 border-b border-stone-900/[0.06] px-3 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            data-dialog-initial-focus
            className="flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-600 transition-all hover:border-brand-300 hover:text-brand-700 active:scale-95"
            aria-label="返回產品分類總覽"
          >
            <span aria-hidden="true">←</span>
            返回
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-bold uppercase tracking-widest text-stone-400">
              {selection.category ? `${selection.main} › 功能分類` : '主分類'}
            </p>
            <h2 id="category-browser-title" className="truncate text-base font-bold text-stone-800 sm:text-lg">{title}</h2>
          </div>
          <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">{totalItems} 項</span>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-5">
          {families.length === 0 && standaloneItems.length === 0 ? (
            <div className="card-soft px-5 py-12 text-center text-sm text-stone-400">此分類目前沒有商品</div>
          ) : (
            <div className="space-y-6">
              {families.length > 0 && (
                <section>
                  <div className="mb-3 flex items-baseline gap-2 px-1">
                    <h3 className="text-sm font-bold text-stone-700">產品清單</h3>
                    <span className="text-[11px] text-stone-400">{families.length} 個系列</span>
                  </div>
                  <div className="space-y-3">
                    {families.map((family) => (
                      <FamilyCard
                        key={family.id}
                        family={family}
                        allItems={allItems}
                        priceCache={priceCache}
                        onEdit={onEdit}
                        onOpenModal={() => onOpenFamily(family)}
                        canManageProducts={canManageProducts}
                        allowedSkuCodes={itemCodes}
                      />
                    ))}
                  </div>
                </section>
              )}

              {standaloneItems.length > 0 && (
                <section className="card-soft overflow-hidden p-0">
                  <div className="border-b border-stone-900/[0.06] px-4 py-3 sm:px-5">
                    <h3 className="text-sm font-bold text-stone-700">獨立單品</h3>
                    <p className="mt-0.5 text-xs text-stone-400">未歸入系列的 {standaloneItems.length} 個品項</p>
                  </div>
                  <div className="px-3 py-2 sm:px-5">
                    {standaloneItems.slice(0, visibleCount).map((item) => (
                      <SkuRow
                        key={item.code}
                        item={item}
                        priceCache={priceCache}
                        onEdit={onEdit}
                        canManageProducts={canManageProducts}
                      />
                    ))}
                    {visibleCount < standaloneItems.length && (
                      <div className="py-3 text-center">
                        <button
                          type="button"
                          onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                          className="min-h-11 rounded-full bg-brand-50 px-5 text-xs font-semibold text-brand-700 transition-all hover:bg-brand-100 active:scale-95"
                        >
                          再顯示 {Math.min(PAGE_SIZE, standaloneItems.length - visibleCount)} 筆
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────

export function CatalogManagerContent({ taxonomy, canManageProducts }: Props) {

  const [families,     setFamilies]     = useState<ProductFamily[]>([])
  const [allItems,     setAllItems]     = useState<CatalogItem[]>([])
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState('')
  const [loadAttempt,  setLoadAttempt]  = useState(0)

  const [search, setSearch] = useState('')
  const [browseMode, setBrowseMode] = useState<'categories' | 'products'>('categories')
  const [categorySelection, setCategorySelection] = useState<CategorySelection | null>(null)
  // 產品系列分組收合(依主分類):113 個系列全平鋪會把瀏覽頁撐到近 2 萬 px,
  // 且首載重渲染會凍結頁面進場動畫;預設收合、展開才渲染該組卡片。
  const [openFamilyGroups, setOpenFamilyGroups] = useState<Set<string>>(new Set())

  const [editingItem,  setEditingItem]  = useState<CatalogItem | null>(null)
  const [modalFamily,  setModalFamily]  = useState<ProductFamily | null>(null)
  const [seriesAdminOpen, setSeriesAdminOpen] = useState(false)
  const [seriesAdminError, setSeriesAdminError] = useState('')

  // Cache: skuCode → price. Populated from catalog and refreshed after edits.
  const [priceCache,     setPriceCache]     = useState<Map<string, number | null>>(new Map())

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load families + full catalog on mount
  useEffect(() => {
    setLoading(true)
    setLoadError('')
    Promise.all([
      fetch(canManageProducts ? '/api/products/families?includeDisabled=1' : '/api/products/families').then(async (response) => {
        if (!response.ok) throw new Error(`系列資料讀取失敗（HTTP ${response.status}）`)
        return response.json()
      }),
      // Dedicated endpoint: returns raw { code, name, brand, … } format,
      // no 200-item cap, 5-min browser cache.
      fetch('/api/products/catalog-raw', { cache: 'no-store' }).then(async (response) => {
        if (!response.ok) throw new Error(`產品目錄讀取失敗（HTTP ${response.status}）`)
        return response.json()
      }),
    ])
      .then(([fams, raw]) => {
        setFamilies(Array.isArray(fams) ? fams : [])
        const items: CatalogItem[] = Array.isArray(raw) ? raw : []
        setAllItems(items)
        // JSON 主檔內的售價直接灌入 priceCache，列表立即顯示
        setPriceCache((prev) => {
          const next = new Map(prev)
          for (const it of items) {
            if (it.price != null && !next.has(it.code)) next.set(it.code, it.price)
          }
          return next
        })
      })
      .catch((error) => setLoadError(error instanceof Error ? error.message : '產品目錄暫時無法讀取'))
      .finally(() => setLoading(false))
  }, [canManageProducts, loadAttempt])

  const refreshFamilies = useCallback(async () => {
    const response = await fetch('/api/products/families/manage', { cache: 'no-store' })
    if (!response.ok) throw new Error(`系列資料讀取失敗（HTTP ${response.status}）`)
    const data = await response.json()
    setFamilies(Array.isArray(data) ? data : [])
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

  // Debounced 關鍵字（全目錄已在記憶體，搜尋在 client-side 完成，含停售品）
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebouncedQ(search.trim().toLowerCase()), 250)
  }, [search])

  const isSearching = Boolean(debouncedQ)
  const searchResults = useMemo(() => {
    if (!isSearching) return []
    return allItems.filter((p) =>
      p.code.toLowerCase().includes(debouncedQ) ||
      p.name.toLowerCase().includes(debouncedQ) ||
      (p.brand || '').toLowerCase().includes(debouncedQ) ||
      (p.seriesName || '').toLowerCase().includes(debouncedQ))
  }, [isSearching, allItems, debouncedQ])

  // 有 collectionName 的系列先組成跨分類產品集合；其餘再依主分類分組。
  const familyCollections = useMemo(
    () => splitFamilyCollections(families).collections,
    [families],
  )

  // 系列依主分類分組(以第一個成員 SKU 的主分類為準),照總表主分類順序排。
  // 成員判定三層:coveredSkuCodes(新群組)→ skuMap 值(pattern 型舊系列,seriesCode 非真實前綴)
  // → seriesCode 前綴。孤兒系列(目錄查無成員)落「其他」。
  const familyGroups = useMemo(() => {
    const byCode = new Map(allItems.map((p) => [p.code, p]))
    const byMain = new Map<string, ProductFamily[]>()
    for (const f of families) {
      if (f.collectionName) continue
      const member =
        f.coveredSkuCodes?.map((c) => byCode.get(c)).find(Boolean) ??
        Object.values(f.skuMap ?? {}).map((c) => byCode.get(c)).find(Boolean) ??
        allItems.find((p) => p.code.startsWith(f.seriesCode))
      const main = member?.mainCategory || '其他'
      const list = byMain.get(main) ?? []
      list.push(f)
      byMain.set(main, list)
    }
    const order = new Map(taxonomy.mains.map((m, i) => [m.name, i]))
    return Array.from(byMain.entries())
      .map(([main, fams]) => ({ main, families: fams }))
      .sort((a, b) => (order.get(a.main) ?? 999) - (order.get(b.main) ?? 999))
  }, [families, allItems, taxonomy])

  const toggleFamilyGroup = (main: string) => {
    setOpenFamilyGroups((prev) => {
      const next = new Set(prev)
      if (next.has(main)) next.delete(main); else next.add(main)
      return next
    })
  }

  // After a save, update caches
  const handleSaved = useCallback((skuCode: string, price: number | null, disabled: boolean, priceSource: CatalogItem['priceSource']) => {
    setPriceCache((prev) => {
      const next = new Map(prev)
      next.set(skuCode, price)
      return next
    })
    setAllItems((items) => items.map((item) => item.code === skuCode ? { ...item, disabled, price: price ?? undefined, priceSource } : item))
  }, [])

  const exactFamilyIndex = useMemo(() => buildExactFamilyIndex(families), [families])
  const searchFamilyIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of searchResults) {
      const familyId = exactFamilyIndex.familyIdBySku.get(item.code)
      if (familyId) ids.add(familyId)
    }
    return ids
  }, [exactFamilyIndex, searchResults])
  const groupedSearchFamilies = families.filter((family) =>
    searchFamilyIds.has(family.id) ||
    (!!debouncedQ && (
      family.seriesName.toLowerCase().includes(debouncedQ) ||
      family.seriesCode.toLowerCase().includes(debouncedQ)
    ))
  )
  const standaloneSearchResults = searchResults.filter((item) => !exactFamilyIndex.familyIdBySku.has(item.code))
  const standaloneBrowseItems = useMemo(
    () => allItems.filter((item) => !exactFamilyIndex.familyIdBySku.has(item.code)),
    [allItems, exactFamilyIndex],
  )
  const [standaloneOpen, setStandaloneOpen] = useState(false)
  const [standaloneVisibleCount, setStandaloneVisibleCount] = useState(PAGE_SIZE)
  const categoryItems = useMemo(() => {
    if (!categorySelection) return []
    return allItems.filter((item) =>
      item.mainCategory === categorySelection.main &&
      (!categorySelection.category || item.category === categorySelection.category))
  }, [allItems, categorySelection])
  const categoryFamilyIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of categoryItems) {
      const familyId = exactFamilyIndex.familyIdBySku.get(item.code)
      if (familyId) ids.add(familyId)
    }
    return ids
  }, [categoryItems, exactFamilyIndex])
  const categoryItemCodes = useMemo(
    () => new Set(categoryItems.map((item) => item.code)),
    [categoryItems],
  )
  const categoryFamilies = useMemo(
    () => families.filter((family) => categoryFamilyIds.has(family.id)),
    [families, categoryFamilyIds],
  )
  const categoryStandaloneItems = useMemo(
    () => categoryItems.filter((item) => !exactFamilyIndex.familyIdBySku.has(item.code)),
    [categoryItems, exactFamilyIndex],
  )

  return (
    <>
      {canManageProducts && (
        <div className="card-soft mb-4 flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5" role="status">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xl" aria-hidden="true">✎</span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-stone-800">中央管理編輯模式</p>
            <p className="mt-0.5 text-xs leading-relaxed text-stone-500">可維護商品內容、照片、規格、文件與系列介紹；貨號及 ERP 品名維持唯讀。</p>
          </div>
          <button type="button" onClick={openSeriesAdmin} className="min-h-11 rounded-full bg-brand-500 px-5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 sm:ml-auto">
            管理系列群組
          </button>
        </div>
      )}
      {seriesAdminError && <div className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{seriesAdminError}</div>}
      {/* Keyword search stays available; category browsing happens in dedicated cards below. */}
      <div className="mb-3">
        <input
          type="search"
          aria-label="搜尋產品目錄"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋貨號、品名、品牌…"
          className="input-soft w-full rounded-full px-5 sm:max-w-lg"
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-1 rounded-full bg-stone-100 p-1 sm:inline-grid sm:min-w-96" role="group" aria-label="選擇產品瀏覽模式">
        <button
          type="button"
          aria-pressed={browseMode === 'categories'}
          onClick={() => setBrowseMode('categories')}
          className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-all active:scale-95 ${
            browseMode === 'categories'
              ? 'bg-brand-500 text-white shadow-md shadow-brand-500/25'
              : 'text-stone-500 hover:bg-white hover:text-brand-700'
          }`}
        >
          商品分類總覽
        </button>
        <button
          type="button"
          aria-pressed={browseMode === 'products'}
          onClick={() => setBrowseMode('products')}
          className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-all active:scale-95 ${
            browseMode === 'products'
              ? 'bg-brand-500 text-white shadow-md shadow-brand-500/25'
              : 'text-stone-500 hover:bg-white hover:text-brand-700'
          }`}
        >
          產品清單
        </button>
      </div>

      {/* List guidance */}
      {(isSearching || browseMode === 'products') && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-400">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />已設售價</span>
          <span>{canManageProducts ? '點品名展開介紹；「編輯」可維護照片、規格與文件' : '點品名展開介紹、照片、規格與文件'}</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse motion-reduce:animate-none rounded-2xl bg-stone-100 motion-reduce:animate-none" />
          ))}
        </div>
      ) : loadError ? (
        <div className="card-soft flex flex-col items-center px-5 py-10 text-center" role="alert">
          <span className="text-3xl" aria-hidden="true">⚠️</span>
          <h3 className="mt-3 text-base font-bold text-stone-800">產品目錄載入失敗</h3>
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
        /* ── Search results mode：系列先聚合，未歸屬 SKU 再單列 ── */
        <div className="space-y-4" data-testid="series-search-group">
          <div className="card-soft flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
            <span className="text-sm font-semibold text-stone-700">
              找到 {groupedSearchFamilies.length} 個系列、{standaloneSearchResults.length} 個單品
            </span>
            <button type="button" onClick={() => setSearch('')}
              className="min-h-11 rounded-full px-3 text-xs font-medium text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-700 active:scale-95">
              清除搜尋
            </button>
          </div>

          {groupedSearchFamilies.length > 0 && (
            <section>
              <div className="mb-2 flex items-baseline gap-2 px-1">
                <h3 className="text-sm font-bold text-stone-700">產品清單</h3>
                <span className="text-[11px] text-stone-400">同系列品項已收合</span>
              </div>
              <div className="space-y-3">
                {groupedSearchFamilies.map((family) => (
                  <FamilyCard
                    key={family.id}
                    family={family}
                    allItems={allItems}
                    priceCache={priceCache}
                    onEdit={setEditingItem}
                    onOpenModal={() => setModalFamily(family)}
                    canManageProducts={canManageProducts}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="card-soft overflow-hidden p-0">
            <div className="border-b border-stone-900/[0.06] px-4 py-3 sm:px-5">
              <h3 className="text-sm font-bold text-stone-700">獨立單品</h3>
            </div>
            <div className="max-h-[56vh] overflow-y-auto px-3 py-2 overscroll-contain sm:px-5">
            {groupedSearchFamilies.length === 0 && standaloneSearchResults.length === 0 && (
              <p className="py-8 text-center text-sm text-stone-400">找不到符合的商品</p>
            )}
            {standaloneSearchResults.slice(0, 300).map((item) => (
              <SkuRow
                key={item.code}
                item={item}
                priceCache={priceCache}
                onEdit={setEditingItem}
                canManageProducts={canManageProducts}
              />
            ))}
            {standaloneSearchResults.length > 300 && (
              <p className="py-3 text-center text-xs text-stone-400">僅顯示前 300 筆，請輸入更完整的關鍵字縮小範圍（共 {standaloneSearchResults.length} 筆）</p>
            )}
            {groupedSearchFamilies.length > 0 && standaloneSearchResults.length === 0 && (
              <p className="py-6 text-center text-xs text-stone-400">符合的品項都已收合在上方系列中。</p>
            )}
            </div>
          </section>
        </div>
      ) : (
        /* ── Browse mode：商品分類總覽／產品清單擇一呈現 ── */
        <div className="space-y-6">
          {browseMode === 'categories' ? (
            <div>
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
              <h3 className="text-sm font-bold text-stone-700">📂 商品分類總覽</h3>
              <span className="text-[11px] text-stone-400">11 主分類 × 62 功能分類・點分類直接瀏覽商品(總表 {taxonomy.version})</span>
            </div>
            <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
              {taxonomy.mains.map((m) => (
                <div key={m.id} className="card-soft min-w-[82vw] snap-center p-3 sm:min-w-0 sm:p-4">
                  <MainCategoryArtwork categoryId={m.id} />
                  <button type="button" onClick={() => setCategorySelection({ main: m.name })}
                          className="group mt-2 flex min-h-11 w-full items-center gap-2 rounded-2xl px-1 text-left transition-all active:scale-[0.99]">
                    <span className="font-bold text-stone-800 group-hover:text-brand-600 transition-colors">{m.name}</span>
                    <span className="ml-auto text-xs text-stone-400">{m.count} 項</span>
                  </button>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {m.funcs.map((f) => (
                      <button key={f.id}
                              type="button"
                              disabled={f.count === 0}
                              onClick={() => setCategorySelection({ main: m.name, category: f.name })}
                              className={`min-h-11 rounded-full px-3 py-2 text-[11px] transition-all active:scale-95 ${
                                f.count > 0
                                  ? 'bg-stone-100 text-stone-600 hover:bg-brand-50 hover:text-brand-700'
                                  : 'cursor-not-allowed bg-stone-50 text-stone-300'
                              }`}>
                        {f.name} <span className="opacity-60">{f.count}</span>
                      </button>
                    ))}
                    {m.funcs.length === 0 && <span className="text-[11px] text-stone-300">(暫無細分)</span>}
                  </div>
                </div>
              ))}
            </div>
            </div>
          ) : (
            <>

              {/* Product list:依主分類分組收合，避免大量卡片同時渲染。 */}
              <div>
            <div className="mb-3 flex items-baseline gap-2">
              <h3 className="text-sm font-bold text-stone-700">🗂 產品清單</h3>
              <span className="text-[11px] text-stone-400">{families.length} 個系列・依主分類分組,點開瀏覽</span>
            </div>
            {families.length === 0 ? (
              <p className="text-center py-12 text-sm text-stone-400">目前沒有產品清單</p>
            ) : (
              <div className="space-y-3">
                {familyCollections.map((collection) => {
                  const groupKey = `collection:${collection.name}`
                  const open = openFamilyGroups.has(groupKey)
                  const itemCount = collection.families.reduce(
                    (count, family) => count + explicitFamilySkuCodes(family).length,
                    0,
                  )
                  return (
                    <section key={groupKey} className="card-soft overflow-hidden p-0 ring-1 ring-brand-200/50">
                      <button
                        type="button"
                        onClick={() => toggleFamilyGroup(groupKey)}
                        className="flex min-h-16 w-full items-center gap-3 bg-brand-50/50 px-4 py-3 text-left transition-all hover:bg-brand-50 active:scale-[0.99] sm:px-5"
                        aria-expanded={open}
                      >
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-xl shadow-sm" aria-hidden="true">◫</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-bold uppercase tracking-widest text-brand-600">產品集合</span>
                          <span className="block truncate text-base font-bold text-stone-800">{collection.name}</span>
                          <span className="mt-0.5 block text-xs text-stone-500">{collection.families.length} 個子系列・{itemCount} 個品項</span>
                        </span>
                        <span className="hidden text-xs text-stone-500 sm:block">先選子系列，再選色號與重量／容量</span>
                        <span className={`text-stone-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">▶</span>
                      </button>
                      {open && (
                        <div className="space-y-3 border-t border-stone-900/[0.06] bg-stone-50/50 p-3 sm:p-4">
                          <p className="px-1 text-xs leading-relaxed text-stone-500 sm:hidden">先選子系列，再選色號與重量／容量。</p>
                          {collection.families.map((family) => (
                            <FamilyCard
                              key={family.id}
                              family={family}
                              allItems={allItems}
                              priceCache={priceCache}
                              onEdit={setEditingItem}
                              onOpenModal={() => setModalFamily(family)}
                              canManageProducts={canManageProducts}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  )
                })}
                {familyGroups.map(({ main, families: groupFamilies }) => {
                  const open = openFamilyGroups.has(main)
                  return (
                    <section key={main} className="card-soft overflow-hidden p-0">
                      <button
                        type="button"
                        onClick={() => toggleFamilyGroup(main)}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-all hover:bg-brand-50/40 active:scale-[0.99] sm:px-5"
                        aria-expanded={open}
                      >
                        <span className={`text-stone-400 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true">▶</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-stone-700">{main}</span>
                          <span className="mt-0.5 block text-xs text-stone-400">{groupFamilies.length} 個系列</span>
                        </span>
                        <span className="text-xs font-semibold text-brand-600">{open ? '收合' : '瀏覽'}</span>
                      </button>
                      {open && (
                        <div className="space-y-3 border-t border-stone-900/[0.06] bg-stone-50/50 p-3 sm:p-4">
                          {groupFamilies.map((family) => (
                            <FamilyCard
                              key={family.id}
                              family={family}
                              allItems={allItems}
                              priceCache={priceCache}
                              onEdit={setEditingItem}
                              onOpenModal={() => setModalFamily(family)}
                              canManageProducts={canManageProducts}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            )}
              </div>

          {/* Standalone products stay collapsed by default to keep 3,000+ rows manageable. */}
              <section className="card-soft overflow-hidden p-0">
            <button
              type="button"
              onClick={() => {
                setStandaloneOpen((open) => !open)
                if (standaloneOpen) setStandaloneVisibleCount(PAGE_SIZE)
              }}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-all hover:bg-brand-50/40 active:scale-[0.99] sm:px-5"
              aria-expanded={standaloneOpen}
              aria-controls="standalone-product-list"
            >
              <span className={`text-stone-400 transition-transform ${standaloneOpen ? 'rotate-90' : ''}`} aria-hidden="true">▶</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-stone-700">獨立單品</span>
                <span className="mt-0.5 block text-xs text-stone-400">未歸入系列的 {standaloneBrowseItems.length} 個品項</span>
              </span>
              <span className="text-xs font-semibold text-brand-600">{standaloneOpen ? '收合' : '瀏覽'}</span>
            </button>
            {standaloneOpen && (
              <div id="standalone-product-list" className="border-t border-stone-900/[0.06] px-3 py-2 sm:px-5">
                {standaloneBrowseItems.slice(0, standaloneVisibleCount).map((item) => (
                  <SkuRow
                    key={item.code}
                    item={item}
                    priceCache={priceCache}
                    onEdit={setEditingItem}
                    canManageProducts={canManageProducts}
                  />
                ))}
                {standaloneVisibleCount < standaloneBrowseItems.length && (
                  <div className="py-3 text-center">
                    <button
                      type="button"
                      onClick={() => setStandaloneVisibleCount((count) => count + PAGE_SIZE)}
                      className="min-h-11 rounded-full bg-brand-50 px-5 text-xs font-semibold text-brand-700 transition-all hover:bg-brand-100 active:scale-95"
                    >
                      再顯示 {Math.min(PAGE_SIZE, standaloneBrowseItems.length - standaloneVisibleCount)} 筆
                    </button>
                  </div>
                )}
              </div>
            )}
              </section>
            </>
          )}
        </div>
      )}

      {/* Category card window: bottom sheet on phones, centered card on larger screens. */}
      <AnimatePresence>
        {categorySelection && (
          <CategoryBrowserModal
            key={`${categorySelection.main}:${categorySelection.category || '*'}`}
            selection={categorySelection}
            totalItems={categoryItems.length}
            itemCodes={categoryItemCodes}
            families={categoryFamilies}
            standaloneItems={categoryStandaloneItems}
            allItems={allItems}
            priceCache={priceCache}
            canManageProducts={canManageProducts}
            onClose={() => setCategorySelection(null)}
            onOpenFamily={setModalFamily}
            onEdit={setEditingItem}
          />
        )}
      </AnimatePresence>

      {/* Edit Drawer */}
      <AnimatePresence>
        {canManageProducts && editingItem && (
          <ProductEditDrawer
            key={editingItem.code}
            skuCode={editingItem.code}
            onClose={() => setEditingItem(null)}
            onSaved={handleSaved}
            onFamilyChanged={refreshFamilies}
            allFamilies={families}
          />
        )}
      </AnimatePresence>

      {/* Series Modal */}
      <AnimatePresence>
        {modalFamily && (
          <SeriesModal
            family={modalFamily}
            allItems={allItems}
            onEdit={(item) => { setModalFamily(null); setEditingItem(item) }}
            onClose={() => setModalFamily(null)}
            canManageProducts={canManageProducts}
          />
        )}
      </AnimatePresence>

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
