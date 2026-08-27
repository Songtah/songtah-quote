'use client'

/**
 * 行內客戶指定器：搜尋客戶主檔後選一筆。
 *
 * 用於 Slack 回報比對不到客戶的紀錄（跨區支援報備、協作積分）。
 * 刻意不做自動選第一筆——比對不到就是因為名稱不明確，讓人自己挑才不會綁錯。
 */
import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'

type Candidate = { id: string; name: string; city?: string; district?: string; type?: string }

export function CustomerPickerInline({
  defaultQuery = '',
  onPick,
  onCancel,
  busy,
}: {
  defaultQuery?: string
  onPick: (customer: Candidate) => void
  onCancel: () => void
  busy?: boolean
}) {
  const [query, setQuery] = useState(defaultQuery)
  const [results, setResults] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const requestRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) { setResults([]); return }
    const controller = new AbortController()
    requestRef.current?.abort()
    requestRef.current = controller
    const timer = setTimeout(() => {
      setLoading(true); setError('')
      fetch(`/api/customers/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        .then(async (response) => {
          const json = await response.json()
          if (!response.ok) throw new Error(json.error || '搜尋失敗')
          setResults(Array.isArray(json) ? json.slice(0, 20) : [])
        })
        .catch((caught: any) => { if (caught?.name !== 'AbortError') setError(caught.message) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query])

  return (
    <div className="mt-2 rounded-2xl bg-white p-3 ring-1 ring-stone-900/[0.06]">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-stone-400" />
          <input
            autoFocus
            className="input-soft w-full pl-9 text-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="輸入客戶名稱搜尋（至少 2 個字）"
          />
        </div>
        <button
          onClick={onCancel}
          aria-label="取消指定客戶"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-stone-50 text-stone-500 transition-all hover:bg-stone-100 active:scale-95"
        >
          <X className="size-4" />
        </button>
      </div>

      {error && <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}
      {loading && <p className="mt-2 text-center text-xs text-stone-400">搜尋中…</p>}
      {!loading && query.trim().length >= 2 && results.length === 0 && !error && (
        <p className="mt-2 text-center text-xs text-stone-400">找不到相符的客戶</p>
      )}

      {results.length > 0 && (
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {results.map((customer) => (
            <button
              key={customer.id}
              disabled={busy}
              onClick={() => onPick(customer)}
              className="flex w-full items-center justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2 text-left transition-all hover:bg-brand-50 active:scale-[0.99] disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-stone-800">{customer.name}</span>
                <span className="block text-[11px] text-stone-400">
                  {customer.city || '未填縣市'}{customer.district || ''}
                </span>
              </span>
              {customer.type && <span className="chip shrink-0 text-[10px]">{customer.type}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
