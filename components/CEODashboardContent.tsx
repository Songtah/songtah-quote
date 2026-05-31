'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import type { CEOStats, SalespersonStat, MonthlyTrend } from '@/lib/ceo-stats'
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
}: {
  label:   string
  value:   string
  sub?:    string
  trend?:  { pct: number; up: boolean; label: string }
  icon:    string
  accent:  string
  loading?: boolean
}) {
  if (loading) return <Skeleton className="h-32" />

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</span>
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
      {trend && (
        <div className={`flex items-center gap-1 text-xs font-medium ${trend.up ? 'text-emerald-600' : 'text-red-500'}`}>
          <span>{trend.up ? '▲' : '▼'}</span>
          <span>{trend.pct}% {trend.label}</span>
        </div>
      )}
    </div>
  )
}

// ── SVG Line Chart ─────────────────────────────────────────────

function LineChart({
  data,
  valueKey,
  color,
  height = 80,
}: {
  data:     MonthlyTrend[]
  valueKey: 'amount' | 'visits' | 'orders' | 'quotes'
  color:    string
  height?:  number
}) {
  if (!data.length) return null

  const values = data.map((d) => d[valueKey] as number)
  const max    = Math.max(...values, 1)
  const W = 320
  const H = height
  const pad = 4

  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (W - pad * 2)
    const y = H - pad - ((v / max) * (H - pad * 2))
    return `${x},${y}`
  })

  const areaBottom = `${W - pad},${H} ${pad},${H}`
  const area = `${pts.join(' ')} ${areaBottom}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`grad-${valueKey}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#grad-${valueKey})`} />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {values.map((v, i) => {
        const x = pad + (i / (values.length - 1)) * (W - pad * 2)
        const y = H - pad - ((v / max) * (H - pad * 2))
        return (
          <circle key={i} cx={x} cy={y} r="3" fill={color} />
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
    <div className="flex items-end gap-1 h-24 w-full">
      {data.map((d, i) => {
        const v   = values[i]
        const pct = (v / max) * 100
        const isLast = i === data.length - 1
        return (
          <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full relative" style={{ height: '80px' }}>
              <div
                className={`absolute bottom-0 w-full rounded-t-md transition-all ${isLast ? 'opacity-100' : 'opacity-60'}`}
                style={{ height: `${Math.max(pct, 2)}%`, background: color }}
              />
            </div>
            <span className="text-[10px] text-gray-400">{d.label}</span>
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

// ── 台北時間今日 (yyyy-mm-dd) ──────────────────────────────────
function todayLocal(): string {
  const now = new Date()
  const tw  = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return tw.toISOString().slice(0, 10)
}

// ── Daily Report Panel ─────────────────────────────────────────

function DailyReportPanel({
  isAdmin,
  salespersonNames: propSalespersons = [],
}: {
  isAdmin: boolean
  salespersonNames?: string[]
}) {
  const [period,      setPeriod]      = useState<'AM' | 'PM' | 'FULL'>('FULL')
  const [date,        setDate]        = useState(todayLocal)
  const [salesperson, setSalesperson] = useState('')
  const [text,        setText]        = useState('')      // 可編輯的日報文字
  const [spNames,     setSpNames]     = useState<string[]>(propSalespersons)
  const [loading,     setLoading]     = useState(false)
  const [sending,     setSending]     = useState(false)
  const [result,      setResult]      = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 每次 props 業務名單更新，補進去（不蓋掉從預覽抓到的）
  useEffect(() => {
    setSpNames((prev) => {
      const seen = new Set(prev)
      const merged = [...prev]
      for (const n of propSalespersons) { if (!seen.has(n)) { seen.add(n); merged.push(n) } }
      return merged
    })
  }, [propSalespersons])

  const loadPreview = useCallback(async () => {
    setLoading(true)
    setResult('')
    try {
      const params = new URLSearchParams({ period, date })
      if (salesperson) params.set('salesperson', salesperson)
      const res  = await fetch(`/api/daily-report?${params}`)
      const data = await res.json()
      if (data.error) { setText(data.error); return }
      setText(data.text ?? '')
      // 補入該日有拜訪紀錄的業務
      if (Array.isArray(data.salespersonNames) && data.salespersonNames.length > 0) {
        setSpNames((prev) => {
          const seen = new Set(prev)
          const merged = [...prev]
          for (const n of data.salespersonNames) { if (!seen.has(n)) { seen.add(n); merged.push(n) } }
          return merged
        })
      }
    } catch {
      setText('預覽失敗，請重試')
    } finally {
      setLoading(false)
    }
  }, [period, date, salesperson])

  const sendReport = async () => {
    setSending(true)
    setResult('')
    try {
      const res = await fetch('/api/daily-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          date,
          salesperson: salesperson || undefined,
          text: text || undefined,   // 傳送使用者編輯後的版本
        }),
      })
      const data = await res.json()
      setResult(data.message ?? data.error ?? '完成')
    } catch {
      setResult('推播失敗，請確認 LINE 設定')
    } finally {
      setSending(false)
    }
  }

  const inputCls = 'rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition'

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">📤 LINE 業務日報</h3>
        {/* Period toggle */}
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
          {(['AM', 'PM', 'FULL'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                period === p ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'
              }`}
            >
              {p === 'AM' ? '上午' : p === 'PM' ? '下午' : '全日'}
            </button>
          ))}
        </div>
      </div>

      {/* Filters: date + salesperson */}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">日期</label>
          <input
            type="date"
            value={date}
            max={todayLocal()}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">業務</label>
          <select
            value={salesperson}
            onChange={(e) => setSalesperson(e.target.value)}
            className={inputCls}
          >
            <option value="">全部業務</option>
            {spNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Editable preview textarea */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">
            日報內容
            {text && <span className="ml-1 text-blue-400">（可直接編輯）</span>}
          </label>
          {text && (
            <button
              onClick={() => setText('')}
              className="text-[10px] text-gray-300 hover:text-gray-500"
            >
              清除
            </button>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder="點擊「預覽」載入日報內容，可在此直接編輯後再推播…"
          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-700 font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 placeholder:text-gray-300 transition"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={loadPreview}
          disabled={loading}
          className="button-secondary px-3 py-1.5 text-sm rounded-lg disabled:opacity-50"
        >
          {loading ? '載入中…' : '🔍 預覽'}
        </button>
        {isAdmin && (
          <button
            onClick={sendReport}
            disabled={sending || !text}
            className="button-primary px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 flex items-center gap-1.5"
          >
            {sending ? '傳送中…' : '📲 推播至 LINE'}
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto">
          {text ? `${text.length} 字元` : '尚無內容'}
        </span>
      </div>

      {result && (
        <p className={`text-sm px-3 py-2 rounded-lg ${result.includes('失敗') || result.includes('尚未')
          ? 'bg-red-50 text-red-700'
          : 'bg-emerald-50 text-emerald-700'}`}>
          {result}
        </p>
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
  const [stats,     setStats]     = useState<CEOStats | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [refreshed, setRefreshed] = useState<Date | null>(null)

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
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={listItem}>
          <KPICard
            loading={loading}
            label="本月訂單金額"
            value={tm ? fmtAmtFull(tm.ordersAmount) : '—'}
            sub={tm ? `${tm.ordersCount} 筆訂單` : undefined}
            trend={amtDelta ? { ...amtDelta, label: '較上月' } : undefined}
            icon="💰"
            accent="#2563eb"
          />
        </motion.div>
        <motion.div variants={listItem}>
          <KPICard
            loading={loading}
            label="本月拜訪數"
            value={tm ? `${tm.visitsCount}` : '—'}
            sub="客情拜訪紀錄"
            trend={visitDelta ? { ...visitDelta, label: '較上月' } : undefined}
            icon="🚗"
            accent="#0f766e"
          />
        </motion.div>
        <motion.div variants={listItem}>
          <KPICard
            loading={loading}
            label="本月報價數"
            value={tm ? `${tm.quotesCount}` : '—'}
            sub="含草稿"
            icon="📋"
            accent="#7c3aed"
          />
        </motion.div>
        <motion.div variants={listItem}>
          <KPICard
            loading={loading}
            label="報價轉換率"
            value={s ? `${s.quoteConversionRate}%` : '—'}
            sub="報價→訂單"
            icon="📈"
            accent="#b45309"
          />
        </motion.div>
        <motion.div variants={listItem} className="col-span-2 sm:col-span-1">
          <KPICard
            loading={loading}
            label="待追蹤客情"
            value={tm ? `${tm.pendingFollowUps}` : '—'}
            sub="需後續聯繫"
            icon="⚠️"
            accent="#dc2626"
          />
        </motion.div>
      </motion.section>

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
                <LineChart data={s.monthlyTrend} valueKey="amount" color="#2563eb" height={80} />
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

          {/* LINE Daily Report */}
          <DailyReportPanel
            isAdmin={isAdmin}
            salespersonNames={s?.salespersonStats.map((sp) => sp.name) ?? []}
          />
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
