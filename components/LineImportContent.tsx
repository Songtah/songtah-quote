'use client'

import { useRef, useState } from 'react'
import type { ParsedVisitItem } from '@/app/api/line/import/route'

type Stage = 'idle' | 'parsing' | 'importing' | 'done' | 'error'

type Progress = {
  total: number
  imported: number
  skipped: number
  errors: number
  processed: number
}

export function LineImportContent() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [fileName, setFileName] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const abortRef = useRef(false)

  async function handleUpload(file: File) {
    setFileName(file.name)
    setStage('parsing')
    setProgress(null)
    setErrorMsg('')
    abortRef.current = false

    // ── 第一步：解析檔案 ─────────────────────────────────────────────────────
    const formData = new FormData()
    formData.append('file', file)

    let visits: ParsedVisitItem[]
    try {
      const res = await fetch('/api/line/import', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) { setErrorMsg(data.error ?? '解析失敗'); setStage('error'); return }
      visits = data.visits ?? []
      if (visits.length === 0) { setErrorMsg('未找到符合條件的每日報表'); setStage('error'); return }
    } catch {
      setErrorMsg('網路錯誤，請稍後再試')
      setStage('error')
      return
    }

    // ── 第二步：分批匯入 ─────────────────────────────────────────────────────
    setStage('importing')
    setProgress({ total: visits.length, imported: 0, skipped: 0, errors: 0, processed: 0 })

    let offset = 0
    let totalImported = 0, totalSkipped = 0, totalErrors = 0

    while (true) {
      if (abortRef.current) break

      try {
        const res = await fetch('/api/line/import/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visits, offset }),
        })
        const data = await res.json()
        if (!res.ok) { totalErrors += (data.errors ?? 1) }
        else {
          totalImported += data.imported ?? 0
          totalSkipped  += data.skipped  ?? 0
          totalErrors   += data.errors   ?? 0
        }

        offset = data.nextOffset ?? (offset + 30)
        const processed = Math.min(offset, visits.length)

        setProgress({ total: visits.length, imported: totalImported, skipped: totalSkipped, errors: totalErrors, processed })

        if (!data.hasMore) break
      } catch {
        totalErrors++
        offset += 30
        if (offset >= visits.length) break
      }
    }

    setStage('done')
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleUpload(file)
  }

  const pct = progress ? Math.round((progress.processed / progress.total) * 100) : 0

  return (
    <div className="space-y-6 max-w-2xl">

      {/* 說明 */}
      <div className="panel p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">使用方式</h2>
        <ol className="text-sm text-gray-600 space-y-1.5 list-decimal list-inside">
          <li>在 LINE App 開啟業務群組 → 右上角 ☰ → 聊天設定 → 匯出聊天記錄</li>
          <li>選擇「以文字格式儲存」，取得 .txt 檔案</li>
          <li>上傳到下方，系統自動篩選每日回報並逐批匯入</li>
        </ol>
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠️ 只匯入「行程回報」區段，早上行程規劃自動跳過。已存在的紀錄（同客戶＋同日期）不重複建立。
        </div>
      </div>

      {/* 上傳區 */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => { if (stage === 'idle' || stage === 'done' || stage === 'error') fileRef.current?.click() }}
        className={`panel border-2 border-dashed transition-colors px-6 py-12 text-center ${
          stage === 'importing' ? 'cursor-default border-gray-100' : 'cursor-pointer border-gray-200 hover:border-gray-400'
        }`}
      >
        <input ref={fileRef} type="file" accept=".txt" className="hidden" onChange={handleFileChange} />

        {stage === 'idle' && (
          <>
            <div className="text-3xl mb-3">📄</div>
            <p className="font-medium text-gray-700">點選或拖曳 .txt 檔案到此處</p>
            <p className="text-sm text-gray-400 mt-1">LINE 匯出的聊天記錄 .txt 格式</p>
          </>
        )}

        {stage === 'parsing' && (
          <>
            <div className="text-3xl mb-3 animate-pulse">📊</div>
            <p className="font-medium text-gray-700">解析中：{fileName}</p>
            <p className="text-sm text-gray-400 mt-1">正在識別每日報表訊息…</p>
          </>
        )}

        {stage === 'importing' && progress && (
          <div className="space-y-4">
            <div className="text-3xl">⬆️</div>
            <p className="font-medium text-gray-700">匯入中…</p>
            {/* 進度條 */}
            <div className="w-full bg-gray-100 rounded-full h-2.5">
              <div
                className="bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-sm text-gray-500">
              {progress.processed} / {progress.total} 筆（{pct}%）
            </p>
            <div className="flex justify-center gap-6 text-sm">
              <span className="text-green-600">✅ 匯入 {progress.imported}</span>
              <span className="text-gray-400">⏭ 跳過 {progress.skipped}</span>
              {progress.errors > 0 && <span className="text-red-500">❌ 失敗 {progress.errors}</span>}
            </div>
          </div>
        )}

        {stage === 'done' && progress && (
          <>
            <div className="text-3xl mb-3">✅</div>
            <p className="font-medium text-gray-700">匯入完成！</p>
            <p className="text-sm text-gray-400 mt-1">點選或拖曳新檔案可再次匯入</p>
          </>
        )}

        {stage === 'error' && (
          <>
            <div className="text-3xl mb-3">❌</div>
            <p className="font-medium text-red-600">{errorMsg}</p>
            <p className="text-sm text-gray-400 mt-1">點選重新嘗試</p>
          </>
        )}
      </div>

      {/* 完成後結果摘要 */}
      {stage === 'done' && progress && (
        <div className="panel p-5 space-y-3">
          <h2 className="font-semibold text-gray-800">匯入結果</h2>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="成功匯入" value={progress.imported} highlight />
            <StatCard label="跳過（重複）" value={progress.skipped} />
            <StatCard label="失敗" value={progress.errors} />
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 text-center ${highlight ? 'bg-green-50 border border-green-200' : 'bg-gray-50'}`}>
      <div className={`text-2xl font-bold ${highlight ? 'text-green-700' : 'text-gray-800'}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}
