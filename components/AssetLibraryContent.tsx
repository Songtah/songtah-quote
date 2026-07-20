'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ASSET_CATEGORIES } from '@/lib/assets-notion'
import type { BrandAsset } from '@/lib/assets-notion'

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (!n) return '—'
  if (n < 1024)       return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

/** Client-side compress: max long edge 1500 px, 80 % JPEG quality */
async function compressImage(
  file: File,
  maxPx = 1500,
  quality = 0.8,
): Promise<{ blob: Blob; width: number; height: number }> {
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
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => {
          if (blob) resolve({ blob, width: w, height: h })
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

async function uploadToBlob(blob: Blob, folder: 'originals' | 'compressed', originalName: string): Promise<string> {
  const ext  = originalName.split('.').pop()?.toLowerCase() ?? 'jpg'
  const file = new File([blob], `upload.${ext}`, { type: blob.type || 'image/jpeg' })
  const fd   = new FormData()
  fd.append('file',   file)
  fd.append('folder', folder)

  const res  = await fetch('/api/assets/upload', { method: 'POST', body: fd })
  const text = await res.text()
  let data: any = {}
  try { data = JSON.parse(text) } catch {
    throw new Error(`伺服器錯誤（HTTP ${res.status}）`)
  }
  if (!res.ok) throw new Error(data.error ?? `上傳失敗（${res.status}）`)
  return data.url as string
}

// ── Tag pill input ─────────────────────────────────────────────────────────────

function TagInput({
  tags,
  onChange,
}: { tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState('')

  const addTag = (raw: string) => {
    const tag = raw.trim()
    if (tag && !tags.includes(tag)) onChange([...tags, tag])
    setInput('')
  }

  return (
    <div className="flex flex-wrap gap-1.5 p-2 border border-gray-300 rounded-xl min-h-[42px] focus-within:ring-2 focus-within:ring-brand-400 focus-within:border-transparent">
      {tags.map((t) => (
        <span key={t} className="flex items-center gap-1 bg-brand-50 text-brand-700 border border-brand-200 px-2.5 py-0.5 rounded-full text-xs font-medium">
          {t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))}
            className="text-brand-400 hover:text-brand-700 leading-none">×</button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
            e.preventDefault()
            addTag(input)
          }
          if (e.key === 'Backspace' && !input && tags.length) {
            onChange(tags.slice(0, -1))
          }
        }}
        onBlur={() => { if (input.trim()) addTag(input) }}
        placeholder={tags.length ? '' : '輸入標籤後按 Enter…'}
        className="flex-1 min-w-[100px] text-sm outline-none bg-transparent py-0.5"
      />
    </div>
  )
}

// ── Upload Modal ───────────────────────────────────────────────────────────────

interface UploadState {
  file:            File
  previewUrl:      string
  compressedBlob:  Blob | null
  origW: number; origH: number
  compW: number; compH: number
  stage: 'compressing' | 'ready' | 'uploading' | 'done' | 'error'
  progress: number
  error: string
}

function UploadModal({
  onClose,
  onUploaded,
}: {
  onClose:    () => void
  onUploaded: (asset: BrandAsset) => void
}) {
  const [us,          setUs]          = useState<UploadState | null>(null)
  const [name,        setName]        = useState('')
  const [category,    setCategory]    = useState<string>(ASSET_CATEGORIES[0])
  const [tags,        setTags]        = useState<string[]>([])
  const [dragging,    setDragging]    = useState(false)
  const [globalErr,   setGlobalErr]   = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setGlobalErr('只支援圖片格式（JPG、PNG、WebP）')
      return
    }
    const preview = URL.createObjectURL(file)

    // Auto-fill name from filename
    setName(file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '))

    // Read original dimensions
    const origImg = new window.Image()
    origImg.src = preview
    await new Promise<void>((r) => { origImg.onload = () => r() })
    const origW = origImg.naturalWidth
    const origH = origImg.naturalHeight

    setUs({
      file, previewUrl: preview,
      compressedBlob: null,
      origW, origH, compW: 0, compH: 0,
      stage: 'compressing', progress: 0, error: '',
    })

    try {
      const { blob, width, height } = await compressImage(file)
      setUs((prev) => prev
        ? { ...prev, compressedBlob: blob, compW: width, compH: height, stage: 'ready' }
        : null)
    } catch {
      setUs((prev) => prev
        ? { ...prev, stage: 'error', error: '圖片壓縮失敗，請換一張圖片試試' }
        : null)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleSubmit = async () => {
    if (!us?.compressedBlob || !us.file || us.stage !== 'ready') return
    if (!name.trim()) { setGlobalErr('請輸入素材名稱'); return }

    setUs((prev) => prev ? { ...prev, stage: 'uploading', progress: 10 } : null)
    setGlobalErr('')

    const interval = setInterval(() => {
      setUs((prev) => prev ? { ...prev, progress: Math.min(prev.progress + 8, 80) } : null)
    }, 200)

    try {
      // Upload original + compressed in parallel
      const [originalUrl, compressedUrl] = await Promise.all([
        uploadToBlob(us.file, 'originals', us.file.name),
        uploadToBlob(us.compressedBlob, 'compressed', us.file.name),
      ])

      clearInterval(interval)
      setUs((prev) => prev ? { ...prev, progress: 90 } : null)

      // Save metadata to Notion
      const res = await fetch('/api/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          category,
          tags,
          compressedUrl,
          originalUrl,
          originalSize:   us.file.size,
          compressedSize: us.compressedBlob.size,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '儲存失敗')

      setUs((prev) => prev ? { ...prev, stage: 'done', progress: 100 } : null)
      setTimeout(() => {
        onUploaded(data as BrandAsset)
        onClose()
      }, 400)
    } catch (err: any) {
      clearInterval(interval)
      setUs((prev) => prev ? { ...prev, stage: 'ready', progress: 0 } : null)
      setGlobalErr(err.message ?? '上傳失敗，請稍後再試')
    }
  }

  // Close on Esc
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const isUploading = us?.stage === 'uploading' || us?.stage === 'done'
  const canSubmit   = us?.stage === 'ready' && name.trim().length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <motion.div
        className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }} onClick={onClose}
      />

      <motion.div
        className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]"
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1,    y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 16 }}
        transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {/* Header */}
        <div className="px-7 pt-6 pb-4 flex items-center justify-between border-b border-gray-100">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-500 mb-0.5">品牌素材庫</p>
            <h2 className="text-lg font-bold text-slate-900">上傳素材</h2>
          </div>
          <button onClick={onClose} disabled={isUploading}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition disabled:opacity-40">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-7 py-5 space-y-5">

          {/* Drop zone / preview */}
          {!us ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={[
                'w-full rounded-2xl border-2 border-dashed cursor-pointer transition flex flex-col items-center justify-center gap-3 py-14',
                dragging
                  ? 'border-brand-400 bg-brand-50 scale-[1.01]'
                  : 'border-gray-200 bg-gray-50 hover:border-brand-300 hover:bg-brand-50/40',
              ].join(' ')}
            >
              <span className="text-5xl text-gray-300">🖼</span>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-600">{dragging ? '放開以上傳' : '拖曳圖片到這裡'}</p>
                <p className="text-xs text-gray-400 mt-1">或點擊選擇檔案</p>
              </div>
              <span className="text-xs text-gray-300 bg-white border border-gray-200 px-3 py-1 rounded-full">
                JPG / PNG / WebP · 最大 20 MB
              </span>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Preview */}
              <div className="relative w-full rounded-2xl overflow-hidden bg-gray-100 border border-gray-200 max-h-64 flex items-center justify-center">
                <img src={us.previewUrl} alt="預覽" className="max-h-64 w-full object-contain" />
                {/* Progress overlay during upload */}
                {isUploading && (
                  <div className="absolute inset-0 bg-black/30 flex flex-col items-center justify-center gap-2">
                    <div className="w-48 h-1.5 bg-white/30 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-white rounded-full"
                        animate={{ width: `${us.progress}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                    <span className="text-white text-xs font-medium">
                      {us.stage === 'done' ? '完成！' : '上傳中…'}
                    </span>
                  </div>
                )}
                {/* Re-select button */}
                {!isUploading && (
                  <button
                    type="button"
                    onClick={() => { URL.revokeObjectURL(us.previewUrl); setUs(null) }}
                    className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded-full hover:bg-black/70 transition"
                  >
                    更換圖片
                  </button>
                )}
              </div>

              {/* Compression stats */}
              {us.stage !== 'compressing' && us.compressedBlob && (
                <div className="flex items-center gap-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-2.5 text-xs">
                  <span className="text-emerald-600 font-semibold">✓ 已壓縮</span>
                  <span className="text-gray-400">原圖</span>
                  <span className="font-medium text-gray-700">{formatBytes(us.file.size)}</span>
                  <span className="text-gray-300">→</span>
                  <span className="font-medium text-emerald-700">{formatBytes(us.compressedBlob.size)}</span>
                  <span className="text-gray-400 ml-auto">
                    {us.compW}×{us.compH}px
                  </span>
                  <span className="text-gray-300 text-[10px]">（原圖保留供下載）</span>
                </div>
              )}

              {us.stage === 'compressing' && (
                <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5">
                  <svg className="animate-spin h-3.5 w-3.5 text-brand-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  壓縮中…
                </div>
              )}

              {us.stage === 'error' && (
                <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{us.error}</p>
              )}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              素材名稱 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：3D Master 色板正面照"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
              disabled={isUploading}
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">分類</label>
            <div className="flex flex-wrap gap-1.5">
              {ASSET_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  disabled={isUploading}
                  className={[
                    'px-3.5 py-1.5 rounded-full text-xs font-medium border transition',
                    category === c
                      ? 'bg-brand-500 border-brand-500 text-white'
                      : 'bg-white border-gray-300 text-gray-600 hover:border-brand-400 hover:text-brand-600',
                  ].join(' ')}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              標籤 <span className="text-gray-400 font-normal text-xs">（按 Enter 或逗號新增）</span>
            </label>
            <TagInput tags={tags} onChange={setTags} />
          </div>

          {/* Error */}
          {globalErr && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">{globalErr}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
          <button onClick={onClose} disabled={isUploading}
            className="px-5 py-2 rounded-full text-sm font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || isUploading}
            className="px-6 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 transition disabled:opacity-40 flex items-center gap-2"
          >
            {isUploading && (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            )}
            {isUploading ? '上傳中…' : '上傳素材'}
          </button>
        </div>
      </motion.div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

// ── Asset Card ─────────────────────────────────────────────────────────────────

function AssetCard({
  asset,
  onClick,
  onDelete,
}: {
  asset:    BrandAsset
  onClick:  () => void
  onDelete: () => void
}) {
  const [imgErr, setImgErr] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  return (
    <div className="card-soft card-soft-hover group relative overflow-hidden cursor-pointer transition-all active:scale-[0.99]"
      onClick={onClick}>

      {/* Thumbnail */}
      <div className="aspect-square bg-stone-50 flex items-center justify-center overflow-hidden">
        {asset.compressedUrl && !imgErr ? (
          <img
            src={asset.compressedUrl}
            alt={asset.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgErr(true)}
          />
        ) : (
          <span className="text-4xl text-stone-200">🖼</span>
        )}
      </div>

      {/* Delete button */}
      <div
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {confirmDel ? (
          <div className="flex items-center gap-1 bg-white rounded-full shadow px-2 py-1">
            <span className="text-xs text-red-600 font-medium">確定刪除?</span>
            <button onClick={() => { onDelete(); setConfirmDel(false) }}
              className="text-xs font-bold text-red-600 hover:text-red-800 px-1">是</button>
            <button onClick={() => setConfirmDel(false)}
              className="min-h-8 text-xs text-stone-500 hover:text-stone-700 px-1">否</button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDel(true)}
            className="w-11 h-11 sm:w-8 sm:h-8 bg-white/90 rounded-full shadow text-stone-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center text-sm transition-all active:scale-95"
          >
            ✕
          </button>
        )}
      </div>

      {/* Category badge */}
      <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full font-medium backdrop-blur-sm">
          {asset.category}
        </span>
      </div>

      {/* Info */}
      <div className="px-3 py-2.5">
        <p className="text-sm font-semibold text-stone-800 truncate leading-snug">{asset.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {asset.compressedSize > 0 && (
            <span className="text-[10px] text-stone-400">{formatBytes(asset.compressedSize)}</span>
          )}
          {asset.uploadedBy && (
            <span className="text-[10px] text-stone-300">· {asset.uploadedBy}</span>
          )}
        </div>
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {asset.tags.slice(0, 3).map((t) => (
              <span key={t} className="text-[10px] bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded-full">{t}</span>
            ))}
            {asset.tags.length > 3 && (
              <span className="text-[10px] text-stone-400">+{asset.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Detail Lightbox ────────────────────────────────────────────────────────────

function AssetLightbox({
  asset,
  onClose,
}: {
  asset:   BrandAsset
  onClose: () => void
}) {
  const [imgErr, setImgErr] = useState(false)

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const savedRatio = asset.compressedSize && asset.originalSize
    ? Math.round((1 - asset.compressedSize / asset.originalSize) * 100)
    : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }} onClick={onClose}
      />

      <motion.div
        className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.22 }}
      >
        {/* Close */}
        <button onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/20 text-white hover:bg-black/40 transition">
          ✕
        </button>

        {/* Image */}
        <div className="bg-gray-900 flex items-center justify-center min-h-[280px] max-h-[55vh] overflow-hidden">
          {asset.compressedUrl && !imgErr ? (
            <img src={asset.compressedUrl} alt={asset.name}
              className="max-h-full max-w-full object-contain"
              onError={() => setImgErr(true)} />
          ) : (
            <span className="text-6xl text-gray-600">🖼</span>
          )}
        </div>

        {/* Info + actions */}
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-gray-900 leading-snug">{asset.name}</h2>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <span className="text-xs bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded-full font-medium">
                  {asset.category}
                </span>
                {asset.tags.map((t) => (
                  <span key={t} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
            </div>

            {/* Download buttons */}
            <div className="flex flex-col gap-2 shrink-0">
              <a
                href={asset.compressedUrl}
                download
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full bg-brand-500 text-white hover:bg-brand-600 transition whitespace-nowrap"
              >
                ↓ 下載壓縮版
              </a>
              {asset.originalUrl && (
                <a
                  href={asset.originalUrl}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-full border border-gray-300 text-gray-700 hover:bg-gray-50 transition whitespace-nowrap"
                >
                  ↓ 下載原圖
                </a>
              )}
            </div>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-400 border-t border-gray-100 pt-3">
            {asset.originalSize > 0 && (
              <>
                <div>
                  <span className="text-gray-300 mr-1">原圖</span>
                  <span className="text-gray-600 font-medium">{formatBytes(asset.originalSize)}</span>
                </div>
                <div>
                  <span className="text-gray-300 mr-1">壓縮版</span>
                  <span className="text-emerald-600 font-medium">{formatBytes(asset.compressedSize)}</span>
                  {savedRatio > 0 && <span className="text-emerald-500 ml-1">（省 {savedRatio}%）</span>}
                </div>
              </>
            )}
            {asset.uploadedBy && (
              <div>
                <span className="text-gray-300 mr-1">上傳者</span>
                <span className="text-gray-600">{asset.uploadedBy}</span>
              </div>
            )}
            {asset.createdAt && (
              <div>
                <span className="text-gray-300 mr-1">上傳日期</span>
                <span className="text-gray-600">{formatDate(asset.createdAt)}</span>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

const ALL_CATS = ['全部', ...ASSET_CATEGORIES] as const

export function AssetLibraryContent({ setupNeeded }: { setupNeeded?: boolean }) {
  const [assets,      setAssets]      = useState<BrandAsset[]>([])
  const [loading,     setLoading]     = useState(true)
  const [loadError,   setLoadError]   = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('全部')

  const [showUpload,  setShowUpload]  = useState(false)
  const [viewing,     setViewing]     = useState<BrandAsset | null>(null)

  // Search
  const [search, setSearch] = useState('')

  const loadAssets = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const params = new URLSearchParams()
    if (activeCategory !== '全部') params.set('category', activeCategory)
    try {
      const res  = await fetch(`/api/assets?${params}`)
      const data = await res.json()
      if (!res.ok) {
        setLoadError(data.error ?? '載入失敗')
        return
      }
      setAssets(Array.isArray(data) ? data : [])
    } catch {
      setLoadError('網路錯誤，請重新整理')
    } finally {
      setLoading(false)
    }
  }, [activeCategory])

  useEffect(() => { if (!setupNeeded) loadAssets() }, [loadAssets, setupNeeded])

  const handleUploaded = useCallback((asset: BrandAsset) => {
    setAssets((prev) => [asset, ...prev])
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== id))
    await fetch(`/api/assets/${id}`, { method: 'DELETE' }).catch(console.error)
  }, [])

  const filtered = search.trim()
    ? assets.filter((a) =>
        a.name.toLowerCase().includes(search.toLowerCase()) ||
        a.tags.some((t) => t.toLowerCase().includes(search.toLowerCase())))
    : assets

  if (setupNeeded) {
    return (
      <div className="max-w-lg mx-auto mt-10 bg-amber-50 border border-amber-200 rounded-2xl px-6 py-6">
        <p className="font-semibold text-amber-800 mb-2">⚠️ 需要完成設定才能使用品牌素材庫</p>
        <ol className="text-sm text-amber-700 space-y-2 list-decimal list-inside">
          <li>在 Notion 新增一個 Full Page 資料庫，命名為「品牌素材庫」</li>
          <li>將 Notion Integration 加入此資料庫的存取權限</li>
          <li>複製資料庫 ID（URL 中 <code className="bg-amber-100 px-1 rounded">notion.so/xxx/<strong>[這一段]</strong>?v=...</code>）</li>
          <li>在 Vercel 或 <code className="bg-amber-100 px-1 rounded">.env.local</code> 加入：<br />
            <code className="bg-amber-100 px-1.5 py-0.5 rounded text-xs mt-1 block">NOTION_ASSETS_DB=貼上資料庫ID</code>
          </li>
          <li>重新部署即可啟用</li>
        </ol>
      </div>
    )
  }

  return (
    <>
      {/* Toolbar */}
      <section className="card-soft mb-5 p-4 sm:p-5" aria-label="素材搜尋與上傳">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋素材名稱或標籤…"
          className="input-soft min-h-11 flex-1 rounded-full px-5 sm:max-w-lg"
        />
        <button
          onClick={() => setShowUpload(true)}
          className="min-h-11 shrink-0 flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 shadow-md shadow-brand-500/25 transition-all active:scale-95"
        >
          <span className="text-base leading-none">＋</span>
          上傳素材
        </button>
      </div>

      {/* Category tabs */}
      <div className="mt-4 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap" role="group" aria-label="素材分類">
        {ALL_CATS.map((c) => (
          <button
            key={c}
            onClick={() => setActiveCategory(c)}
            className={[
              'min-h-11 shrink-0 px-4 py-2 rounded-full text-xs font-semibold transition-all active:scale-95',
              activeCategory === c
                ? 'bg-brand-500 text-white shadow-md shadow-brand-500/25'
                : 'bg-stone-100 text-stone-600 hover:bg-brand-50 hover:text-brand-700',
            ].join(' ')}
          >
            {c}
          </button>
        ))}
      </div>
      </section>

      {/* Error */}
      {loadError && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {loadError} —{' '}
          <button onClick={loadAssets} className="underline hover:no-underline">重試</button>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-3xl bg-stone-100 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-soft flex flex-col items-center justify-center px-5 py-20 text-stone-300">
          <span className="text-6xl mb-4">🖼</span>
          <p className="text-center text-sm text-stone-400">
            {search ? '找不到符合的素材' : '尚無素材，點擊「上傳素材」開始建立圖庫'}
          </p>
        </div>
      ) : (
        <motion.div
          layout
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
        >
          <AnimatePresence>
            {filtered.map((asset) => (
              <motion.div
                key={asset.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.18 }}
              >
                <AssetCard
                  asset={asset}
                  onClick={() => setViewing(asset)}
                  onDelete={() => handleDelete(asset.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Count */}
      {!loading && filtered.length > 0 && (
        <p className="mt-5 text-xs text-stone-400 text-center">
          共 {filtered.length} 個素材
          {activeCategory !== '全部' && ` · ${activeCategory}`}
        </p>
      )}

      {/* Upload modal */}
      <AnimatePresence>
        {showUpload && (
          <UploadModal
            onClose={() => setShowUpload(false)}
            onUploaded={handleUploaded}
          />
        )}
      </AnimatePresence>

      {/* Lightbox */}
      <AnimatePresence>
        {viewing && (
          <AssetLightbox
            asset={viewing}
            onClose={() => setViewing(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}
