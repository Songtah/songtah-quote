'use client'

import { useRef, useState } from 'react'

type ImportResult = {
  totalMessages: number
  dailyReports: number
  imported: number
  skipped: number
  errors: number
  records: { customerName: string; date: string; salesperson: string; id: string }[]
  errorDetails: { customerName?: string; sender: string; error: string }[]
}

type Stage = 'idle' | 'uploading' | 'done' | 'error'

export function LineImportContent() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [fileName, setFileName] = useState('')

  async function handleUpload(file: File) {
    setFileName(file.name)
    setStage('uploading')
    setResult(null)
    setErrorMsg('')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/line/import', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        setErrorMsg(data.error ?? '匯入失敗')
        setStage('error')
        return
      }

      setResult(data)
      setStage('done')
    } catch {
      setErrorMsg('網路錯誤，請稍後再試')
      setStage('error')
    }
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

  return (
    <div className="space-y-6 max-w-2xl">

      {/* 說明卡 */}
      <div className="panel p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">使用方式</h2>
        <ol className="text-sm text-gray-600 space-y-1.5 list-decimal list-inside">
          <li>在 LINE App 中開啟業務群組</li>
          <li>點選右上角 ☰ → 聊天設定 → 匯出聊天記錄</li>
          <li>選擇「以文字格式儲存」，取得 .txt 檔案</li>
          <li>上傳到下方，系統會自動識別客情訊息並匯入</li>
        </ol>
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠️ 每則訊息都會經過 AI 判斷，大量訊息可能需要數分鐘。建議一次處理 1-3 個月的記錄。
        </div>
      </div>

      {/* 上傳區 */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
        className="panel border-2 border-dashed border-gray-200 hover:border-gray-400 transition-colors cursor-pointer px-6 py-12 text-center"
      >
        <input
          ref={fileRef}
          type="file"
          accept=".txt"
          className="hidden"
          onChange={handleFileChange}
        />

        {stage === 'idle' && (
          <>
            <div className="text-3xl mb-3">📄</div>
            <p className="font-medium text-gray-700">點選或拖曳 .txt 檔案到此處</p>
            <p className="text-sm text-gray-400 mt-1">LINE 匯出的聊天記錄 .txt 格式</p>
          </>
        )}

        {stage === 'uploading' && (
          <>
            <div className="text-3xl mb-3 animate-pulse">⏳</div>
            <p className="font-medium text-gray-700">分析中：{fileName}</p>
            <p className="text-sm text-gray-400 mt-1">AI 正在逐條判斷客情訊息，請稍候…</p>
          </>
        )}

        {stage === 'done' && (
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

      {/* 結果摘要 */}
      {result && (
        <div className="panel p-5 space-y-4">
          <h2 className="font-semibold text-gray-800">匯入結果</h2>

          {/* 統計數字 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="總訊息數" value={result.totalMessages} />
            <StatCard label="每日報表" value={result.dailyReports} />
            <StatCard label="跳過（重複）" value={result.skipped} />
            <StatCard label="匯入筆數" value={result.imported} highlight={result.imported > 0} />
          </div>

          {/* 匯入清單 */}
          {result.records.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-600 mb-2">已匯入紀錄</p>
              <div className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
                {result.records.map((r) => (
                  <div key={r.id} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm font-medium text-gray-800">{r.customerName}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{r.salesperson}</span>
                      <span className="text-xs text-gray-400">{r.date}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 錯誤清單 */}
          {result.errorDetails.length > 0 && (
            <div>
              <p className="text-sm font-medium text-red-600 mb-2">
                失敗 {result.errorDetails.length} 筆
              </p>
              <div className="divide-y divide-red-50 border border-red-100 rounded-xl overflow-hidden">
                {result.errorDetails.map((e, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-gray-700">{e.customerName ?? '未知客戶'}</span>
                    <span className="text-xs text-red-400">{e.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  highlight = false,
}: {
  label: string
  value: number
  highlight?: boolean
}) {
  return (
    <div
      className={`rounded-xl px-4 py-3 text-center ${
        highlight ? 'bg-green-50 border border-green-200' : 'bg-gray-50'
      }`}
    >
      <div
        className={`text-2xl font-bold ${highlight ? 'text-green-700' : 'text-gray-800'}`}
      >
        {value}
      </div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}
