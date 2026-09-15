'use client'

/**
 * 支援中心：操作手冊（嵌入 /support/manual）＋回報系統問題（沿用 /api/bug-report，建立技術支援工單）。
 */
import { useState } from 'react'
import { BookOpen, ExternalLink, LifeBuoy, Send } from 'lucide-react'

const PAGES = ['首頁', '客戶', '業務開發', '報價', '訂貨', '產品與價格', '技術支援', '行銷與活動', '市場監控', '業績總覽', '行政管理', '帳號權限', 'LINE 日報／客情紀錄', '其他']

export function SupportContent({ reporter }: { reporter: string }) {
  const [page, setPage] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setResult(null)
    try {
      const res = await fetch('/api/bug-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: page || '未指定頁面', description, reporter }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '回報失敗')
      setResult({ ok: true, text: '已送出，系統已建立一張技術支援工單，處理後會與你聯繫。' })
      setDescription(''); setPage('')
    } catch (err: any) {
      setResult({ ok: false, text: `${err?.message ?? '回報失敗'}，請稍後再試。` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="card-soft overflow-hidden" aria-label="系統操作手冊">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-900/[0.06] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-brand-700"><BookOpen className="size-4" /></span>
            <div>
              <h2 className="text-base font-bold text-stone-800">系統操作手冊</h2>
              <p className="text-xs text-stone-500">依左側選單順序編排，手冊左邊有目錄可以直接跳到章節</p>
            </div>
          </div>
          <a href="/support/manual" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-4 py-2 text-xs font-semibold text-stone-600 transition-all hover:bg-stone-200 active:scale-95">
            <ExternalLink className="size-3.5" /> 在新分頁開啟
          </a>
        </div>
        <iframe
          src="/support/manual"
          title="崧達系統操作手冊"
          className="block h-[calc(100vh-220px)] min-h-[560px] w-full bg-white"
        />
      </section>

      <section className="card-soft p-5 sm:p-6" aria-label="回報系統問題">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-brand-700"><LifeBuoy className="size-4" /></span>
          <div>
            <h2 className="text-base font-bold text-stone-800">回報系統問題</h2>
            <p className="text-xs text-stone-500">手冊找不到答案、畫面錯誤或資料不對，寫下發生了什麼，會建立一張技術支援工單</p>
          </div>
        </div>
        <form onSubmit={submit} className="mt-5 grid gap-4 sm:grid-cols-[14rem_1fr]">
          <label className="block text-sm font-semibold text-stone-700" htmlFor="support-page">
            發生在哪個功能
            <select id="support-page" value={page} onChange={(e) => setPage(e.target.value)} className="select-soft mt-1 w-full font-normal">
              <option value="">請選擇</option>
              {PAGES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-stone-700" htmlFor="support-description">
            問題描述 *
            <textarea id="support-description" required rows={4} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="例：9/14 晚上發的日報，客情紀錄只出現 1 筆；或：報價單按 PDF 沒有反應"
              className="input-soft mt-1 w-full font-normal" />
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-start-2">
            <button type="submit" disabled={busy || !description.trim()} className="button-primary min-h-11 px-6 disabled:opacity-40">
              <Send className="mr-2 size-4" /> {busy ? '送出中…' : '送出回報'}
            </button>
            {result && <span className={`text-sm ${result.ok ? 'text-emerald-700' : 'text-red-600'}`}>{result.text}</span>}
          </div>
        </form>
      </section>
    </div>
  )
}
