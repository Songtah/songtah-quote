'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FamilySpecPanel, YMHToothGridPanel } from '@/components/FamilySpecPicker'
import { SeriesModal } from '@/components/SeriesModal'
import { MainCategoryArtwork, SeriesArtwork } from '@/components/product-series/SeriesArtwork'
import { buildExactFamilyIndex, explicitFamilySkuCodes } from '@/lib/product-family-members'
import { useSession } from 'next-auth/react'

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
  price?: number      // 售價（products_catalog.json 靜態維護）
  salePrice?: number
  spec?: string
  discontinued?: boolean
  status?: string   // 已停售／未販售
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
  skuPattern?: string
  namePattern?: string
  uiVariant?: string
  coveredSkuCodes?: string[]
}

interface RichData {
  notionId: string | null
  price: number | null
  imageUrl: string
  description: string
}

// ── Props ─────────────────────────────────────────────────────

interface Props {
  brands: string[]
  categories: string[]
  productTypes: string[]
  taxonomy: TaxonomyBrowser
}

// 主分類→功能分類主樹(伺服器端由 data/product-taxonomy.json + catalog 計數而來)
interface TaxonomyFunc { id: string; name: string; count: number }
interface TaxonomyMain { id: string; name: string; count: number; funcs: TaxonomyFunc[] }
interface TaxonomyBrowser {
  version: string
  mains: TaxonomyMain[]
  productForms: { name: string; count: number }[]
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
      <div className="flex gap-1 mb-3 p-1 bg-gray-100 rounded-xl w-fit">
        {(['upload', 'url'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={[
              'px-4 py-1.5 rounded-lg text-xs font-semibold transition',
              tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700',
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
            className={[
              'relative w-full rounded-2xl border-2 border-dashed transition cursor-pointer overflow-hidden',
              dragging  ? 'border-brand-400 bg-brand-50 scale-[1.01]' :
              uploading ? 'border-blue-300 bg-blue-50 cursor-default' :
                          'border-gray-200 bg-gray-50 hover:border-brand-300 hover:bg-brand-50/40',
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
                    <svg className="animate-spin h-8 w-8 text-brand-400" viewBox="0 0 24 24" fill="none">
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
                    <span className="text-4xl text-gray-300">🖼</span>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-gray-600">拖曳圖片到這裡</p>
                      <p className="text-xs text-gray-400 mt-1">或點擊選擇檔案</p>
                    </div>
                    <span className="text-xs text-gray-300 bg-white border border-gray-200 px-3 py-1 rounded-full">
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
            <p className="text-xs text-red-500 mt-2">{uploadErr}</p>
          )}
          {previewUrl && !imgError && (
            <button
              type="button"
              onClick={() => { onUrlChange(''); setImgError(false) }}
              className="mt-2 text-xs text-gray-400 hover:text-red-500 transition"
            >
              ✕ 移除圖片
            </button>
          )}
        </>
      ) : (
        /* URL tab */
        <>
          {previewUrl && !imgError && (
            <div className="mb-3 w-full h-44 rounded-2xl overflow-hidden bg-gray-50 border border-gray-200">
              <img src={previewUrl} alt="預覽" className="w-full h-full object-contain"
                onError={() => setImgError(true)} />
            </div>
          )}
          <input
            type="url"
            value={imageUrl}
            onChange={(e) => { onUrlChange(e.target.value); setImgError(false) }}
            placeholder="貼上圖片網址（https://…）"
            className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
            disabled={disabled}
          />
          <p className="text-xs text-gray-400 mt-1.5">
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
        className={[
          'relative w-full rounded-2xl border-2 border-dashed transition',
          disabled || isUploading ? 'cursor-default' : 'cursor-pointer',
          dragging   ? 'border-brand-400 bg-brand-50 scale-[1.01]' :
          isUploading ? 'border-blue-300 bg-blue-50' :
                        'border-gray-200 bg-gray-50 hover:border-brand-300 hover:bg-brand-50/40',
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
                <span className="text-4xl text-gray-300">🗂</span>
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-600">拖曳多張圖片到這裡</p>
                  <p className="text-xs text-gray-400 mt-1">或點擊選擇檔案（可複選）</p>
                </div>
                <span className="text-xs text-gray-300 bg-white border border-gray-200 px-3 py-1 rounded-full">
                  JPG / PNG / WebP · 支援批次上傳
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-4 px-4">
            {isUploading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-brand-400" viewBox="0 0 24 24" fill="none">
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
                <span className="text-base text-gray-400">＋</span>
                <span className="text-sm font-medium text-gray-500">繼續新增圖片</span>
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
                    ? 'cursor-default border-gray-200'
                    : dragSrc === i
                    ? 'opacity-40 scale-95 border-brand-300 border-dashed cursor-grabbing'
                    : dragOver === i
                    ? 'ring-2 ring-brand-400 ring-offset-1 scale-[1.04] border-brand-300 cursor-grab'
                    : 'border-gray-200 cursor-grab active:cursor-grabbing',
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
                      <div className="bg-black/40 rounded px-1 py-0.5 text-white text-[10px] leading-none">⠿</div>
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
                    <div className="absolute bottom-1 left-1 bg-black/40 text-white text-[9px] px-1 py-0.5 rounded pointer-events-none">
                      {i + 1}
                    </div>
                  </>
                )}

                {/* ── Position-edit mode overlay ── */}
                {isPosEdit && (
                  <>
                    <div className="absolute inset-0 bg-brand-900/10 pointer-events-none" />
                    <div className="absolute top-1 left-1 right-1 flex items-center justify-between pointer-events-none">
                      <span className="bg-brand-600/90 text-white text-[9px] px-1.5 py-0.5 rounded font-medium">
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
              className="relative aspect-square rounded-xl overflow-hidden bg-white border border-gray-200">
              <img src={task.preview} alt="上傳中" className="w-full h-full object-cover" />
              {/* Status overlay */}
              <div className={[
                'absolute inset-0 flex flex-col items-center justify-center gap-1',
                task.status === 'error' ? 'bg-red-900/65' :
                task.status === 'done'  ? 'bg-emerald-900/50' :
                                          'bg-black/55',
              ].join(' ')}>
                {(task.status === 'compressing' || task.status === 'uploading') && (
                  <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24" fill="none">
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
        <p className="mt-1.5 text-[11px] text-gray-400">
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
        className={[
          'relative w-full rounded-2xl border-2 border-dashed transition',
          disabled || isUploading ? 'cursor-default' : 'cursor-pointer',
          dragging    ? 'border-brand-400 bg-brand-50 scale-[1.01]' :
          isUploading ? 'border-blue-300 bg-blue-50' :
                        'border-gray-200 bg-gray-50 hover:border-brand-300 hover:bg-brand-50/40',
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
                <span className="text-3xl text-gray-300">📁</span>
                <div className="text-center">
                  <p className="text-sm font-semibold text-gray-600">拖曳文件到這裡</p>
                  <p className="text-xs text-gray-400 mt-0.5">或點擊選擇檔案</p>
                </div>
                <span className="text-xs text-gray-300 bg-white border border-gray-200 px-3 py-1 rounded-full">
                  PDF · Word · Excel · PPT · ZIP · 最大 4 MB
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 py-3.5 px-4">
            {isUploading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-brand-400" viewBox="0 0 24 24" fill="none">
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
                <span className="text-gray-400">＋</span>
                <span className="text-sm font-medium text-gray-500">繼續上傳文件</span>
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
        <div className="mt-2 rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
          {/* Saved docs */}
          {docs.map((doc, i) => (
            <div key={`${doc.url}-${i}`}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 group transition">
              <span className="text-xl shrink-0">{docIcon(doc.name)}</span>
              <div className="flex-1 min-w-0">
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-gray-800 hover:text-brand-600 hover:underline truncate block"
                  title={doc.name}
                >
                  {doc.name}
                </a>
                <p className="text-[11px] text-gray-400 mt-0.5">{formatFileSize(doc.size)}</p>
              </div>
              {/* Download */}
              <a
                href={doc.url}
                download={doc.name}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-500
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
                           text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100
                           transition disabled:hidden"
                title="移除"
              >✕</button>
            </div>
          ))}

          {/* Uploading tasks */}
          {tasks.map((task) => (
            <div key={task.id} className={[
              'flex items-center gap-3 px-3 py-2.5',
              task.status === 'error' ? 'bg-red-50' : 'bg-blue-50/40',
            ].join(' ')}>
              <span className="text-xl shrink-0">
                {task.status === 'uploading' ? (
                  <svg className="animate-spin h-5 w-5 text-brand-400 mt-0.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                ) : task.status === 'done' ? '✅' : '❌'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate">{task.name}</p>
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
                  className="shrink-0 text-xs text-gray-400 hover:text-red-500 transition">
                  移除
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {docs.length > 0 && (
        <p className="mt-1.5 text-[11px] text-gray-400">
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
    gridTemplateColumns: `repeat(${colCount}, minmax(72px, 1fr)) 28px`,
  }

  const hdrInput = [
    'w-full px-2.5 py-2 text-xs font-semibold text-slate-600 bg-transparent',
    'border-0 focus:outline-none focus:bg-brand-50/70 rounded',
    'placeholder:text-gray-300 disabled:opacity-50',
  ].join(' ')

  const cellInput = [
    'w-full px-2.5 py-2 text-sm text-gray-800 bg-transparent',
    'border-0 focus:outline-none focus:bg-brand-50/70 rounded',
    'placeholder:text-gray-300 disabled:opacity-50',
  ].join(' ')

  return (
    <div>
      <div className="border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">

        {/* ── Header row ─────────────────────────────────────── */}
        <div style={gridStyle} className="bg-slate-50 border-b border-gray-200">
          {specs.columns.map((col, ci) => (
            <div key={ci} className="relative group flex items-center border-r border-gray-200"
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
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded flex items-center justify-center
                             text-[10px] leading-none text-gray-300 hover:text-red-500 hover:bg-red-50
                             opacity-0 group-hover:opacity-100 transition disabled:hidden"
                >✕</button>
              )}
            </div>
          ))}
          {/* Add column */}
          <div className="flex items-center justify-center border-l border-gray-200">
            <button
              type="button"
              onClick={addCol}
              disabled={disabled}
              title="新增欄"
              className="w-5 h-5 flex items-center justify-center rounded-full
                         text-sm font-bold leading-none
                         text-gray-400 hover:text-brand-600 hover:bg-brand-50
                         transition disabled:opacity-30"
            >＋</button>
          </div>
        </div>

        {/* ── Data rows ──────────────────────────────────────── */}
        {specs.rows.map((row, ri) => (
          <div key={ri} style={gridStyle}
            className="group border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors">
            {row.map((cell, ci) => (
              <div key={ci} className="border-r border-gray-100"
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
                className="w-5 h-5 flex items-center justify-center rounded-full
                           text-[11px] leading-none
                           text-gray-300 hover:text-red-500 hover:bg-red-50
                           opacity-0 group-hover:opacity-100 transition disabled:hidden"
              >✕</button>
            </div>
          </div>
        ))}

        {/* ── Empty state ────────────────────────────────────── */}
        {rowCount === 0 && (
          <div className="py-5 text-center text-xs text-gray-400 select-none">
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
  allFamilies,
}: {
  skuCode: string
  onClose: () => void
  onSaved: (skuCode: string, price: number | null, imageUrl: string) => void
  allFamilies: ProductFamily[]
}) {
  const [catalog, setCatalog] = useState<CatalogItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  // Form state
  const [price,         setPrice]         = useState('')
  const [imageUrl,      setImageUrl]      = useState('')
  const [description,   setDescription]   = useState('')
  const [specs,         setSpecs]         = useState<SpecTable>(defaultSpecs())
  const [galleryImages, setGalleryImages] = useState<GalleryImage[]>([])
  const [docs,          setDocs]          = useState<DocFile[]>([])

  // Family assignment state
  const [selectedFamilyId, setSelectedFamilyId] = useState('')
  const [familySaving,     setFamilySaving]      = useState(false)
  const [familySaved,      setFamilySaved]        = useState(false)
  const [familyError,      setFamilyError]        = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    fetch(`/api/products/sku/${encodeURIComponent(skuCode)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return }
        setCatalog(data.catalog)
        setPrice(data.rich.price != null ? String(data.rich.price) : '')
        setImageUrl(data.rich.imageUrl ?? '')
        setDescription(data.rich.description ?? '')
        setSpecs(parseSpecs(data.rich.specsJson ?? ''))
        setGalleryImages(parseGallery(data.rich.galleryJson ?? '[]'))
        setSelectedFamilyId(data.rich.familyId ?? '')
        try {
          const parsed = JSON.parse(data.rich.docsJson ?? '[]')
          setDocs(Array.isArray(parsed) ? parsed : [])
        } catch {
          setDocs([])
        }
      })
      .catch(() => setError('無法載入商品資料'))
      .finally(() => setLoading(false))
  }, [skuCode])

  const handleSaveFamily = async (familyIdToSave: string) => {
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
        setFamilySaved(true)
        setTimeout(() => setFamilySaved(false), 2000)
      }
    } catch (err: any) {
      setFamilyError(err.message ?? '網路中斷，請稍後再試')
    } finally {
      setFamilySaving(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    const priceNum = price.trim() !== '' ? Number(price) : null
    if (price.trim() !== '' && isNaN(priceNum!)) {
      setError('售價必須為數字')
      setSaving(false)
      return
    }
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
        body: JSON.stringify({ price: priceNum, imageUrl: imageUrl.trim(), description, specsJson, galleryJson, docsJson }),
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
    setSaving(false)
    onSaved(skuCode, priceNum, imageUrl.trim())
    onClose()
  }

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <motion.div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }} onClick={onClose}
      />

      <motion.div
        className="relative ml-auto w-full max-w-lg h-full bg-white shadow-2xl flex flex-col overflow-hidden"
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {/* Header */}
        <div className="px-4 sm:px-6 pt-6 pb-4 sm:py-5 border-b border-gray-100 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-500 mb-1">編輯商品</p>
            <h2 className="text-lg font-bold text-slate-900 leading-snug">
              {loading ? '載入中…' : (catalog?.name ?? skuCode)}
            </h2>
            <p className="text-xs font-mono text-gray-400 mt-0.5">{skuCode}</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {catalog && (
            <div className="bg-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-2">基本資料</p>
              {[['品牌', catalog.brand], ['分類', catalog.category], ['商品類型', catalog.productType]].map(
                ([label, val]) => val ? (
                  <div key={label} className="flex gap-3 text-sm py-1">
                    <span className="text-slate-400 w-20 shrink-0">{label}</span>
                    <span className="text-slate-700 font-medium">{val}</span>
                  </div>
                ) : null
              )}
            </div>
          )}

          {/* 系列群組 — family assignment */}
          <div className="bg-gray-50 rounded-xl p-4 mb-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">系列群組</p>
            <div className="space-y-3">
              <select
                value={selectedFamilyId}
                onChange={(e) => setSelectedFamilyId(e.target.value)}
                disabled={loading || familySaving}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent bg-white disabled:opacity-50"
              >
                <option value="">— 未指定（依貨號自動歸類）—</option>
                {[...allFamilies].sort((a, b) => a.seriesName.localeCompare(b.seriesName, 'zh-TW')).map((f) => (
                  <option key={f.id} value={f.id}>{f.seriesName} ({f.brand})</option>
                ))}
              </select>

              {familyError && (
                <p className="text-xs text-red-500">{familyError}</p>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSaveFamily(selectedFamilyId)}
                  disabled={loading || familySaving}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {familySaving ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
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
                    disabled={loading || familySaving}
                    className="px-4 py-2 rounded-lg text-xs font-medium border border-gray-300 text-gray-500 hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-50"
                  >
                    清除手動指定
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 售價 */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              售價 <span className="text-gray-400 font-normal text-xs">（NT$）</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">NT$</span>
              <input
                type="number" min={0} value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="尚未設定"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
                disabled={loading}
              />
            </div>
          </div>

          {/* 商品圖片 */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">商品圖片</label>
            <ImageUploadZone
              imageUrl={imageUrl}
              onUrlChange={setImageUrl}
              disabled={loading}
            />
          </div>

          {/* 形象素材 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold text-slate-700">形象素材</label>
              <span className="text-[10px] text-gray-400">可上傳多張・拖曳或點選圖片複選</span>
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
              <label className="block text-sm font-semibold text-slate-700">文件資料</label>
              <span className="text-[10px] text-gray-400">PDF / Word / Excel / PPT・最大 4 MB</span>
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
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">商品介紹</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="填入產品特色、規格說明、使用注意事項…"
              rows={6}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent leading-relaxed"
              disabled={loading}
            />
          </div>

          {/* 技術規格 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-semibold text-slate-700">技術規格</label>
              <span className="text-[10px] text-gray-400">點擊欄位名稱可修改・Tab 鍵跳格・最後格自動新增列</span>
            </div>
            <SpecsEditor
              specs={specs}
              onChange={setSpecs}
              disabled={loading}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
          <button onClick={onClose} disabled={saving}
            className="px-5 py-2 rounded-full text-sm font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">
            取消
          </button>
          <button onClick={handleSave} disabled={loading || saving}
            className="px-6 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition disabled:opacity-50 flex items-center gap-2">
            {saving && (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
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

// ── Product Detail Card ───────────────────────────────────────

function ProductDetailCard({
  skuCode,
  onClose,
  onEdit,
}: {
  skuCode: string
  onClose: () => void
  onEdit:  () => void
}) {
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [catalog, setCatalog] = useState<CatalogItem | null>(null)
  const [rich,    setRich]    = useState<{
    price:       number | null
    imageUrl:    string
    description: string
    specsJson:   string
    galleryJson: string
    docsJson:    string
  } | null>(null)

  useEffect(() => {
    setLoading(true); setError('')
    fetch(`/api/products/sku/${encodeURIComponent(skuCode)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return }
        setCatalog(data.catalog)
        setRich(data.rich)
      })
      .catch(() => setError('無法載入商品資料'))
      .finally(() => setLoading(false))
  }, [skuCode])

  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  const specs: SpecTable = rich ? parseSpecs(rich.specsJson) : defaultSpecs()
  const galleryImages: GalleryImage[] = parseGallery(rich?.galleryJson ?? '[]')
  const docs: DocFile[] = (() => {
    try { const p = JSON.parse(rich?.docsJson ?? '[]'); return Array.isArray(p) ? p : [] } catch { return [] }
  })()

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxIdx !== null) { setLightboxIdx(null); return }
        onClose()
      }
      if (lightboxIdx !== null) {
        if (e.key === 'ArrowRight')
          setLightboxIdx((i) => i !== null ? Math.min(i + 1, galleryImages.length - 1) : null)
        if (e.key === 'ArrowLeft')
          setLightboxIdx((i) => i !== null ? Math.max(i - 1, 0) : null)
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose, lightboxIdx, galleryImages.length])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const hasAnyRich = rich && (
    rich.imageUrl || rich.description || rich.price != null ||
    specs.rows.length > 0 || galleryImages.length > 0 || docs.length > 0
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-3 pb-3 pt-14 sm:p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
      />

      <motion.div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        exit={{    opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {/* ── Header ───────────────────────────────────────── */}
        <div className="px-4 sm:px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {/* Tags */}
              {catalog && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {catalog.brand && (
                    <span className="text-xs font-semibold bg-brand-50 text-brand-700 px-2 py-0.5 rounded-full">
                      {catalog.brand}
                    </span>
                  )}
                  {catalog.category && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                      {catalog.category}
                    </span>
                  )}
                  {catalog.productType && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                      {catalog.productType}
                    </span>
                  )}
                </div>
              )}
              <h2 className="text-xl font-bold text-slate-900 leading-snug">
                {loading ? '載入中…' : (catalog?.name ?? skuCode)}
              </h2>
              <p className="text-xs font-mono text-gray-400 mt-1">{skuCode}</p>
            </div>
            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0 mt-0.5">
              {!loading && !error && (
                <button
                  onClick={onEdit}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 text-gray-600
                             hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition"
                >
                  ✏️ 編輯
                </button>
              )}
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
              >✕</button>
            </div>
          </div>
        </div>

        {/* ── Body ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-24">
              <svg className="animate-spin h-6 w-6 text-brand-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path  className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="m-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {/* Empty (no rich data yet) */}
          {!loading && !error && !hasAnyRich && (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
              <span className="text-5xl">📦</span>
              <p className="text-sm">尚未填寫商品資料</p>
              <button
                onClick={onEdit}
                className="mt-1 text-xs font-medium text-brand-600 hover:text-brand-700 underline"
              >點擊「編輯」開始填寫</button>
            </div>
          )}

          {/* Content */}
          {!loading && !error && hasAnyRich && (
            <>
              {/* ── Top: image + price + description ────────── */}
              <div className="p-4 sm:p-6 flex flex-col sm:flex-row gap-4 sm:gap-5">
                {/* Main image */}
                {rich!.imageUrl ? (
                  <div className="w-full sm:w-44 sm:h-44 aspect-square sm:aspect-auto shrink-0 rounded-xl overflow-hidden bg-white border border-gray-200 shadow-sm">
                    <img src={rich!.imageUrl} alt={catalog?.name} className="w-full h-full object-contain"/>
                  </div>
                ) : (
                  <div className="w-full sm:w-44 sm:h-44 aspect-square sm:aspect-auto shrink-0 rounded-xl bg-gray-50 border border-dashed border-gray-200
                                  flex items-center justify-center">
                    <span className="text-5xl text-gray-200">🖼</span>
                  </div>
                )}

                {/* Price + description */}
                <div className="flex-1 min-w-0">
                  {rich!.price != null && (
                    <div className="mb-4">
                      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-widest mb-0.5">售價</p>
                      <p className="text-2xl font-bold text-slate-900">
                        NT${rich!.price.toLocaleString('zh-TW')}
                      </p>
                    </div>
                  )}
                  {rich!.description ? (
                    <div>
                      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-widest mb-1.5">商品介紹</p>
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {rich!.description}
                      </p>
                    </div>
                  ) : !rich!.price && (
                    <p className="text-sm text-gray-400 italic mt-2">尚未填寫介紹與售價</p>
                  )}
                </div>
              </div>

              {/* ── Technical specs ──────────────────────────── */}
              {specs.rows.length > 0 && (
                <div className="px-4 sm:px-6 pb-4 sm:pb-6">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">技術規格</p>
                  <div className="border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
                    {/* Header */}
                    <div className="bg-slate-50 border-b border-gray-200"
                      style={{ display: 'grid', gridTemplateColumns: `repeat(${specs.columns.length}, minmax(80px, 1fr))` }}>
                      {specs.columns.map((col, ci) => (
                        <div key={ci} className={`px-3 py-2 text-xs font-semibold text-slate-600 ${ci < specs.columns.length - 1 ? 'border-r border-gray-200' : ''}`}>
                          {col}
                        </div>
                      ))}
                    </div>
                    {/* Rows */}
                    {specs.rows.map((row, ri) => (
                      <div key={ri} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors"
                        style={{ display: 'grid', gridTemplateColumns: `repeat(${specs.columns.length}, minmax(80px, 1fr))` }}>
                        {row.map((cell, ci) => (
                          <div key={ci} className={`px-3 py-2 text-sm text-gray-700 ${ci < specs.columns.length - 1 ? 'border-r border-gray-100' : ''}`}>
                            {cell || <span className="text-gray-300">—</span>}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Gallery ──────────────────────────────────── */}
              {galleryImages.length > 0 && (
                <div className="px-6 pb-6">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">
                    形象素材 <span className="text-gray-300 font-normal normal-case tracking-normal">（點擊放大）</span>
                  </p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {galleryImages.map((img, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setLightboxIdx(i)}
                        className="shrink-0 w-28 h-28 rounded-xl overflow-hidden bg-white border border-gray-200
                                   hover:border-brand-300 hover:shadow-md transition-all focus:outline-none"
                      >
                        <img src={img.url} alt={`素材 ${i + 1}`} className="w-full h-full object-cover"
                          style={{ objectPosition: img.pos }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Documents ────────────────────────────────── */}
              {docs.length > 0 && (
                <div className="px-6 pb-6">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3">文件資料</p>
                  <div className="rounded-xl border border-gray-200 overflow-hidden divide-y divide-gray-100">
                    {docs.map((doc, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition">
                        <span className="text-xl shrink-0">{docIcon(doc.name)}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{doc.name}</p>
                          <p className="text-[11px] text-gray-400">{formatFileSize(doc.size)}</p>
                        </div>
                        <a href={doc.url} download={doc.name} target="_blank" rel="noopener noreferrer"
                          className="shrink-0 text-xs px-3 py-1 rounded-lg border border-gray-200 text-gray-500
                                     hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition">
                          下載
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Lightbox ─────────────────────────────────────── */}
        <AnimatePresence>
          {lightboxIdx !== null && galleryImages[lightboxIdx] && (
            <motion.div
              className="absolute inset-0 z-10 flex items-center justify-center bg-black/90 rounded-2xl"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setLightboxIdx(null)}
            >
              {/* Image */}
              <motion.img
                key={lightboxIdx}
                src={galleryImages[lightboxIdx].url}
                alt={`素材 ${lightboxIdx + 1}`}
                className="max-w-full max-h-full object-contain rounded-lg select-none"
                style={{ maxHeight: 'calc(90vh - 80px)', padding: '48px 56px' }}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                onClick={(e) => e.stopPropagation()}
                draggable={false}
              />

              {/* Close button */}
              <button
                type="button"
                onClick={() => setLightboxIdx(null)}
                className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full
                           bg-white/10 text-white hover:bg-white/20 transition text-sm"
              >✕</button>

              {/* Counter */}
              <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/40 text-white text-xs
                              px-3 py-1 rounded-full font-medium pointer-events-none">
                {lightboxIdx + 1} / {galleryImages.length}
              </div>

              {/* Prev */}
              {lightboxIdx > 0 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx - 1) }}
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center
                             rounded-full bg-white/10 text-white hover:bg-white/25 transition text-lg"
                >‹</button>
              )}

              {/* Next */}
              {lightboxIdx < galleryImages.length - 1 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setLightboxIdx(lightboxIdx + 1) }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center
                             rounded-full bg-white/10 text-white hover:bg-white/25 transition text-lg"
                >›</button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

// ── SKU Row ───────────────────────────────────────────────────

function SkuRow({
  item,
  priceCache,
  imageFlagCache,
  onView,
  onEdit,
}: {
  item: CatalogItem
  priceCache: Map<string, number | null>
  imageFlagCache: Set<string>
  onView: (item: CatalogItem) => void
  onEdit: (item: CatalogItem) => void
}) {
  const hasPrice = priceCache.has(item.code)
  const hasImage = imageFlagCache.has(item.code)
  const price    = priceCache.get(item.code)

  return (
    <div
      onClick={() => onView(item)}
      className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 group
                 cursor-pointer hover:bg-brand-50/40 -mx-2 px-2 rounded-lg transition-colors"
    >
      {/* Image dot */}
      <div className={`w-2 h-2 rounded-full shrink-0 ${hasImage ? 'bg-blue-400' : 'bg-gray-200'}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm text-gray-800 truncate">{item.name}</p>
          {item.discontinued && (
            <span className="shrink-0 text-[10px] font-medium text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
              {item.status || '未販售'}
            </span>
          )}
          {item.needsReview && (
            <span className="shrink-0 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
              分類待覆核
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {item.brand && (
            <span className="text-[10px] font-medium text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded-full shrink-0">
              {item.brand}
            </span>
          )}
          <p className="font-mono text-[11px] text-gray-400 truncate">{item.code}</p>
          {item.category && (
            <span className="text-[10px] text-stone-400 truncate hidden sm:inline">{item.category}</span>
          )}
        </div>
      </div>

      {hasPrice && price != null && (
        <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full shrink-0">
          NT${price.toLocaleString('zh-TW')}
        </span>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onEdit(item) }}
        className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500
                   hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition
                   opacity-0 group-hover:opacity-100"
      >
        編輯
      </button>
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
  imageFlagCache,
  onView,
  onEdit,
  onOpenModal,
}: {
  family: ProductFamily
  allItems: CatalogItem[]
  priceCache: Map<string, number | null>
  imageFlagCache: Set<string>
  onView: (item: CatalogItem) => void
  onEdit: (item: CatalogItem) => void
  onOpenModal?: () => void
}) {
  const [open,         setOpen]         = useState(false)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [introLoading, setIntroLoading] = useState(false)
  const [introData,    setIntroData]    = useState<IntroData | null>(null)
  const introFetched = useRef(false)

  // 系列成員只接受明確 SKU 對照，不用貨號前綴猜測。
  const skuCodes = explicitFamilySkuCodes(family)

  // Match to catalog items
  const items = skuCodes.map((c) => allItems.find((it) => it.code === c)).filter(Boolean) as CatalogItem[]

  if (items.length === 0) return null

  const priceSetCount = items.filter((it) => priceCache.has(it.code) && priceCache.get(it.code) != null).length
  const imageSetCount = items.filter((it) => imageFlagCache.has(it.code)).length
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
          // Try up to 5 members to find one with an image or description
          const candidates = items.slice(0, 5)
          let found: IntroData | null = null
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
        <button
          onClick={handleToggle}
          className={`flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-full text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-700 active:scale-95 ${open ? 'rotate-90' : ''}`}
          aria-label={open ? '收合系列品項' : '展開系列品項'}
        >
          ▶
        </button>
        <button
          onClick={onOpenModal}
          className="min-w-0 flex-1 rounded-2xl px-1 py-1 text-left transition-all hover:bg-brand-50/50 active:scale-[0.99]"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-bold text-stone-800 group-hover:text-brand-700 transition-colors">{family.seriesName}</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-500 font-medium">{family.brand}</span>
            {family.productType && (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-200/60 font-medium">{family.productType}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs text-stone-400">{items.length} 個規格</span>
            {priceSetCount > 0 && <span className="price-pill">✓ {priceSetCount} 已設售價</span>}
            {imageSetCount > 0 && <span className="text-xs font-medium text-brand-600">✓ {imageSetCount} 已設圖片</span>}
          </div>
        </button>
        <span className="hidden shrink-0 text-xs text-stone-400 lg:block">{representative.category}</span>
      </div>

      {/* Expanded: series overview card */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-gray-100 px-5 py-4 space-y-5">

              {/* ── 介紹 ── */}
              {introLoading ? (
                <div className="flex gap-4">
                  <div className="w-24 h-24 rounded-xl bg-gray-100 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 bg-gray-100 rounded animate-pulse w-3/4" />
                    <div className="h-3 bg-gray-100 rounded animate-pulse w-full" />
                    <div className="h-3 bg-gray-100 rounded animate-pulse w-2/3" />
                  </div>
                </div>
              ) : introData?.imageUrl || introData?.description ? (
                <div className="flex gap-4">
                  {introData.imageUrl && introData.notionId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/notion-image?pageId=${introData.notionId}`}
                      alt={family.seriesName}
                      className="w-24 h-24 rounded-xl object-cover shrink-0 border border-gray-100 bg-gray-50"
                    />
                  )}
                  {introData.description && (
                    introData.description.includes('|') ? (
                      <ul className="space-y-1">
                        {introData.description.split('|').map((part, i) => {
                          const t = part.trim()
                          return t ? (
                            <li key={i} className="flex gap-2 text-sm text-gray-600 leading-relaxed">
                              <span className="text-brand-400 shrink-0 mt-0.5 select-none">·</span>
                              <span>{t}</span>
                            </li>
                          ) : null
                        })}
                      </ul>
                    ) : (
                      <p className="text-sm text-gray-600 leading-relaxed">{introData.description}</p>
                    )
                  )}
                </div>
              ) : null}

              {/* ── 規格選擇器（點選縮小範圍，確認此組合是否有貨） ── */}
              {family.skuMap && family.specs.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-1">規格查詢</p>
                  {family.uiVariant === 'ymh-tooth-grid' ? (
                    <YMHToothGridPanel
                      family={family}
                      onAdd={(skuCode) => {
                        const item = allItems.find((it) => it.code === skuCode)
                        if (item) onView(item)
                      }}
                      actionLabel="查看詳情"
                    />
                  ) : (
                    <FamilySpecPanel
                      family={family}
                      onAdd={(skuCode) => {
                        const item = allItems.find((it) => it.code === skuCode)
                        if (item) onView(item)
                      }}
                      actionLabel="查看詳情"
                    />
                  )}
                </div>
              )}

              {/* ── 品項清單 ── */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
                  品項（{items.length}）
                </p>
                <div className="space-y-0.5">
                  {visibleItems.map((item) => (
                    <div
                      key={item.code}
                      className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-gray-50 group cursor-pointer"
                      onClick={() => onView(item)}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${imageFlagCache.has(item.code) ? 'bg-blue-400' : 'bg-gray-200'}`} />
                      <span className="font-mono text-[11px] text-gray-400 w-28 shrink-0">{item.code}</span>
                      <span className="text-sm text-gray-700 flex-1 truncate">{item.name}</span>
                      {priceCache.has(item.code) && priceCache.get(item.code) != null && (
                        <span className="text-xs text-emerald-600 shrink-0">
                          NT${(priceCache.get(item.code) as number).toLocaleString('zh-TW')}
                        </span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onEdit(item) }}
                        className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-400
                                   hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50
                                   opacity-0 group-hover:opacity-100 transition shrink-0"
                      >
                        編輯
                      </button>
                    </div>
                  ))}

                  {remaining > 0 && (
                    <div className="pt-2 text-center">
                      <button
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

// ── Featured Strip ────────────────────────────────────────────

function FeaturedStrip({
  featuredIds,
  families,
  onSelectFamily,
}: {
  featuredIds: string[]
  families: ProductFamily[]
  onSelectFamily: (f: ProductFamily) => void
}) {
  const featuredFamilies = featuredIds
    .map((id) => families.find((f) => f.id === id))
    .filter(Boolean) as ProductFamily[]

  if (featuredFamilies.length === 0) return null

  return (
    <div className="mb-6">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">常用系列</p>
      <div className="flex gap-3 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {featuredFamilies.map((f) => (
          <button
            key={f.id}
            onClick={() => onSelectFamily(f)}
            className="shrink-0 flex flex-col items-start gap-1 px-4 py-3 rounded-2xl border border-gray-200 bg-white hover:border-brand-400 hover:bg-brand-50 transition-colors text-left min-w-[140px] max-w-[180px]"
          >
            <span className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2">{f.seriesName}</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {f.brand && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{f.brand}</span>}
              {f.productType && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">{f.productType}</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Featured Manager (admin only) ────────────────────────────

function FeaturedManager({
  families,
  initialIds,
  onSaved,
}: {
  families: ProductFamily[]
  initialIds: string[]
  onSaved: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set(initialIds))
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Sync initialIds when they change externally
  useEffect(() => { setSelected(new Set(initialIds)) }, [initialIds])

  const filtered = families.filter(
    (f) =>
      !search ||
      f.seriesName.toLowerCase().includes(search.toLowerCase()) ||
      f.brand.toLowerCase().includes(search.toLowerCase())
  )

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const ids = Array.from(selected)
      await fetch('/api/products/featured-families', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyIds: ids }),
      })
      setSaved(true)
      onSaved(ids)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand-600 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        管理常用系列
        {open ? ' ▴' : ' ▾'}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 border border-gray-200 rounded-2xl p-4 bg-white space-y-3">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜尋系列名稱…"
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <div className="max-h-60 overflow-y-auto space-y-1">
                {filtered.map((f) => (
                  <label key={f.id} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.has(f.id)}
                      onChange={() => toggle(f.id)}
                      className="rounded border-gray-300 text-brand-500 focus:ring-brand-400"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-800">{f.seriesName}</span>
                      <span className="text-xs text-gray-400 ml-2">{f.brand}</span>
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-gray-400">已選 {selected.size} 個系列</span>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 transition"
                >
                  {saving ? '儲存中…' : saved ? '✓ 已儲存' : '儲存設定'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────

export function CatalogManagerContent({ brands, categories, productTypes, taxonomy }: Props) {
  const { data: session } = useSession()
  const sessionUser = session?.user as any
  const isAdmin = sessionUser?.role === 'admin' || sessionUser?.accountType === '行政'

  const [families,     setFamilies]     = useState<ProductFamily[]>([])
  const [allItems,     setAllItems]     = useState<CatalogItem[]>([])
  const [loading,      setLoading]      = useState(true)

  const [search,         setSearch]         = useState('')
  const [filterBrand,    setFilterBrand]    = useState('')
  const [filterMain,     setFilterMain]     = useState('')   // 主分類(11)
  const [filterCategory, setFilterCategory] = useState('')   // 功能分類(62)
  const [filterType,     setFilterType]     = useState('')   // 商品型態(9)
  const [filtersOpen,    setFiltersOpen]    = useState(false)

  const [viewingItem,  setViewingItem]  = useState<CatalogItem | null>(null)
  const [editingItem,  setEditingItem]  = useState<CatalogItem | null>(null)
  const [featuredIds,  setFeaturedIds]  = useState<string[]>([])
  const [modalFamily,  setModalFamily]  = useState<ProductFamily | null>(null)

  // Cache: skuCode → price (and whether image is set)
  // Populated lazily as users save products.
  const [priceCache,     setPriceCache]     = useState<Map<string, number | null>>(new Map())
  const [imageFlagCache, setImageFlagCache] = useState<Set<string>>(new Set())

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load families + full catalog on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/products/families').then((r) => r.json()),
      // Dedicated endpoint: returns raw { code, name, brand, … } format,
      // no 200-item cap, 5-min browser cache.
      fetch('/api/products/catalog-raw', { cache: 'no-store' }).then((r) => r.json()),
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
      .catch(console.error)
      .finally(() => setLoading(false))

    fetch('/api/products/featured-families')
      .then((r) => r.json())
      .then((data) => { if (data.familyIds) setFeaturedIds(data.familyIds) })
      .catch(() => {})
  }, [])

  // Debounced 關鍵字(全目錄已在記憶體,搜尋與篩選一律 client-side,含停售品)
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebouncedQ(search.trim().toLowerCase()), 250)
  }, [search])

  const isSearching = !!(debouncedQ || filterBrand || filterMain || filterCategory || filterType)
  const searchLoading = loading

  const searchResults = useMemo(() => {
    if (!isSearching) return []
    let items = allItems
    if (debouncedQ) {
      items = items.filter((p) =>
        p.code.toLowerCase().includes(debouncedQ) ||
        p.name.toLowerCase().includes(debouncedQ) ||
        (p.brand || '').toLowerCase().includes(debouncedQ) ||
        (p.seriesName || '').toLowerCase().includes(debouncedQ))
    }
    if (filterBrand)    items = items.filter((p) => p.brand === filterBrand)
    if (filterMain)     items = items.filter((p) => p.mainCategory === filterMain)
    if (filterCategory) items = items.filter((p) => p.category === filterCategory)
    if (filterType)     items = items.filter((p) => p.productType === filterType)
    return items
  }, [isSearching, allItems, debouncedQ, filterBrand, filterMain, filterCategory, filterType])

  // After a save, update caches
  const handleSaved = useCallback((skuCode: string, price: number | null, imageUrl: string) => {
    setPriceCache((prev) => {
      const next = new Map(prev)
      next.set(skuCode, price)
      return next
    })
    setImageFlagCache((prev) => {
      const next = new Set(prev)
      if (imageUrl) next.add(skuCode)
      else next.delete(skuCode)
      return next
    })
  }, [])

  // 系列的分類:product_families.json 內是舊分類快照,以成員 SKU 的新分類為準
  const familyTaxonomy = useMemo(() => {
    const m = new Map<string, { main: string; category: string; type: string }>()
    const itemByCode = new Map(allItems.map((item) => [item.code, item]))
    for (const f of families) {
      const member = explicitFamilySkuCodes(f)
        .map((code) => itemByCode.get(code))
        .find(Boolean)
      if (member) m.set(f.id, { main: member.mainCategory || '', category: member.category, type: member.productType })
    }
    return m
  }, [families, allItems])

  // Filter families by active filters(依成員 SKU 的新分類)
  const visibleFamilies = families.filter((f) => {
    if (filterBrand && f.brand !== filterBrand) return false
    const tx = familyTaxonomy.get(f.id)
    if (filterMain     && tx?.main     !== filterMain)     return false
    if (filterCategory && tx?.category !== filterCategory) return false
    if (filterType     && tx?.type     !== filterType)     return false
    return true
  })

  const exactFamilyIndex = useMemo(() => buildExactFamilyIndex(families), [families])
  const searchFamilyIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of searchResults) {
      const familyId = exactFamilyIndex.familyIdBySku.get(item.code)
      if (familyId) ids.add(familyId)
    }
    return ids
  }, [exactFamilyIndex, searchResults])
  const groupedSearchFamilies = visibleFamilies.filter((family) =>
    searchFamilyIds.has(family.id) ||
    (!!debouncedQ && (
      family.seriesName.toLowerCase().includes(debouncedQ) ||
      family.seriesCode.toLowerCase().includes(debouncedQ)
    ))
  )
  const standaloneSearchResults = searchResults.filter((item) => !exactFamilyIndex.familyIdBySku.has(item.code))

  const activeFilterCount = (filterBrand ? 1 : 0) + (filterMain ? 1 : 0) + (filterCategory ? 1 : 0) + (filterType ? 1 : 0)
  const clearFilters = () => { setFilterBrand(''); setFilterMain(''); setFilterCategory(''); setFilterType('') }
  // 點主分類:切換選取並清掉不屬於它的功能分類
  const pickMain = (name: string) => {
    setFilterMain((cur) => {
      const next = cur === name ? '' : name
      setFilterCategory('')
      return next
    })
  }
  const selectedMain = taxonomy.mains.find((m) => m.name === filterMain)

  const chip = (active: boolean) => [
    'px-3 py-1 rounded-full text-xs font-medium border transition-all',
    active
      ? 'bg-brand-500 border-brand-500 text-white shadow-sm'
      : 'bg-white border-gray-300 text-gray-600 hover:border-brand-400 hover:text-brand-600',
  ].join(' ')

  return (
    <>
      {/* Featured strip (or admin onboarding card when empty) */}
      {!isSearching && (
        featuredIds.length > 0
          ? <FeaturedStrip featuredIds={featuredIds} families={families} onSelectFamily={setModalFamily} />
          : isAdmin && !loading && (
            <div className="mb-5 flex items-center gap-3 px-4 py-3 rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 text-left">
              <span className="text-2xl shrink-0">⭐</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-600">尚未設定常用系列</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  點擊下方「管理常用系列」，將常用產品系列釘選在頂部快速存取
                </p>
              </div>
            </div>
          )
      )}

      {/* Admin: manage featured series */}
      {isAdmin && !isSearching && (
        <FeaturedManager
          families={families}
          initialIds={featuredIds}
          onSaved={setFeaturedIds}
        />
      )}

      {/* Search + Filters */}
      <div className="mb-6">
        {/* Row: search + filter toggle */}
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋貨號、品名、品牌…"
            className="flex-1 max-w-lg input-soft rounded-full px-5"
          />
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            className={[
              'relative flex items-center gap-1.5 px-4 py-2.5 rounded-full border text-sm font-semibold transition-all active:scale-95 shrink-0',
              filtersOpen || activeFilterCount > 0
                ? 'border-brand-400 bg-brand-50 text-brand-700'
                : 'border-stone-200 bg-white text-stone-600 hover:border-brand-300 hover:text-brand-600 hover:bg-brand-50/40',
            ].join(' ')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 8h10M11 12h2M13 16h-2" />
            </svg>
            篩選
            {activeFilterCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Collapsible filter panel:主分類 → 功能分類 二級聯動 + 商品型態 + 品牌 */}
        <AnimatePresence>
          {filtersOpen && (
            <motion.div
              key="filter-panel"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="pt-3 space-y-2.5">
                {/* 主分類(11,完整) */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5">主分類</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => { setFilterMain(''); setFilterCategory('') }} className={chip(!filterMain)}>全部</button>
                    {taxonomy.mains.map((m) => (
                      <button key={m.id} onClick={() => pickMain(m.name)} className={chip(filterMain === m.name)}>
                        {m.name} <span className="opacity-60">{m.count}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 功能分類(選了主分類 → 顯示其完整功能分類;未選 → 提示) */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5">
                    功能分類{selectedMain ? `(${selectedMain.name})` : ''}
                  </p>
                  {selectedMain ? (
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => setFilterCategory('')} className={chip(!filterCategory)}>全部</button>
                      {selectedMain.funcs.map((f) => (
                        <button key={f.id} onClick={() => setFilterCategory(filterCategory === f.name ? '' : f.name)} className={chip(filterCategory === f.name)}>
                          {f.name} <span className="opacity-60">{f.count}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">先選主分類,即顯示其下全部功能分類(共 62 類,亦可從下方「商品分類總覽」直接點選)</p>
                  )}
                </div>

                {/* 商品型態(9) */}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5">商品型態</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button onClick={() => setFilterType('')} className={chip(!filterType)}>全部</button>
                    {taxonomy.productForms.map((t) => (
                      <button key={t.name} onClick={() => setFilterType(filterType === t.name ? '' : t.name)} className={chip(filterType === t.name)}>
                        {t.name} <span className="opacity-60">{t.count}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Brand filter */}
                {brands.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-1.5">品牌</p>
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => setFilterBrand('')} className={chip(!filterBrand)}>全部</button>
                      {brands.map((b) => (
                        <button key={b} onClick={() => setFilterBrand(filterBrand === b ? '' : b)} className={chip(filterBrand === b)}>
                          {b}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Clear all */}
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-xs text-gray-400 hover:text-red-500 transition"
                  >
                    ✕ 清除全部篩選
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />已設圖片</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-200 inline-block" />未設圖片</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />已設售價</span>
        <span className="text-gray-300">· 滑鼠移到商品列可見「編輯」按鈕</span>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 rounded-2xl bg-gray-100 animate-pulse" />
          ))}
        </div>
      ) : isSearching ? (
        /* ── Search results mode：系列先聚合，未歸屬 SKU 再單列 ── */
        <div className="space-y-4" data-testid="series-search-group">
          <div className="card-soft flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5">
            <span className="text-sm font-semibold text-stone-700">
              找到 {groupedSearchFamilies.length} 個系列、{standaloneSearchResults.length} 個單品
              {(filterMain || filterCategory || filterType) && (
                <span className="ml-2 text-xs font-normal text-brand-600">
                  {[filterMain, filterCategory, filterType].filter(Boolean).join(' › ')}
                </span>
              )}
            </span>
            <button onClick={() => { setSearch(''); clearFilters() }}
              className="min-h-11 rounded-full px-3 text-xs font-medium text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-700 active:scale-95">
              清除篩選
            </button>
          </div>

          {groupedSearchFamilies.length > 0 && (
            <section>
              <div className="mb-2 flex items-baseline gap-2 px-1">
                <h3 className="text-sm font-bold text-stone-700">產品系列</h3>
                <span className="text-[11px] text-stone-400">相同系列規格已收合</span>
              </div>
              <div className="space-y-3">
                {groupedSearchFamilies.map((family) => (
                  <FamilyCard
                    key={family.id}
                    family={family}
                    allItems={allItems}
                    priceCache={priceCache}
                    imageFlagCache={imageFlagCache}
                    onView={setViewingItem}
                    onEdit={setEditingItem}
                    onOpenModal={() => setModalFamily(family)}
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
                imageFlagCache={imageFlagCache}
                onView={setViewingItem}
                onEdit={setEditingItem}
              />
            ))}
            {standaloneSearchResults.length > 300 && (
              <p className="py-3 text-center text-xs text-stone-400">僅顯示前 300 筆，請加關鍵字或功能分類縮小範圍（共 {standaloneSearchResults.length} 筆）</p>
            )}
            {groupedSearchFamilies.length > 0 && standaloneSearchResults.length === 0 && (
              <p className="py-6 text-center text-xs text-stone-400">符合的品項都已收合在上方系列中。</p>
            )}
            </div>
          </section>
        </div>
      ) : (
        /* ── Browse mode:商品分類總覽(11 主分類 × 62 功能分類完整呈現)+ 系列 ── */
        <div className="space-y-6">
          <div>
            <div className="flex items-baseline gap-2 mb-3">
              <h3 className="text-sm font-bold text-stone-700">📂 商品分類總覽</h3>
              <span className="text-[11px] text-stone-400">11 主分類 × 62 功能分類・點分類直接瀏覽商品(總表 {taxonomy.version})</span>
            </div>
            <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
              {taxonomy.mains.map((m) => (
                <div key={m.id} className="card-soft min-w-[82vw] snap-center p-3 sm:min-w-0 sm:p-4">
                  <MainCategoryArtwork categoryId={m.id} />
                  <button onClick={() => { pickMain(m.name); setFiltersOpen(true) }}
                          className="group mt-2 flex min-h-11 w-full items-center gap-2 rounded-2xl px-1 text-left transition-all active:scale-[0.99]">
                    <span className="font-bold text-stone-800 group-hover:text-brand-600 transition-colors">{m.name}</span>
                    <span className="ml-auto text-xs text-stone-400">{m.count} 項</span>
                  </button>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {m.funcs.map((f) => (
                      <button key={f.id}
                              onClick={() => { setFilterMain(m.name); setFilterCategory(f.name) }}
                              className={`min-h-10 rounded-full px-3 py-2 text-[11px] transition-all active:scale-95 ${
                                f.count > 0
                                  ? 'bg-stone-100 text-stone-600 hover:bg-brand-50 hover:text-brand-700'
                                  : 'bg-stone-50 text-stone-300'
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

          {/* Family browse */}
          <div>
            <div className="flex items-baseline gap-2 mb-3">
              <h3 className="text-sm font-bold text-stone-700">🗂 產品系列</h3>
              <span className="text-[11px] text-stone-400">{visibleFamilies.length} 個系列</span>
            </div>
            <div className="space-y-3">
              {visibleFamilies.length === 0 && (
                <p className="text-center py-12 text-sm text-gray-400">沒有符合條件的系列</p>
              )}
              {visibleFamilies.map((family) => (
                <FamilyCard
                  key={family.id}
                  family={family}
                  allItems={allItems}
                  priceCache={priceCache}
                  imageFlagCache={imageFlagCache}
                  onView={setViewingItem}
                  onEdit={setEditingItem}
                  onOpenModal={() => setModalFamily(family)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Detail Card */}
      <AnimatePresence>
        {viewingItem && !editingItem && (
          <ProductDetailCard
            key={`view-${viewingItem.code}`}
            skuCode={viewingItem.code}
            onClose={() => setViewingItem(null)}
            onEdit={() => {
              const item = viewingItem
              setViewingItem(null)
              setEditingItem(item)
            }}
          />
        )}
      </AnimatePresence>

      {/* Edit Drawer */}
      <AnimatePresence>
        {editingItem && (
          <ProductEditDrawer
            key={editingItem.code}
            skuCode={editingItem.code}
            onClose={() => setEditingItem(null)}
            onSaved={handleSaved}
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
          />
        )}
      </AnimatePresence>
    </>
  )
}
