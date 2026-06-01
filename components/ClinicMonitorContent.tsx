'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ClinicMonitorRecord } from '@/lib/system-notion'

// ─── Types & helpers ──────────────────────────────────────────────────────────

type FilterType = '' | '新增停業' | '恢復開業' | '新開業' | '停業' | '查無代碼' | '月份摘要'

const TYPE_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  '新增停業': { bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500' },
  '恢復開業': { bg: 'bg-green-50',   text: 'text-green-700',   dot: 'bg-green-500' },
  '新開業':   { bg: 'bg-purple-50',  text: 'text-purple-700',  dot: 'bg-purple-500' },
  '停業':     { bg: 'bg-gray-50',    text: 'text-gray-500',    dot: 'bg-gray-400' },
  '查無代碼': { bg: 'bg-orange-50',  text: 'text-orange-700',  dot: 'bg-orange-400' },
  '月份摘要': { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-400' },
}

function TypeBadge({ type }: { type: string }) {
  const s = TYPE_STYLE[type] ?? { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' }
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full font-medium ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {type}
    </span>
  )
}

// ─── Summary derivation ───────────────────────────────────────────────────────

function deriveMonthSummaries(records: ClinicMonitorRecord[]) {
  const byMonth: Record<string, {
    summary: ClinicMonitorRecord | null
    stopped: number
    restored: number
    newOpen: number
    notFound: number
    affectedCustomers: number
  }> = {}

  for (const r of records) {
    if (!r.month) continue
    if (!byMonth[r.month]) {
      byMonth[r.month] = { summary: null, stopped: 0, restored: 0, newOpen: 0, notFound: 0, affectedCustomers: 0 }
    }
    const m = byMonth[r.month]
    if (r.type === '月份摘要') { m.summary = r; continue }
    if (r.type === '新增停業') m.stopped++
    if (r.type === '恢復開業') m.restored++
    if (r.type === '新開業')   m.newOpen++
    if (r.type === '查無代碼') m.notFound++
    if (r.customerName && (r.type === '新增停業' || r.type === '恢復開業')) m.affectedCustomers++
  }

  return Object.entries(byMonth)
    .sort(([a], [b]) => b.localeCompare(a))  // newest first
    .map(([month, data]) => ({ month, ...data }))
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ClinicMonitorContent({ initialRecords }: { initialRecords: ClinicMonitorRecord[] }) {
  const [records] = useState(initialRecords)
  const [typeFilter, setTypeFilter] = useState<FilterType>('')
  const [monthFilter, setMonthFilter] = useState('')
  const [query, setQuery] = useState('')
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState('')

  const summaries = useMemo(() => deriveMonthSummaries(records), [records])

  const filtered = useMemo(() => {
    let res = records
    if (typeFilter)  res = res.filter(r => r.type === typeFilter)
    if (monthFilter) res = res.filter(r => r.month === monthFilter)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      res = res.filter(r =>
        r.nhiName.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.institutionCode.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q)
      )
    }
    return res
  }, [records, typeFilter, monthFilter, query])

  async function triggerRun(dryRun = false) {
    setTriggering(true)
    setTriggerMsg('')
    try {
      const res = await fetch('/api/clinic-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: dryRun }),
      })
      const data = await res.json()
      if (!res.ok) setTriggerMsg(`❌ ${data.error}`)
      else setTriggerMsg(dryRun ? '✅ 測試執行已觸發（不寫入 Notion）' : '✅ 監控工作已觸發，約 5 分鐘後可在 GitHub Actions 查看結果')
    } catch (e: any) {
      setTriggerMsg(`❌ ${e.message}`)
    } finally {
      setTriggering(false)
    }
  }

  const hasFilter = !!(typeFilter || monthFilter || query.trim())

  return (
    <div className="space-y-6">

      {/* ── Month summaries ──────────────────────────────────────────────────── */}
      {summaries.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map(s => (
            <button
              key={s.month}
              onClick={() => setMonthFilter(monthFilter === s.month ? '' : s.month)}
              className={`text-left p-4 rounded-2xl border transition-all ${
                monthFilter === s.month
                  ? 'border-gray-700 bg-gray-900 text-white shadow-sm'
                  : 'border-gray-200 bg-white hover:border-gray-400 hover:shadow-sm'
              }`}
            >
              <div className={`text-xs font-semibold mb-2 uppercase tracking-wide ${monthFilter === s.month ? 'text-gray-400' : 'text-gray-400'}`}>
                {s.month}
              </div>
              {s.summary ? (
                <p className={`text-xs leading-relaxed ${monthFilter === s.month ? 'text-gray-300' : 'text-gray-500'}`}>
                  {s.summary.address}
                </p>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {s.stopped > 0 && (
                    <span className={monthFilter === s.month ? 'text-red-300' : 'text-red-600'}>
                      客戶停業 {s.stopped}
                    </span>
                  )}
                  {s.restored > 0 && (
                    <span className={monthFilter === s.month ? 'text-green-300' : 'text-green-600'}>
                      客戶恢復 {s.restored}
                    </span>
                  )}
                  {s.newOpen > 0 && (
                    <span className={monthFilter === s.month ? 'text-purple-300' : 'text-purple-600'}>
                      新診所 {s.newOpen}
                    </span>
                  )}
                  {s.affectedCustomers > 0 && (
                    <span className={monthFilter === s.month ? 'text-yellow-300' : 'text-amber-600'}>
                      影響客戶 {s.affectedCustomers}
                    </span>
                  )}
                  {s.stopped === 0 && s.restored === 0 && (
                    <span className={monthFilter === s.month ? 'text-gray-400' : 'text-gray-400'}>無異動</span>
                  )}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Type filter pills */}
        {(['', '新增停業', '恢復開業', '新開業', '停業', '查無代碼'] as FilterType[]).map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              typeFilter === t
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            {t || '全部'}
          </button>
        ))}

        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜尋診所名稱、機構代碼、客戶…"
            className="input pl-9 pr-3 py-2 text-sm w-full"
          />
        </div>

        {hasFilter && (
          <button
            onClick={() => { setTypeFilter(''); setMonthFilter(''); setQuery('') }}
            className="text-sm text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-gray-100"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            清除
          </button>
        )}

        {/* Manual trigger */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => triggerRun(false)}
            disabled={triggering}
            className="px-3.5 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {triggering ? (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            立即執行
          </button>
        </div>
      </div>

      {/* Trigger message */}
      <AnimatePresence>
        {triggerMsg && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3"
          >
            {triggerMsg}
            <span className="ml-2 text-xs text-gray-400">
              可前往{' '}
              <a
                href="https://github.com/Songtah/songtah-quote/actions/workflows/clinic-monitor.yml"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-gray-700"
              >
                GitHub Actions
              </a>{' '}
              查看進度
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Status bar ───────────────────────────────────────────────────────── */}
      <div className="text-sm text-gray-400">
        {hasFilter ? `找到 ${filtered.length} 筆` : `共 ${records.length} 筆監控紀錄`}
        {records.length === 0 && (
          <span className="ml-2 text-amber-500">
            尚無資料 — 請先執行一次「立即執行」，或等待每月 1 日自動執行
          </span>
        )}
      </div>

      {/* ── Records list ─────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="panel px-6 py-16 text-center">
          <div className="text-3xl mb-3">{hasFilter ? '🔍' : '📡'}</div>
          <p className="text-sm text-gray-400">
            {hasFilter ? '找不到符合條件的紀錄' : '尚無監控紀錄，執行後資料將顯示在這裡'}
          </p>
        </div>
      ) : (
        <div className="panel divide-y divide-gray-50 overflow-hidden">
          {filtered.map(r => (
            <ClinicRow key={r.id} record={r} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Row component ────────────────────────────────────────────────────────────

function ClinicRow({ record: r }: { record: ClinicMonitorRecord }) {
  if (r.type === '月份摘要') {
    return (
      <div className="px-5 py-3 bg-blue-50/60">
        <div className="flex items-center gap-3 flex-wrap">
          <TypeBadge type={r.type} />
          <span className="text-sm font-medium text-blue-800">{r.month}</span>
          <span className="text-sm text-blue-600">{r.address}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors">
      <div className="shrink-0 pt-0.5">
        <TypeBadge type={r.type} />
      </div>

      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900 text-sm">
            {r.nhiName || r.institutionCode || r.customerName}
          </span>
          {r.institutionCode && (
            <span className="text-xs text-gray-400 font-mono">{r.institutionCode}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
          {r.specialty && <span>{r.specialty}</span>}
          {r.address   && <span className="text-gray-400">{r.address}</span>}
          {r.termDate  && <span className="text-red-400">終止：{r.termDate}</span>}
        </div>
      </div>

      {/* Customer link */}
      {r.customerName && (
        <div className="shrink-0 text-right">
          {r.customerUrl ? (
            <a
              href={r.customerUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium hover:underline"
            >
              {r.customerName}
            </a>
          ) : (
            <span className="text-xs text-gray-500">{r.customerName}</span>
          )}
        </div>
      )}
    </div>
  )
}
