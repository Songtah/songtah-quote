'use client'
/**
 * PipelineContent — 業務開發漏斗看板（/bd?tab=pipeline）
 *
 * 資料源：/api/bd/pipeline（客戶開發階段 × 跨月待追蹤組合）。
 * 核心視角：
 *   1. 無人認領的線索（BAS 新開業自動入池）置頂警示——這是漏水最嚴重的地方
 *   2. 各階段分組清單：認領、推進階段、逾期追蹤標紅
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type PipelineItem = {
  id: string
  name: string
  city: string
  district: string
  type: string
  status: string
  salesperson: string
  devStage: string
  devSource: string
  lastEdited: string
  openFollowUps: number
  nextFollowUpDate: string
}

/** 商機偵測掃出、尚未認領也還沒進漏斗的客戶(來自客戶資料監控→商機偵測)。 */
type OpportunityLead = {
  id: string
  name: string
  city: string
  district: string
  tags: string[]
  goldTags: string[]
}

const STAGE_STYLE: Record<string, { dot: string; badge: string }> = {
  '線索':   { dot: 'bg-sky-400',     badge: 'bg-sky-50 text-sky-600' },
  '已接觸': { dot: 'bg-brand-500',   badge: 'bg-brand-50 text-brand-600' },
  '試用中': { dot: 'bg-violet-400',  badge: 'bg-violet-50 text-violet-600' },
  '報價中': { dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-600' },
  '已成交': { dot: 'bg-brand-500', badge: 'bg-brand-50 text-emerald-600' },
  '流失':   { dot: 'bg-stone-300',   badge: 'bg-stone-100 text-stone-500' },
}

const STAGE_LABEL: Record<string, string> = {
  '線索': '尚未聯絡',
  '已接觸': '已聯絡',
  '試用中': '評估中',
  '報價中': '等待成交',
  '已成交': '已成交',
  '流失': '暫不追蹤',
}

const STAGE_DESCRIPTION: Record<string, string> = {
  '線索': '還沒開始聯絡',
  '已接觸': '已經有過第一次互動',
  '試用中': '正在試用或評估產品',
  '報價中': '已提供報價，等待決定',
  '已成交': '已經成立訂單',
  '流失': '目前不繼續追蹤',
}

function isOverdue(dateStr: string) {
  if (!dateStr) return false
  return dateStr < new Date().toISOString().slice(0, 10)
}

/** 停滯天數（以 Notion 最後編輯時間為準） */
function staleDays(lastEdited: string): number {
  if (!lastEdited) return 0
  return Math.floor((Date.now() - new Date(lastEdited).getTime()) / 86_400_000)
}

function nextStep(item: PipelineItem): string {
  if (item.nextFollowUpDate) return '完成已安排的聯絡'
  if (item.openFollowUps > 0) return '安排追蹤日期'
  if (item.devStage === '線索') return '第一次聯絡客戶'
  if (item.devStage === '已接觸') return '記錄需求與下一步'
  if (item.devStage === '試用中') return '確認試用結果'
  if (item.devStage === '報價中') return '確認報價決定'
  if (item.devStage === '已成交') return '持續維護客情'
  return '確認是否重新開發'
}

export default function PipelineContent({ currentUser }: { currentUser?: string }) {
  const [items, setItems] = useState<PipelineItem[]>([])
  const [stages, setStages] = useState<string[]>([])
  const [opportunityLeads, setOpportunityLeads] = useState<OpportunityLead[]>([])
  const [existingOnly, setExistingOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<string>('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [statusMenuId, setStatusMenuId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/bd/pipeline')
      if (!res.ok) throw new Error((await res.json()).error ?? '讀取失敗')
      const data = await res.json()
      setItems(data.items ?? [])
      setStages(data.stages ?? [])
      setOpportunityLeads(data.opportunityLeads ?? [])
      setExistingOnly(data.existingOnly === true)
    } catch (e: any) {
      setError(e?.message ?? '讀取開發漏斗失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function patch(id: string, body: { devStage?: string; salesperson?: string }) {
    setBusyId(id)
    try {
      const res = await fetch('/api/bd/pipeline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? '更新失敗')
      if (body.salesperson && data.salespersonSkipped) {
        // 認領被零覆蓋防呆擋下(已被別人認領):不套用樂觀更新,改用伺服器真實值刷新
        alert(data.error ?? `此客戶已由 ${data.currentSalesperson} 認領`)
        await load()
        return
      }
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...body } as PipelineItem : it)))
    } catch (e: any) {
      alert(e?.message ?? '更新失敗')
    } finally {
      setBusyId(null)
    }
  }

  /** 認領商機客戶:寫負責業務,並比照 BAS 新開業帶「線索」+來源,把客戶正式送進漏斗(此前開發階段是空的,不在 items 裡)。 */
  async function claimOpportunity(id: string) {
    setBusyId(id)
    try {
      const res = await fetch('/api/bd/pipeline', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, salesperson: currentUser, devStage: '線索', devSource: '商機偵測' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? '認領失敗')
      if (data.salespersonSkipped) {
        alert(data.error ?? `此客戶已由 ${data.currentSalesperson} 認領`)
      }
      await load() // 認領後這筆會從商機提示區消失、出現在「已接觸」分組,需要重新整份讀取
    } catch (e: any) {
      alert(e?.message ?? '認領失敗')
    } finally {
      setBusyId(null)
    }
  }

  const unclaimed = useMemo(
    () => items.filter((it) => it.devStage === '線索' && !it.salesperson),
    [items]
  )

  const stageGroups = useMemo(() => {
    const visible = stageFilter ? items.filter((it) => it.devStage === stageFilter) : items
    const groups: Record<string, PipelineItem[]> = {}
    for (const s of stages) groups[s] = []
    for (const it of visible) {
      if (!groups[it.devStage]) groups[it.devStage] = []
      groups[it.devStage].push(it)
    }
    // 每組內：逾期在前 → 有追蹤日在前 → 停滯久的在前
    for (const s of Object.keys(groups)) {
      groups[s].sort((a, b) => {
        const ao = isOverdue(a.nextFollowUpDate) ? 0 : 1
        const bo = isOverdue(b.nextFollowUpDate) ? 0 : 1
        if (ao !== bo) return ao - bo
        if (a.nextFollowUpDate && !b.nextFollowUpDate) return -1
        if (!a.nextFollowUpDate && b.nextFollowUpDate) return 1
        return staleDays(b.lastEdited) - staleDays(a.lastEdited)
      })
    }
    return groups
  }, [items, stages, stageFilter])

  const urgentCount = useMemo(
    () => items.filter((it) => isOverdue(it.nextFollowUpDate) || (it.devStage === '線索' && !it.salesperson)).length,
    [items],
  )

  if (loading) {
    return <div className="py-16 text-center text-sm text-stone-400">載入客戶進度中…</div>
  }
  if (error) {
    return (
      <div className="card-soft p-8 text-center">
        <p className="text-sm text-rose-500">{error}</p>
        <button onClick={load} className="mt-4 px-5 py-2 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">重試</button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="card-soft p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">今天先做這些</p>
            <h2 className="mt-1 text-xl font-bold text-stone-800">
              {urgentCount > 0 ? `${urgentCount} 位客戶需要優先處理` : '目前沒有逾期跟進'}
            </h2>
            <p className="mt-1 text-sm text-stone-500">狀態會隨客情紀錄、試用與報價自動前進，不需要重複維護。</p>
          </div>
          <Link href="/bd?tab=visits&action=new" className="inline-flex min-h-11 items-center justify-center rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95">
            新增客情紀錄
          </Link>
        </div>
      </section>

      {existingOnly && (
        <div className="card-soft p-4 text-sm leading-6 text-stone-500">
          <b className="text-stone-700">目前只維護既有客戶。</b> 此頁只顯示你名下的客戶，不提供未認領名單或新商機認領。
        </div>
      )}

      {/* 單一篩選選單：避免多顆 chip 在手機擠壓，焦點狀態維持圓角 */}
      <div className="relative z-30 max-w-sm">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-stone-400">顯示哪些客戶</p>
        <button
          type="button"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((open) => !open)}
          className="flex min-h-12 w-full items-center gap-3 rounded-2xl bg-white px-4 text-left shadow-sm ring-1 ring-stone-900/[0.06] transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50 active:scale-[0.99]"
        >
          <span className={`size-2.5 shrink-0 rounded-full ${stageFilter ? STAGE_STYLE[stageFilter]?.dot ?? 'bg-stone-300' : 'bg-brand-500'}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-stone-700">{stageFilter ? STAGE_LABEL[stageFilter] ?? stageFilter : '全部客戶'}</span>
            <span className="block text-xs text-stone-400">{stageFilter ? STAGE_DESCRIPTION[stageFilter] : `共 ${items.length} 位客戶`}</span>
          </span>
          <span className={`text-stone-400 transition-transform ${filterOpen ? 'rotate-180' : ''}`}>⌄</span>
        </button>
        {filterOpen && (
          <>
            <button type="button" aria-label="關閉篩選選單" className="fixed inset-0 z-30 cursor-default" onClick={() => setFilterOpen(false)} />
            <div className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-3xl bg-white p-2 shadow-2xl ring-1 ring-stone-900/[0.08]">
              {[{ value: '', label: '全部客戶', description: `共 ${items.length} 位客戶`, count: items.length }, ...stages.map((stage) => ({
                value: stage,
                label: STAGE_LABEL[stage] ?? stage,
                description: STAGE_DESCRIPTION[stage] ?? '',
                count: items.filter((item) => item.devStage === stage).length,
              }))].map((option) => (
                <button
                  key={option.value || 'all'}
                  type="button"
                  onClick={() => { setStageFilter(option.value); setFilterOpen(false) }}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400/40 ${stageFilter === option.value ? 'bg-brand-50' : 'hover:bg-stone-50'}`}
                >
                  <span className={`size-2.5 shrink-0 rounded-full ${option.value ? STAGE_STYLE[option.value]?.dot ?? 'bg-stone-300' : 'bg-brand-500'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-stone-700">{option.label}</span>
                    <span className="block text-xs text-stone-400">{option.description}</span>
                  </span>
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-500">{option.count}</span>
                  {stageFilter === option.value && <span className="text-sm font-bold text-brand-600">✓</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 商機客戶提示區(來自客戶資料監控→商機偵測,尚未認領也還沒進漏斗) */}
      {opportunityLeads.length > 0 && !stageFilter && (
        <div className="card-soft p-4 sm:p-5 border-l-4 border-l-brand-400">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-brand-500">🔍 商機客戶(尚未認領)</p>
              <p className="text-sm text-stone-600 mt-1">
                找到 <span className="font-bold text-brand-600">{opportunityLeads.length}</span> 家可能值得開發的客戶；認領後會加入「尚未聯絡」。
              </p>
            </div>
          </div>
          <div className="divide-y divide-stone-900/[0.04]">
            {opportunityLeads.map((o) => (
              <div key={o.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="flex-1 min-w-[180px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-stone-800">{o.name}</span>
                    <span className="text-[11px] text-stone-400">{o.city}{o.district}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {o.tags.map((t) => (
                      <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full ${o.goldTags.includes(t) ? 'bg-brand-500 text-white font-semibold' : 'bg-stone-100 text-stone-500'}`}>
                        {o.goldTags.includes(t) ? '🔥 ' : ''}{t}
                      </span>
                    ))}
                  </div>
                </div>
                {currentUser ? (
                  <button
                    onClick={() => claimOpportunity(o.id)}
                    disabled={busyId === o.id}
                    className="shrink-0 text-xs px-3 py-1.5 rounded-full font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all disabled:opacity-50"
                  >
                    認領
                  </button>
                ) : (
                  <span className="shrink-0 text-xs text-stone-300">未認領</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 無人認領警示區 */}
      {unclaimed.length > 0 && !stageFilter && (
        <div className="card-soft p-4 sm:p-5 border-l-4 border-l-rose-400">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-rose-400">未認領線索</p>
              <p className="text-sm text-stone-600 mt-1">
                有 <span className="font-bold text-rose-500">{unclaimed.length}</span> 筆線索沒有負責業務——新開業診所的黃金開發窗口只有前幾個月,請儘快認領。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 各階段分組 */}
      {stages.filter((s) => (stageGroups[s]?.length ?? 0) > 0).map((s) => (
        <section key={s} className="card-soft overflow-visible">
          <header className="px-4 sm:px-5 py-3.5 flex items-center gap-2 border-b border-stone-900/[0.06] bg-white/60">
            <span className={`w-2 h-2 rounded-full ${STAGE_STYLE[s]?.dot ?? 'bg-stone-300'}`} />
            <h3 className="text-sm font-bold text-stone-800">{STAGE_LABEL[s] ?? s}</h3>
            <span className="text-xs text-stone-400">{stageGroups[s].length} 家</span>
          </header>
          <div className="divide-y divide-stone-900/[0.04]">
            {stageGroups[s].map((it) => {
              const overdue = isOverdue(it.nextFollowUpDate)
              const stale = staleDays(it.lastEdited)
              return (
                <div key={it.id} className="px-4 sm:px-5 py-4 flex flex-wrap items-center gap-x-4 gap-y-3 hover:bg-brand-50/50 transition-colors">
                  {/* 客戶與現在狀態 */}
                  <div className="min-w-[210px] flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/customers/${it.id}`} className="text-sm font-semibold text-stone-800 hover:text-brand-700">{it.name}</Link>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${STAGE_STYLE[it.devStage]?.badge ?? 'bg-stone-100 text-stone-500'}`}>
                        {STAGE_LABEL[it.devStage] ?? it.devStage}
                      </span>
                      {it.devSource && (
                        <span className="text-[11px] text-stone-400">來自 {it.devSource}</span>
                      )}
                    </div>
                    <p className="text-xs text-stone-400 mt-0.5">
                      {[it.city, it.district, it.type].filter(Boolean).join(' · ')}
                      {stale > 14 && s !== '已成交' && s !== '流失' && (
                        <span className="ml-2 text-amber-500">⏳ 停滯 {stale} 天</span>
                      )}
                    </p>
                  </div>

                  {/* 系統整理的下一步 */}
                  <div className="min-w-[180px] flex-1 sm:flex-none">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">下一步</p>
                    <p className={`mt-0.5 text-sm font-semibold ${overdue ? 'text-rose-600' : 'text-stone-700'}`}>{nextStep(it)}</p>
                  </div>

                  {/* 追蹤狀態 */}
                  <div className="shrink-0 text-right">
                    {it.nextFollowUpDate ? (
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${overdue ? 'bg-rose-50 text-rose-500' : 'bg-amber-50 text-amber-600'}`}>
                        {overdue ? '⚠ 逾期' : '📅'} {it.nextFollowUpDate.slice(5).replace('-', '/')}
                      </span>
                    ) : it.openFollowUps > 0 ? (
                      <span className="text-xs text-stone-400">{it.openFollowUps} 筆追蹤未排期</span>
                    ) : null}
                  </div>

                  {/* 負責業務 / 認領 */}
                  <div className="shrink-0 w-24 text-right">
                    {it.salesperson ? (
                      <span className="text-xs font-medium text-stone-600">{it.salesperson}</span>
                    ) : currentUser ? (
                      <button
                        onClick={() => patch(it.id, { salesperson: currentUser })}
                        disabled={busyId === it.id}
                        className="text-xs px-3 py-1.5 rounded-full font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all disabled:opacity-50"
                      >
                        認領
                      </button>
                    ) : (
                      <span className="text-xs text-stone-300">未認領</span>
                    )}
                  </div>

                  <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
                    <Link
                      href={`/bd?tab=visits&action=new&customer=${encodeURIComponent(it.name)}`}
                      className="inline-flex min-h-10 flex-1 items-center justify-center rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-brand-500/20 transition-all hover:bg-brand-600 active:scale-95 sm:flex-none"
                    >
                      記錄結果
                    </Link>
                    <div className="relative">
                      <button
                        type="button"
                        aria-expanded={statusMenuId === it.id}
                        onClick={() => setStatusMenuId((id) => id === it.id ? null : it.id)}
                        className="rounded-full border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-500 transition-all hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/50 active:scale-95"
                      >
                        修正狀態
                      </button>
                      {statusMenuId === it.id && <>
                        <button type="button" aria-label="關閉狀態選單" className="fixed inset-0 z-30 cursor-default" onClick={() => setStatusMenuId(null)} />
                        <div className="absolute bottom-full right-0 z-40 mb-2 w-64 rounded-3xl bg-white p-2 shadow-2xl ring-1 ring-stone-900/[0.08] sm:bottom-auto sm:mb-0 sm:mt-2">
                        {stages.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            disabled={busyId === it.id || opt === it.devStage}
                            onClick={() => { setStatusMenuId(null); patch(it.id, { devStage: opt }) }}
                            className={`flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400/40 disabled:opacity-40 ${opt === it.devStage ? 'bg-brand-50' : 'hover:bg-stone-50'}`}
                          >
                            <span className={`size-2.5 shrink-0 rounded-full ${STAGE_STYLE[opt]?.dot ?? 'bg-stone-300'}`} />
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-semibold text-stone-700">{STAGE_LABEL[opt] ?? opt}</span>
                              <span className="block text-[11px] text-stone-400">{STAGE_DESCRIPTION[opt]}</span>
                            </span>
                            {opt === it.devStage && <span className="font-bold text-brand-600">✓</span>}
                          </button>
                        ))}
                        </div>
                      </>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {items.length === 0 && (
        <div className="card-soft p-10 text-center text-sm text-stone-400">
          目前沒有開發中的客戶。新客戶認領後會出現在「尚未聯絡」。
        </div>
      )}
    </div>
  )
}
