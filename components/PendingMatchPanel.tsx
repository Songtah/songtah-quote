'use client'

/**
 * components/PendingMatchPanel.tsx — 待確認配對
 *
 * 自動比對縮不到唯一（或主檔查無）的客情紀錄，以「單位名稱 × 業務」分組列出，
 * 每組提供候選清單一鍵選擇；確認一次就把同組所有紀錄補上關聯。
 * 依 CLAUDE.md 最高原則：只讓人「選」，不讓人打字。
 */
import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

type Candidate = { id: string; name: string; city?: string; district?: string; type?: string; salesperson?: string }
type Group = {
  key: string; name: string; salesperson: string; count: number
  firstDate: string; lastDate: string; visitIds: string[]
  suggestion: Candidate | null; reason: string; candidates: Candidate[]
  kind: 'ambiguous' | 'not-found'
}
type Totals = { groups: number; visits: number; withSuggestion: number; ambiguous: number; notFound: number }

export default function PendingMatchPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [ready, setReady] = useState(true)
  const [groups, setGroups] = useState<Group[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [filter, setFilter] = useState<'all' | 'suggested' | 'ambiguous' | 'not-found'>('all')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/visits/pending-match${refresh ? '?refresh=1' : ''}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '讀取失敗')
      setReady(Boolean(data.ready))
      setGroups(data.groups ?? [])
      setTotals(data.totals ?? null)
    } catch (e: any) {
      setError(e?.message ?? '讀取失敗')
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [])

  useEffect(() => { if (open) load() }, [open, load])

  const act = async (body: any, key: string) => {
    setBusyKey(key); setError('')
    try {
      const res = await fetch('/api/visits/pending-match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '操作失敗')
      setGroups((prev) => prev.filter((g) => g.key !== key))
      setTotals((t) => t ? { ...t, groups: Math.max(0, t.groups - 1) } : t)
    } catch (e: any) {
      setError(e?.message ?? '操作失敗')
    } finally {
      setBusyKey(null)
    }
  }

  const shown = groups.filter((g) =>
    filter === 'all' ? true
      : filter === 'suggested' ? !!g.suggestion
        : filter === 'ambiguous' ? (!g.suggestion && g.kind === 'ambiguous')
          : g.kind === 'not-found')

  if (!open) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/40" onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
        className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      >
        <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-[#fdfdfb] shadow-2xl ring-1 ring-stone-900/[0.06] sm:rounded-3xl">
          <div className="flex items-start justify-between gap-3 border-b border-stone-100 p-5 sm:p-6">
            <div>
              <p className="eyebrow mb-1">資料整理</p>
              <h3 className="text-lg font-semibold text-stone-800">🧩 待確認配對</h3>
              <p className="mt-1 text-sm text-stone-500">
                系統比對不出唯一客戶的客情紀錄，依「單位名稱 × 業務」分組。確認一次就補齊同組所有紀錄。
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full px-3 py-1.5 text-sm text-stone-500 transition-all hover:bg-stone-100 active:scale-95"
            >關閉</button>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 px-5 py-3 sm:px-6">
            {([
              ['all', '全部'],
              ['suggested', `有建議${totals ? ` (${totals.withSuggestion})` : ''}`],
              ['ambiguous', `多家同名${totals ? ` (${totals.ambiguous})` : ''}`],
              ['not-found', `主檔查無${totals ? ` (${totals.notFound})` : ''}`],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setFilter(v)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-all active:scale-95 ${
                  filter === v ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-stone-500 hover:bg-stone-100'
                }`}
              >{label}</button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              {totals && <span className="text-xs text-stone-400">{totals.groups} 組／{totals.visits} 筆</span>}
              <button
                onClick={() => load(true)}
                disabled={refreshing}
                className="rounded-full bg-stone-50 px-3.5 py-1.5 text-sm font-medium text-stone-600 ring-1 ring-stone-200 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95 disabled:opacity-50"
                title="重新全掃客情與客戶庫（需要幾分鐘）"
              >{refreshing ? '重算中…' : '重新計算'}</button>
            </div>
          </div>

          {error && <div className="mx-5 mt-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-600 sm:mx-6">{error}</div>}

          <div className="flex-1 overflow-y-auto p-5 sm:p-6">
            {loading ? (
              <p className="py-10 text-center text-sm text-stone-400">載入中…</p>
            ) : !ready ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                尚未產生清單。點「重新計算」建立第一份（之後每晚自動更新）。
              </div>
            ) : shown.length === 0 ? (
              <p className="py-10 text-center text-sm text-stone-400">沒有待確認的項目 🎉</p>
            ) : (
              <ul className="space-y-3">
                {shown.map((g) => (
                  <li key={g.key} className="card-soft p-4">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-semibold text-stone-800">{g.name}</span>
                      <span className="text-xs text-stone-500">{g.salesperson || '未填業務'}</span>
                      <span className="text-xs text-stone-400">
                        {g.count} 筆 · {g.firstDate === g.lastDate ? g.lastDate : `${g.firstDate} ～ ${g.lastDate}`}
                      </span>
                      <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs ${
                        g.suggestion ? 'bg-green-50 text-green-700'
                          : g.kind === 'not-found' ? 'bg-stone-100 text-stone-500' : 'bg-amber-50 text-amber-700'
                      }`}>{g.reason}</span>
                    </div>

                    {g.suggestion && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-green-50/70 px-3 py-2">
                        <span className="text-sm text-stone-700">
                          建議配對 <span className="font-medium">{g.suggestion.name}</span>
                          <span className="ml-1 text-xs text-stone-500">{g.suggestion.city}{g.suggestion.district}</span>
                        </span>
                        <button
                          disabled={busyKey === g.key}
                          onClick={() => act({ action: 'confirm', visitIds: g.visitIds, customerId: g.suggestion!.id }, g.key)}
                          className="ml-auto rounded-full bg-brand-500 px-4 py-1.5 text-sm font-medium text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50"
                        >{busyKey === g.key ? '處理中…' : '確認'}</button>
                      </div>
                    )}

                    {g.candidates.length > 0 && (
                      <div className="mt-3">
                        <p className="mb-1.5 text-xs text-stone-400">
                          {g.suggestion ? '其他候選' : `候選 ${g.candidates.length} 家，請選擇`}
                        </p>
                        <ul className="space-y-1.5">
                          {g.candidates.filter((c) => c.id !== g.suggestion?.id).map((c) => (
                            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-stone-50 px-3 py-2">
                              <span className="text-sm text-stone-700">{c.name}</span>
                              <span className="text-xs text-stone-500">{c.city}{c.district}</span>
                              {c.type && <span className="text-xs text-stone-400">{c.type}</span>}
                              {c.salesperson && <span className="text-xs text-stone-400">負責：{c.salesperson}</span>}
                              <button
                                disabled={busyKey === g.key}
                                onClick={() => act({ action: 'confirm', visitIds: g.visitIds, customerId: c.id }, g.key)}
                                className="ml-auto rounded-full bg-white px-3.5 py-1 text-sm font-medium text-stone-600 ring-1 ring-stone-200 transition-all hover:bg-brand-50 hover:text-brand-700 active:scale-95 disabled:opacity-50"
                              >選這家</button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="mt-3 flex items-center gap-2">
                      {g.kind === 'not-found' && (
                        <span className="text-xs text-stone-400">主檔查無相符名稱——可能是簡稱寫法、錯字，或客戶尚未建檔</span>
                      )}
                      <button
                        disabled={busyKey === g.key}
                        onClick={() => act({ action: 'ignore', key: g.key }, g.key)}
                        className="ml-auto rounded-full px-3 py-1 text-xs text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-600 active:scale-95 disabled:opacity-50"
                        title="這組不該配對（公司內部事項、已歇業…），之後不再列出"
                      >不需配對</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
