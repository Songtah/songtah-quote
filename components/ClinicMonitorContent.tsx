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

/** 解析月份摘要的 address 欄位，格式：「牙醫診所：7653｜牙體技術所：1089｜...」 */
function parseSummaryStats(address: string): Record<string, number> {
  const stats: Record<string, number> = {}
  for (const part of address.split('｜')) {
    const idx = part.indexOf('：')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    const val = parseInt(part.slice(idx + 1).trim(), 10)
    if (key && !isNaN(val)) stats[key] = val
  }
  return stats
}

function deriveMonthSummaries(records: ClinicMonitorRecord[]) {
  const byMonth: Record<string, {
    summary: ClinicMonitorRecord | null
    stopped: number
    restored: number
    newOpen: number
    newOpenLabs: number
    notFound: number
    affectedCustomers: number
  }> = {}

  for (const r of records) {
    if (!r.month) continue
    if (!byMonth[r.month]) {
      byMonth[r.month] = { summary: null, stopped: 0, restored: 0, newOpen: 0, newOpenLabs: 0, notFound: 0, affectedCustomers: 0 }
    }
    const m = byMonth[r.month]
    if (r.type === '月份摘要') { m.summary = r; continue }
    if (r.type === '新增停業') m.stopped++
    if (r.type === '恢復開業') m.restored++
    if (r.type === '新開業') {
      if (r.specialty === '牙體技術所') m.newOpenLabs++
      else m.newOpen++
    }
    if (r.type === '查無代碼') m.notFound++
    if (r.customerName && (r.type === '新增停業' || r.type === '恢復開業')) m.affectedCustomers++
  }

  return Object.entries(byMonth)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, data]) => {
      const stats = data.summary ? parseSummaryStats(data.summary.address) : {}
      return {
        month,
        ...data,
        totalClinics:   stats['牙醫診所']   ?? null as number | null,
        totalLabs:      stats['牙體技術所'] ?? null as number | null,
        totalCustomers: stats['崧達客戶']   ?? null as number | null,
        closedNonCust:  stats['停業（非客戶）'] ?? null as number | null,
      }
    })
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
    // 月份摘要已由上方卡片呈現，清單不重複顯示
    let res = records.filter(r => r.type !== '月份摘要')
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
    <div className="space-y-5">

      {/* ── Month summary cards ──────────────────────────────────────────────── */}
      {summaries.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summaries.map(s => {
            const active = monthFilter === s.month
            const hasChanges = s.stopped > 0 || s.restored > 0 || s.newOpen > 0 || s.newOpenLabs > 0
            const hasGlobalStats = s.totalClinics != null || s.totalLabs != null || s.totalCustomers != null
            return (
              <button
                key={s.month}
                onClick={() => setMonthFilter(active ? '' : s.month)}
                className={`text-left p-4 rounded-2xl border transition-all ${
                  active
                    ? 'border-gray-700 bg-gray-900 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                }`}
              >
                {/* Month label */}
                <div className={`text-xs font-semibold mb-2.5 tracking-wide ${active ? 'text-gray-400' : 'text-gray-400'}`}>
                  {s.month}
                </div>

                {/* 異動統計 chips */}
                {hasChanges ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs font-medium mb-3">
                    {s.stopped > 0 && (
                      <span className={active ? 'text-red-300' : 'text-red-600'}>
                        客戶停業 {s.stopped}
                      </span>
                    )}
                    {s.restored > 0 && (
                      <span className={active ? 'text-green-300' : 'text-green-600'}>
                        客戶恢復 {s.restored}
                      </span>
                    )}
                    {s.newOpen > 0 && (
                      <span className={active ? 'text-purple-300' : 'text-purple-600'}>
                        新診所 {s.newOpen}
                      </span>
                    )}
                    {s.newOpenLabs > 0 && (
                      <span className={active ? 'text-violet-300' : 'text-violet-600'}>
                        新牙技所 {s.newOpenLabs}
                      </span>
                    )}
                    {s.notFound > 0 && (
                      <span className={active ? 'text-orange-300' : 'text-orange-500'}>
                        查無代碼 {s.notFound}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mb-3">
                    <span className={`text-xs ${active ? 'text-gray-500' : 'text-gray-400'}`}>
                      {s.notFound > 0 ? `查無代碼 ${s.notFound} 筆` : '本月無異動'}
                    </span>
                  </div>
                )}

                {/* 對照數字：全台規模 */}
                {hasGlobalStats && (
                  <div className={`border-t pt-2.5 mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs ${active ? 'border-gray-700' : 'border-gray-100'}`}>
                    {s.totalClinics != null && (
                      <span className={active ? 'text-gray-400' : 'text-gray-400'}>
                        診所{' '}
                        <span className={`font-semibold tabular-nums ${active ? 'text-gray-200' : 'text-gray-600'}`}>
                          {s.totalClinics.toLocaleString()}
                        </span>
                      </span>
                    )}
                    {s.totalLabs != null && (
                      <span className={active ? 'text-gray-400' : 'text-gray-400'}>
                        牙技所{' '}
                        <span className={`font-semibold tabular-nums ${active ? 'text-gray-200' : 'text-gray-600'}`}>
                          {s.totalLabs.toLocaleString()}
                        </span>
                      </span>
                    )}
                    {s.totalCustomers != null && (
                      <span className={active ? 'text-gray-400' : 'text-gray-400'}>
                        崧達客戶{' '}
                        <span className={`font-semibold tabular-nums ${active ? 'text-indigo-300' : 'text-indigo-600'}`}>
                          {s.totalCustomers.toLocaleString()}
                        </span>
                        {s.totalClinics != null && s.totalLabs != null && (
                          <span className={`ml-0.5 ${active ? 'text-gray-500' : 'text-gray-400'}`}>
                            {' '}({((s.totalCustomers / (s.totalClinics + s.totalLabs)) * 100).toFixed(1)}%)
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {/* Row 1: type pills (horizontal scroll) + trigger button */}
        <div className="flex items-center gap-2">
          {/* Pills — scrollable, no visible scrollbar */}
          <div className="flex-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            <div className="inline-flex gap-1.5 min-w-max">
              {(['', '新增停業', '恢復開業', '新開業', '停業', '查無代碼'] as FilterType[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(typeFilter === t ? '' : t)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors whitespace-nowrap ${
                    typeFilter === t
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {t || '全部'}
                </button>
              ))}
            </div>
          </div>

          {/* Trigger — always visible on the right */}
          <button
            onClick={() => triggerRun(false)}
            disabled={triggering}
            className="shrink-0 px-3 py-1.5 rounded-full bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50 flex items-center gap-1.5 border border-gray-900"
          >
            {triggering ? (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            <span className="hidden sm:inline">立即執行</span>
            <span className="sm:hidden">執行</span>
          </button>
        </div>

        {/* Row 2: search + clear */}
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜尋診所、代碼、客戶…"
              className="input pl-9 pr-3 py-2 text-sm w-full"
            />
          </div>
          {hasFilter && (
            <button
              onClick={() => { setTypeFilter(''); setMonthFilter(''); setQuery('') }}
              className="shrink-0 text-sm text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-gray-100"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span className="hidden sm:inline">清除篩選</span>
            </button>
          )}
        </div>
      </div>

      {/* Trigger message */}
      <AnimatePresence>
        {triggerMsg && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap"
          >
            <span>{triggerMsg}</span>
            <a
              href="https://github.com/Songtah/songtah-quote/actions/workflows/clinic-monitor.yml"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-gray-400 underline hover:text-gray-600 ml-1"
            >
              查看 GitHub Actions
            </a>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Status bar ───────────────────────────────────────────────────────── */}
      <div className="text-sm text-gray-400">
        {hasFilter ? `找到 ${filtered.length} 筆` : `共 ${records.filter(r => r.type !== '月份摘要').length} 筆監控紀錄`}
        {records.length === 0 && (
          <span className="ml-2 text-amber-500">
            尚無資料 — 請先執行「立即執行」，或等待每月 1 日自動執行
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
        <div className="panel divide-y divide-gray-100 overflow-hidden">
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
  return (
    <div className="px-4 sm:px-5 py-3 sm:py-3.5 hover:bg-gray-50 transition-colors">
      {/* Mobile: badge on top row; Desktop: badge left-aligned inline */}
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-0.5 hidden sm:block">
          <TypeBadge type={r.type} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Mobile badge + name on same line */}
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="sm:hidden shrink-0">
              <TypeBadge type={r.type} />
            </span>
            <span className="font-medium text-gray-900 text-sm">
              {r.nhiName || r.institutionCode || r.customerName}
            </span>
            {r.institutionCode && (
              <span className="text-xs text-gray-400 font-mono hidden sm:inline">{r.institutionCode}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
            {r.institutionCode && (
              <span className="text-gray-400 font-mono sm:hidden">{r.institutionCode}</span>
            )}
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
                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium hover:underline max-w-[80px] sm:max-w-none block text-right leading-tight"
              >
                {r.customerName}
              </a>
            ) : (
              <span className="text-xs text-gray-500 max-w-[80px] sm:max-w-none block text-right leading-tight">{r.customerName}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
