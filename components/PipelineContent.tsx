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
  '已成交': { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-600' },
  '流失':   { dot: 'bg-stone-300',   badge: 'bg-stone-100 text-stone-500' },
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

export default function PipelineContent({ currentUser }: { currentUser?: string }) {
  const [items, setItems] = useState<PipelineItem[]>([])
  const [stages, setStages] = useState<string[]>([])
  const [opportunityLeads, setOpportunityLeads] = useState<OpportunityLead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<string>('')

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

  if (loading) {
    return <div className="py-16 text-center text-sm text-stone-400">載入開發漏斗中…</div>
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
      {/* 階段統計 + 篩選 */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStageFilter('')}
          className={stageFilter === '' ? 'chip-active' : 'chip'}
        >
          全部 {items.length}
        </button>
        {stages.map((s) => {
          const n = items.filter((it) => it.devStage === s).length
          return (
            <button key={s} onClick={() => setStageFilter(stageFilter === s ? '' : s)} className={stageFilter === s ? 'chip-active' : 'chip'}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${STAGE_STYLE[s]?.dot ?? 'bg-stone-300'}`} />
              {s} {n}
            </button>
          )
        })}
      </div>

      {/* 商機客戶提示區(來自客戶資料監控→商機偵測,尚未認領也還沒進漏斗) */}
      {opportunityLeads.length > 0 && !stageFilter && (
        <div className="card-soft p-5 border-l-4 border-l-brand-400">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-brand-500">🔍 商機客戶(尚未認領)</p>
              <p className="text-sm text-stone-600 mt-1">
                客戶資料監控掃到 <span className="font-bold text-brand-600">{opportunityLeads.length}</span> 家有設備/數位訊號但還沒人跟進,認領後會直接進入「線索」階段。
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
        <div className="card-soft p-5 border-l-4 border-l-rose-400">
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
        <section key={s} className="card-soft overflow-hidden">
          <header className="px-5 py-3.5 flex items-center gap-2 border-b border-stone-900/[0.06]">
            <span className={`w-2 h-2 rounded-full ${STAGE_STYLE[s]?.dot ?? 'bg-stone-300'}`} />
            <h3 className="text-sm font-bold text-stone-800">{s}</h3>
            <span className="text-xs text-stone-400">{stageGroups[s].length} 家</span>
          </header>
          <div className="divide-y divide-stone-900/[0.04]">
            {stageGroups[s].map((it) => {
              const overdue = isOverdue(it.nextFollowUpDate)
              const stale = staleDays(it.lastEdited)
              return (
                <div key={it.id} className="px-5 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 hover:bg-brand-50/50 transition-colors">
                  {/* 名稱與地區 */}
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-stone-800">{it.name}</span>
                      {it.devSource && (
                        <span className={`text-[11px] px-2 py-0.5 rounded-full ${STAGE_STYLE[it.devStage]?.badge ?? 'bg-stone-100 text-stone-500'}`}>
                          {it.devSource}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-stone-400 mt-0.5">
                      {[it.city, it.district, it.type].filter(Boolean).join(' · ')}
                      {stale > 14 && s !== '已成交' && s !== '流失' && (
                        <span className="ml-2 text-amber-500">⏳ 停滯 {stale} 天</span>
                      )}
                    </p>
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

                  {/* 階段推進 */}
                  <div className="shrink-0">
                    <select
                      className="select-soft text-xs !py-1.5"
                      value={it.devStage}
                      disabled={busyId === it.id}
                      onChange={(e) => patch(it.id, { devStage: e.target.value })}
                    >
                      {stages.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {items.length === 0 && (
        <div className="card-soft p-10 text-center text-sm text-stone-400">
          漏斗目前是空的——醫事監控匯入新開業機構後會自動入池為「線索」。
        </div>
      )}
    </div>
  )
}
