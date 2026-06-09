'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import type { CEOStats, SalespersonStat, MonthlyTrend, VisitStat } from '@/lib/ceo-stats'
import { stagger, listItem } from '@/lib/motion'

// ── 工具函式 ───────────────────────────────────────────────────

function fmtAmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString()
}

function fmtAmtFull(n: number) {
  return `NT$ ${n.toLocaleString()}`
}

function delta(cur: number, prev: number): { pct: number; up: boolean } {
  if (!prev) return { pct: 0, up: cur >= 0 }
  const pct = Math.round(((cur - prev) / prev) * 100)
  return { pct: Math.abs(pct), up: cur >= prev }
}

// ── Skeleton ───────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-100 ${className ?? ''}`} />
}

// ── KPI Card ───────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  trend,
  icon,
  accent,
  loading,
  href,
  onClick,
}: {
  label:    string
  value:    string
  sub?:     string
  trend?:   { pct: number; up: boolean; label: string }
  icon:     string
  accent:   string
  loading?: boolean
  href?:    string
  onClick?: () => void
}) {
  if (loading) return <Skeleton className="h-[120px]" />

  const interactive = !!(href || onClick)

  const inner = (
    <div
      onClick={onClick}
      className={`h-full bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col justify-between gap-2 transition-shadow ${interactive ? 'hover:shadow-md hover:border-gray-200 cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider leading-snug">{label}</span>
        <span
          className="w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0"
          style={{ background: `${accent}18`, color: accent }}
        >
          {icon}
        </span>
      </div>
      <div>
        <div className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums leading-none">{value}</div>
        {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
      </div>
      {/* trend 區域固定佔位，確保各卡片高度一致 */}
      <div className="min-h-[18px]">
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trend.up ? 'text-emerald-600' : 'text-red-500'}`}>
            <span>{trend.up ? '▲' : '▼'}</span>
            <span>{trend.pct}% {trend.label}</span>
          </div>
        )}
      </div>
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="block h-full" prefetch>
        {inner}
      </Link>
    )
  }
  return inner
}

// ── 待追蹤客情 Modal ───────────────────────────────────────────

function FollowUpModal({
  items,
  onClose,
}: {
  items: VisitStat[]
  onClose: () => void
}) {
  function formatDate(d: string) {
    if (!d) return ''
    return d.slice(0, 10).replace(/-/g, '/')
  }

  // 判斷追蹤日是否已逾期
  function isOverdue(dateStr: string) {
    if (!dateStr) return false
    const today = new Date().toISOString().slice(0, 10)
    return dateStr < today
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 overflow-y-auto">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 border-b border-red-100/60 bg-red-50/40 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-red-400">本月待追蹤</p>
              <h3 className="text-base font-bold text-gray-900 mt-0.5">
                ⚠️ 客情追蹤清單
                <span className="ml-2 text-sm font-medium text-red-500">（{items.length} 筆）</span>
              </h3>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition text-lg leading-none"
            >✕</button>
          </div>
          {/* List */}
          <div className="divide-y divide-gray-50 max-h-[65vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">本月無待追蹤客情</div>
            ) : items.map((v, i) => {
              const overdue = isOverdue(v.nextFollowUpDate)
              return (
                <div key={i} className="px-5 py-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* 客戶名 + 業務 */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-900 text-sm">{v.customerName}</span>
                        {v.salesperson && (
                          <span className="text-xs text-gray-400">{v.salesperson}</span>
                        )}
                        {v.city && (
                          <span className="text-xs text-gray-400">{v.city}</span>
                        )}
                      </div>
                      {/* 後續動作 */}
                      {v.followUpAction && (
                        <p className="text-xs text-gray-600 mt-1 leading-relaxed line-clamp-2">
                          {v.followUpAction}
                        </p>
                      )}
                      {/* 互動目的 / 客戶反應 */}
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {v.interactionPurpose && (
                          <span className="text-xs bg-blue-50 text-blue-600 border border-blue-100 rounded-full px-2 py-0.5">{v.interactionPurpose}</span>
                        )}
                        {v.customerReaction && (
                          <span className="text-xs bg-gray-100 text-gray-600 border border-gray-200 rounded-full px-2 py-0.5">{v.customerReaction}</span>
                        )}
                      </div>
                    </div>
                    {/* 追蹤日 */}
                    <div className="shrink-0 text-right">
                      {v.nextFollowUpDate ? (
                        <span className={`text-xs font-medium px-2 py-1 rounded-lg ${
                          overdue
                            ? 'bg-red-100 text-red-600'
                            : 'bg-orange-50 text-orange-600'
                        }`}>
                          {overdue ? '⚠ 已逾期' : '📅'} {formatDate(v.nextFollowUpDate)}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">未排期</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          {/* Footer */}
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center">
            <Link href="/bd" className="text-xs text-blue-500 hover:text-blue-700 font-medium transition-colors">
              前往客情紀錄 →
            </Link>
            <button
              onClick={onClose}
              className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 transition"
            >
              關閉
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── SVG Line Chart ─────────────────────────────────────────────

function LineChart({
  data,
  valueKey,
  color,
  height = 80,
  formatValue,
}: {
  data:         MonthlyTrend[]
  valueKey:     'amount' | 'visits' | 'orders' | 'quotes'
  color:        string
  height?:      number
  formatValue?: (v: number) => string
}) {
  if (!data.length) return null

  const values  = data.map((d) => d[valueKey] as number)
  const max     = Math.max(...values, 1)
  const W       = 320
  const labelH  = 14          // reserved space at top for value labels
  const pad     = 6
  const H       = height + labelH
  const drawTop = labelH + pad
  const drawH   = H - drawTop - pad

  const coords = values.map((v, i) => ({
    x: pad + (i / Math.max(values.length - 1, 1)) * (W - pad * 2),
    y: drawTop + drawH - (v / max) * drawH,
  }))

  const pts        = coords.map((c) => `${c.x},${c.y}`).join(' ')
  const areaBottom = `${W - pad},${H} ${pad},${H}`
  const area       = `${pts} ${areaBottom}`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height: H }}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`grad-${valueKey}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#grad-${valueKey})`} />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {coords.map(({ x, y }, i) => {
        const v      = values[i]
        const isLast = i === values.length - 1
        const label  = formatValue ? formatValue(v) : String(v)
        const anchor = i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle'
        return (
          <g key={i}>
            {/* 白色背景讓數字在漸層上可讀 */}
            <text
              x={x} y={y - 5}
              textAnchor={anchor}
              fontSize="9"
              fill="white"
              stroke="white"
              strokeWidth="3"
              paintOrder="stroke"
              fontWeight={isLast ? 'bold' : 'normal'}
            >
              {label}
            </text>
            <text
              x={x} y={y - 5}
              textAnchor={anchor}
              fontSize="9"
              fill={isLast ? color : '#9ca3af'}
              fontWeight={isLast ? 'bold' : 'normal'}
            >
              {label}
            </text>
            <circle cx={x} cy={y} r={isLast ? 4 : 3} fill={color} />
          </g>
        )
      })}
    </svg>
  )
}

// ── Bar Chart ──────────────────────────────────────────────────

function BarChart({
  data,
  valueKey,
  color,
  formatValue,
}: {
  data:        MonthlyTrend[]
  valueKey:    'amount' | 'visits' | 'orders'
  color:       string
  formatValue?: (v: number) => string
}) {
  const values = data.map((d) => d[valueKey] as number)
  const max    = Math.max(...values, 1)

  return (
    <div className="flex items-end gap-1 w-full">
      {data.map((d, i) => {
        const v      = values[i]
        const pct    = (v / max) * 100
        const isLast = i === data.length - 1
        const label  = formatValue ? formatValue(v) : String(v)
        return (
          <div key={d.month} className="flex-1 flex flex-col items-center gap-0.5">
            {/* 柱頂數值 */}
            <span
              className={`text-[9px] font-semibold leading-none ${
                isLast ? 'text-teal-700' : 'text-gray-400'
              }`}
            >
              {label}
            </span>
            {/* 柱體 */}
            <div className="w-full relative" style={{ height: '64px' }}>
              <div
                className={`absolute bottom-0 w-full rounded-t-sm transition-all ${
                  isLast ? 'opacity-100' : 'opacity-55'
                }`}
                style={{ height: `${Math.max(pct, 2)}%`, background: color }}
              />
            </div>
            {/* 月份標籤 */}
            <span className="text-[10px] text-gray-400 leading-none mt-0.5">{d.label}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Salesperson Table ──────────────────────────────────────────

function SalespersonTable({ stats, loading }: { stats: SalespersonStat[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-48" />
  if (!stats.length) return (
    <div className="text-center text-gray-400 py-8 text-sm">本月尚無業務活動紀錄</div>
  )

  const maxAmt = Math.max(...stats.map((s) => s.amount), 1)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-gray-400 border-b border-gray-100">
            <th className="text-left pb-2 font-medium pr-3">#</th>
            <th className="text-left pb-2 font-medium">業務</th>
            <th className="text-center pb-2 font-medium">拜訪</th>
            <th className="text-center pb-2 font-medium">訂單</th>
            <th className="text-right pb-2 font-medium">業績</th>
            <th className="text-center pb-2 font-medium">待追蹤</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {stats.map((s, i) => {
            const barPct = maxAmt > 0 ? (s.amount / maxAmt) * 100 : 0
            return (
              <tr key={s.name} className="group">
                <td className="py-2.5 pr-3 text-gray-400 text-xs">{i + 1}</td>
                <td className="py-2.5 font-medium text-gray-800">{s.name}</td>
                <td className="py-2.5 text-center tabular-nums text-gray-600">{s.visits}</td>
                <td className="py-2.5 text-center tabular-nums text-gray-600">{s.orders}</td>
                <td className="py-2.5 text-right tabular-nums">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden hidden sm:block">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <span className={`font-semibold ${s.amount > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                      {s.amount > 0 ? fmtAmt(s.amount) : '—'}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 text-center">
                  {s.followUps > 0 ? (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">
                      {s.followUps}
                    </span>
                  ) : (
                    <span className="text-gray-200">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Order Status Pills ─────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  草稿:   'bg-gray-100 text-gray-500',
  已送出: 'bg-blue-100 text-blue-700',
  確認中: 'bg-yellow-100 text-yellow-700',
  已到貨: 'bg-emerald-100 text-emerald-700',
  已取消: 'bg-red-100 text-red-500',
}

// ── 今日業務動態 ───────────────────────────────────────────────
//
// ✏️ 指定要固定顯示的業務名稱（留空陣列 = 自動顯示當日有拜訪紀錄的人）
//    例：const PINNED_SALESPERSONS = ['王小明', '陳大華', '李美玲']
//
const PINNED_SALESPERSONS: string[] = []

interface TodayVisitItem {
  customerName:       string
  salesperson:        string
  city:               string
  content:            string
  interactionPurpose: string
  followUpAction:     string
  needsFollowUp:      boolean
}

interface TodayGroup {
  salesperson: string
  count:       number
  visits:      TodayVisitItem[]
}

function todayDateTW(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function TodaySalespersonWidget() {
  const [groups,   setGroups]   = useState<TodayGroup[]>([])
  const [fetching, setFetching] = useState(true)
  const [date,     setDate]     = useState(todayDateTW)
  const [selected, setSelected] = useState<TodayGroup | null>(null)

  useEffect(() => {
    setFetching(true)
    fetch(`/api/visits/today?date=${date}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data.groups)) setGroups(data.groups) })
      .catch(() => {})
      .finally(() => setFetching(false))
  }, [date])

  // 顯示清單：若有固定名單則以固定名單為主（找不到的補空）；否則顯示全部有紀錄的人
  const displayGroups: TodayGroup[] =
    PINNED_SALESPERSONS.length > 0
      ? PINNED_SALESPERSONS.map(
          (sp) => groups.find((g) => g.salesperson === sp) ?? { salesperson: sp, count: 0, visits: [] }
        )
      : groups

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <h3 className="font-semibold text-gray-900 shrink-0">📋 今日業務動態</h3>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
      </div>

      {/* Salesperson buttons */}
      {fetching ? (
        <div className="flex gap-2 flex-wrap">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-9 w-20 bg-gray-100 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : displayGroups.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">今日尚無拜訪紀錄</p>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {displayGroups.map((g) => (
            <button
              key={g.salesperson}
              onClick={() => setSelected(g)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all border ${
                g.count > 0
                  ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 active:bg-blue-200'
                  : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100'
              }`}
            >
              {g.salesperson}
              {g.count > 0 && (
                <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold bg-blue-500 text-white rounded-full">
                  {g.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 快速連結 */}
      <div className="mt-3 pt-3 border-t border-gray-50">
        <Link href="/bd?tab=report" className="text-xs text-blue-500 hover:text-blue-700 font-medium">
          前往業務日報工具 →
        </Link>
      </div>

      {/* ── Modal ── */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white w-full max-w-lg rounded-2xl shadow-xl max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 shrink-0">
              <div>
                <h3 className="font-bold text-gray-900 text-lg">{selected.salesperson}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{date} · {selected.count} 筆拜訪紀錄</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 text-lg"
              >
                ✕
              </button>
            </div>

            {/* Visit cards */}
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
              {selected.visits.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">今日尚無拜訪紀錄</p>
              ) : (
                selected.visits.map((v, i) => (
                  <div key={i} className="border border-gray-100 rounded-xl p-4 space-y-1.5 hover:border-gray-200 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-semibold text-gray-900 leading-snug">{v.customerName}</h4>
                      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                        {v.city && (
                          <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">
                            {v.city}
                          </span>
                        )}
                        {v.needsFollowUp && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 font-medium">
                            待追蹤
                          </span>
                        )}
                      </div>
                    </div>
                    {v.interactionPurpose && (
                      <p className="text-xs text-blue-600 font-medium">目的：{v.interactionPurpose}</p>
                    )}
                    {v.content && (
                      <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{v.content}</p>
                    )}
                    {v.followUpAction && (
                      <p className="text-xs text-gray-500 border-t border-gray-50 pt-1.5 mt-1.5">
                        後續：{v.followUpAction}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 pt-3 border-t border-gray-100 shrink-0">
              <Link
                href="/bd"
                className="block w-full text-center text-sm text-blue-600 hover:text-blue-800 font-medium py-1"
                onClick={() => setSelected(null)}
              >
                查看完整客情紀錄 →
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────

export function CEODashboardContent({
  isAdmin = false,
}: {
  isAdmin?: boolean
}) {
  const [stats,           setStats]           = useState<CEOStats | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState('')
  const [refreshed,       setRefreshed]       = useState<Date | null>(null)
  const [showFollowUpModal, setShowFollowUpModal] = useState(false)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/dashboard/ceo')
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setStats(data)
      setRefreshed(new Date())
    } catch (e: any) {
      setError(e?.message ?? '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  const s  = stats
  const tm = s?.thisMonth
  const lm = s?.lastMonth
  const amtDelta  = s ? delta(tm!.ordersAmount, lm!.ordersAmount) : null
  const visitDelta = s ? delta(tm!.visitsCount, lm!.visitsCount)  : null

  return (
    <div className="space-y-6">

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="flex-1 text-sm text-amber-700">{error}</p>
          <button onClick={fetchStats} className="shrink-0 text-sm font-semibold text-amber-700 underline">
            重試
          </button>
        </div>
      )}

      {/* ── KPI Cards ── */}
      <motion.section
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 items-stretch"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={listItem} className="h-full">
          <KPICard
            loading={loading}
            label="本月訂單金額"
            value={tm ? fmtAmtFull(tm.ordersAmount) : '—'}
            sub={tm ? `${tm.ordersCount} 筆訂單` : undefined}
            trend={amtDelta ? { ...amtDelta, label: '較上月' } : undefined}
            icon="💰"
            accent="#2563eb"
            href="/orders"
          />
        </motion.div>
        <motion.div variants={listItem} className="h-full">
          <KPICard
            loading={loading}
            label="本月拜訪數"
            value={tm ? `${tm.visitsCount}` : '—'}
            sub="客情拜訪紀錄"
            trend={visitDelta ? { ...visitDelta, label: '較上月' } : undefined}
            icon="🚗"
            accent="#0f766e"
            href="/bd"
          />
        </motion.div>
        <motion.div variants={listItem} className="h-full">
          <KPICard
            loading={loading}
            label="本月報價數"
            value={tm ? `${tm.quotesCount}` : '—'}
            sub="含草稿"
            icon="📋"
            accent="#7c3aed"
            href="/quotes"
          />
        </motion.div>
        <motion.div variants={listItem} className="h-full">
          <KPICard
            loading={loading}
            label="報價轉換率"
            value={s ? `${s.quoteConversionRate}%` : '—'}
            sub="報價→訂單"
            icon="📈"
            accent="#b45309"
            href="/quotes"
          />
        </motion.div>
        <motion.div variants={listItem} className="h-full">
          <KPICard
            loading={loading}
            label="待追蹤客情"
            value={tm ? `${tm.pendingFollowUps}` : '—'}
            sub="點擊查看明細"
            icon="⚠️"
            accent="#dc2626"
            onClick={() => setShowFollowUpModal(true)}
          />
        </motion.div>
      </motion.section>

      {/* 待追蹤客情 Modal */}
      {showFollowUpModal && s?.pendingFollowUpItems && (
        <FollowUpModal
          items={s.pendingFollowUpItems}
          onClose={() => setShowFollowUpModal(false)}
        />
      )}

      {/* ── Charts Row ── */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* Revenue Trend */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">近 6 月訂單趨勢</p>
              <h3 className="font-semibold text-gray-900">月度業績走勢</h3>
            </div>
            {s && (
              <span className="text-xs text-gray-400">
                最高 {fmtAmt(Math.max(...s.monthlyTrend.map((m) => m.amount)))}
              </span>
            )}
          </div>
          {loading
            ? <Skeleton className="h-24" />
            : s && (
              <>
                <LineChart data={s.monthlyTrend} valueKey="amount" color="#2563eb" height={80} formatValue={fmtAmt} />
                <div className="flex justify-between mt-2">
                  {s.monthlyTrend.map((m) => (
                    <span key={m.month} className="text-[10px] text-gray-400 flex-1 text-center">{m.label}</span>
                  ))}
                </div>
              </>
            )
          }
        </div>

        {/* Visits Trend */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">近 6 月拜訪趨勢</p>
              <h3 className="font-semibold text-gray-900">客情活動量</h3>
            </div>
            {s && (
              <span className="text-xs text-gray-400">
                最高 {Math.max(...s.monthlyTrend.map((m) => m.visits))} 筆
              </span>
            )}
          </div>
          {loading
            ? <Skeleton className="h-24" />
            : s && (
              <>
                <BarChart data={s.monthlyTrend} valueKey="visits" color="#0f766e" />
              </>
            )
          }
        </div>
      </div>

      {/* ── Bottom Row ── */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">

        {/* Salesperson ranking */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">本月業務排行</p>
              <h3 className="font-semibold text-gray-900">業績 & 拜訪量</h3>
            </div>
            <Link href="/bd" className="text-xs text-blue-500 hover:text-blue-700">
              查看客情拜訪紀錄 →
            </Link>
          </div>
          <SalespersonTable stats={s?.salespersonStats ?? []} loading={loading} />
        </div>

        {/* Right column */}
        <div className="space-y-4">

          {/* Order status breakdown */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-1">本月訂單狀態</p>
            <h3 className="font-semibold text-gray-900 mb-3">訂單分佈</h3>
            {loading
              ? <Skeleton className="h-20" />
              : s && Object.keys(s.ordersByStatus).length > 0
                ? (
                  <div className="space-y-2">
                    {Object.entries(s.ordersByStatus)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, count]) => {
                        const total = Object.values(s.ordersByStatus).reduce((a, b) => a + b, 0)
                        const pct   = total > 0 ? Math.round((count / total) * 100) : 0
                        return (
                          <div key={status} className="flex items-center gap-2">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[status] ?? 'bg-gray-100 text-gray-500'}`}>
                              {status}
                            </span>
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-blue-500 transition-all"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-gray-500 w-8 text-right">{count}</span>
                          </div>
                        )
                      })}
                  </div>
                )
                : <p className="text-sm text-gray-400">本月尚無訂單</p>
            }
          </div>

          {/* 今日業務動態 */}
          <TodaySalespersonWidget />
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 mb-3">快速操作</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { href: '/quote/new',   label: '建立報價單', icon: '📄' },
            { href: '/orders/new',  label: '建立訂貨單', icon: '📦' },
            { href: '/tickets/new', label: '建立工單',   icon: '🔧' },
            { href: '/bd',          label: '客情拜訪',   icon: '🚗' },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-gray-100 px-3 py-3 hover:border-blue-200 hover:bg-blue-50 transition-all text-center group"
            >
              <span className="text-2xl group-hover:scale-110 transition-transform">{item.icon}</span>
              <span className="text-xs font-medium text-gray-600 group-hover:text-blue-700">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>資料每 15 分鐘自動更新</span>
        <div className="flex items-center gap-3">
          {refreshed && (
            <span>上次更新 {refreshed.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</span>
          )}
          <button
            onClick={fetchStats}
            disabled={loading}
            className="text-blue-500 hover:text-blue-700 disabled:opacity-40 font-medium"
          >
            {loading ? '更新中...' : '立即更新'}
          </button>
        </div>
      </div>
    </div>
  )
}
