'use client'

/**
 * 活動底下的「結案報告」分頁：一頁看完這場活動的成效。
 * 四個區塊（使用者 2026-11-11 選定）：參與成果、問卷與滿意度、費用、會後追蹤。
 * 每個數字下方都寫算法（lib/event-report.ts 檔頭有完整定義）；資料即時計算，沒有另外存一份。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { EventReport } from '@/lib/event-report'
import type { QuestionSummary } from '@/lib/event-forms-model'

const nt = (n: number) => `NT$ ${Math.round(n).toLocaleString('zh-TW')}`
const eyebrow = 'text-[11px] font-bold uppercase tracking-widest text-stone-400'

function Kpi({ label, value, note, tone = 'text-stone-800' }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div className="card-soft p-5">
      <p className="text-xs text-stone-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {note && <p className="mt-1.5 text-xs leading-5 text-stone-400">{note}</p>}
    </div>
  )
}
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-stone-800">{value}</p>
      {note && <p className="mt-1 text-xs leading-5 text-stone-400">{note}</p>}
    </div>
  )
}
function Bars({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  const total = rows.reduce((s, r) => s + r.count, 0)
  if (!total) return null
  return (
    <div>
      <p className={eyebrow}>{title}</p>
      <div className="mt-2 space-y-1.5">
        {rows.map((r) => {
          const pct = Math.round((r.count / total) * 100)
          return (
            <div key={r.label} className="flex items-center gap-3 text-xs">
              <span className="w-24 shrink-0 truncate text-stone-600" title={r.label}>{r.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} /></div>
              <span className="w-16 shrink-0 text-right tabular-nums text-stone-500">{r.count}（{pct}%）</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
function QuestionList({ summary }: { summary: QuestionSummary[] }) {
  const shown = summary.filter((q) => q.answered > 0)
  if (!shown.length) return null
  return (
    <div className="mt-4 space-y-4">
      {shown.map((q) => {
        const top = q.counts ? Object.entries(q.counts).sort((a, b) => b[1] - a[1]).filter(([, n]) => n > 0).slice(0, 3) : []
        return (
          <div key={q.id} className="text-sm">
            <p className="font-medium text-stone-700">{q.label}<span className="ml-2 text-xs font-normal text-stone-400">{q.answered} 人回答</span></p>
            {q.type === 'rating' && <p className="mt-0.5 text-stone-600">平均 <span className="font-semibold tabular-nums text-stone-800">{q.average}</span> 分（滿分 5）</p>}
            {q.type !== 'rating' && top.length > 0 && (
              <p className="mt-0.5 text-stone-600">{top.map(([k, n]) => `${k} ${n} 人（${Math.round((n / q.answered) * 100)}%）`).join('、')}</p>
            )}
            {q.texts && q.texts.length > 0 && (
              <ul className="mt-1.5 space-y-1 text-xs text-stone-600">{q.texts.map((t, i) => <li key={i} className="rounded-xl bg-cream-50 px-3 py-1.5">{t}</li>)}</ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function EventReportPanel({ eventId }: { eventId: string }) {
  const [r, setR] = useState<EventReport | null>(null)
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    fetch(`/api/events/${eventId}/report`).then(async (res) => {
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '報告載入失敗')
      setR(json)
    }).catch((e) => setError(e?.message ?? '報告載入失敗'))
  }, [eventId])

  if (error) return <div className="card-soft p-6 text-sm text-red-600">{error}</div>
  if (!r) return <div className="card-soft py-16 text-center text-sm text-stone-400">報告計算中…</div>

  const p = r.participation, c = r.cost, f = r.followUp
  const over = c.budget.budget > 0 && c.budget.spent > c.budget.budget
  const sat = r.forms.satisfaction, survey = r.forms.survey
  const followRate = f.started && p.matchedCustomers > 0 ? Math.round((f.visited / p.matchedCustomers) * 100) : null
  const list = showAll ? f.notVisitedList : f.notVisitedList.slice(0, 10)

  return (
    <div className="space-y-5">
      {/* 抬頭 */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={eyebrow}>結案報告</p>
          <p className="mt-1 text-sm text-stone-500">
            {r.event.date}{r.event.endDate && r.event.endDate !== r.event.date ? ` — ${r.event.endDate}` : ''}{r.event.location ? `・${r.event.location}` : ''}
            ・資料時間 {new Date(r.generatedAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
          </p>
        </div>
        <button onClick={() => window.print()} className="min-h-11 rounded-full border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 transition-all hover:border-stone-300 hover:bg-stone-50 active:scale-95 print:hidden">
          列印／存成 PDF
        </button>
      </div>

      {/* 四個重點數字 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="報名人數" value={p.people.toLocaleString()} note={`${p.registrations} 筆報名${p.attendanceMarked ? `，到場 ${p.attended} 人（出席率 ${p.attendanceRate}%）` : '，尚未標記到場'}`} />
        <Kpi label="首次接觸客戶" value={`${p.firstContactCustomers} 家`} note={`配對到 ${p.matchedCustomers} 家客戶，其中 ${p.existingCustomers} 家是既有往來`} tone="text-brand-700" />
        <Kpi label="滿意度" value={sat?.average != null ? `${sat.average} / 5` : '—'} note={sat ? (sat.average != null ? `${sat.responses} 份回覆，${sat.ratingQuestions} 題評分題的平均` : `${sat.responses} 份回覆，沒有評分題`) : '還沒建立滿意度調查'} />
        <Kpi label={over ? '超支' : '已核准支出'} value={c.budget.spent || c.budget.budget ? nt(over ? c.budget.spent - c.budget.budget : c.budget.spent) : '—'}
          note={c.budget.budget ? `預算 ${nt(c.budget.budget)}${c.perHead != null ? `，每位 ${nt(c.perHead)}` : ''}` : '還沒編預算'} tone={over ? 'text-red-600' : 'text-stone-800'} />
      </div>

      {/* 參與成果 */}
      <section className="card-soft p-6">
        <h3 className="font-semibold text-stone-900">參與成果</h3>
        <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="報名" value={`${p.registrations} 筆／${p.people} 人`} note={p.cancelled ? `另有 ${p.cancelled} 筆取消，不計入` : '不含已取消'} />
          <Stat label="到場" value={p.attendanceMarked ? `${p.attended} 人` : '—'} note={p.attendanceMarked ? `出席率 ${p.attendanceRate}%（到場人數 ÷ 報名人數）` : '報名名單裡還沒有人被標成「已到場」'} />
          <Stat label="既有往來／首次接觸" value={`${p.existingCustomers}／${p.firstContactCustomers} 家`} note="既有往來＝活動前已有客情紀錄，或標記為公司既有客戶" />
          <Stat label="未配對" value={`${p.unmatched} 筆`} note="報名資料還沒對到客戶主檔，不會進業務的拜訪建議" />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Bars title="單位類型" rows={p.byUnitType} />
          <Bars title="縣市" rows={p.byCity} />
          <Bars title="報名來源" rows={p.bySource} />
        </div>
      </section>

      {/* 問卷與滿意度 */}
      <section className="card-soft p-6">
        <h3 className="font-semibold text-stone-900">問卷與滿意度</h3>
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <p className={eyebrow}>活動問卷</p>
            {survey ? (
              <>
                <div className="mt-2 grid grid-cols-2 gap-5">
                  <Stat label="收到" value={`${survey.responses} 份`} note={p.people ? `約占報名人數 ${Math.round((survey.responses / p.people) * 100)}%` : undefined} />
                  <Stat label="贈品發出" value={`${survey.giftClaimed} 份`} note={survey.gift || undefined} />
                </div>
                <QuestionList summary={survey.summary} />
              </>
            ) : <p className="mt-2 text-sm text-stone-400">這場活動沒有建立活動問卷。</p>}
          </div>
          <div>
            <p className={eyebrow}>滿意度調查</p>
            {sat ? (
              <>
                <div className="mt-2 grid grid-cols-2 gap-5">
                  <Stat label="收到" value={`${sat.responses} 份`} note={p.people ? `約占報名人數 ${Math.round((sat.responses / p.people) * 100)}%` : undefined} />
                  <Stat label="整體平均" value={sat.average != null ? `${sat.average} / 5` : '—'} note={sat.average != null ? '所有 1–5 分題平均分數的平均' : '沒有評分題或還沒人填'} />
                </div>
                <QuestionList summary={sat.summary} />
              </>
            ) : <p className="mt-2 text-sm text-stone-400">這場活動沒有建立滿意度調查。</p>}
          </div>
        </div>
      </section>

      {/* 費用 */}
      <section className="card-soft p-6">
        <h3 className="font-semibold text-stone-900">費用</h3>
        <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="預算" value={c.budget.budget ? nt(c.budget.budget) : '—'} />
          <Stat label="已核准支出" value={nt(c.budget.spent)} note={`已核准＋已付款${c.budget.pending ? `；另有待審核 ${nt(c.budget.pending)}` : ''}`} />
          <Stat label={over ? '超支' : '剩餘'} value={c.budget.budget ? nt(Math.abs(c.budget.remaining)) : '—'} note="預算 − 已核准支出" />
          <Stat label="每位成本" value={c.perHead != null ? nt(c.perHead) : '—'} note={c.perHead != null ? `已核准支出 ÷ ${c.perHeadBasis}${c.perHeadBasis === '報名人數' ? '（還沒有人被標成已到場）' : ''}` : '還沒有已核准的支出'} />
        </div>
        {(c.feeCollected > 0 || c.feeOutstanding > 0) && (
          <div className="mt-5 grid grid-cols-2 gap-5 border-t border-stone-900/[0.06] pt-5 sm:grid-cols-4">
            <Stat label="報名費已收" value={nt(c.feeCollected)} note="付款狀態為「已付款」的應繳金額" />
            <Stat label="報名費未收" value={nt(c.feeOutstanding)} note="付款狀態為「未付款」" />
            <Stat label="收支相抵" value={nt(c.feeCollected - c.budget.spent)} note="報名費已收 − 已核准支出" />
          </div>
        )}
        {c.budget.byCategory.length > 0 && (
          <div className="mt-5 space-y-2 border-t border-stone-900/[0.06] pt-5">
            <p className={eyebrow}>各類別</p>
            {c.budget.byCategory.map((x) => {
              const pct = x.budget > 0 ? Math.min(Math.round((x.spent / x.budget) * 100), 100) : x.spent > 0 ? 100 : 0
              const catOver = x.spent > x.budget
              return (
                <div key={x.category} className="flex items-center gap-3 text-xs">
                  <span className="w-20 shrink-0 text-stone-600">{x.category}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100"><div className={`h-full rounded-full ${catOver ? 'bg-red-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} /></div>
                  <span className={`w-44 shrink-0 text-right tabular-nums ${catOver ? 'text-red-600' : 'text-stone-500'}`}>{nt(x.spent)} / {nt(x.budget)}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 會後追蹤 */}
      <section className="card-soft p-6">
        <h3 className="font-semibold text-stone-900">會後追蹤</h3>
        {!f.started ? (
          <p className="mt-3 text-sm text-stone-400">活動還沒結束。結束後這裡會開始計算 {f.days} 天內拜訪了幾家參加的客戶，以及他們之後的報價與訂單。</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-stone-400">追蹤期：活動結束日起 {f.days} 天（到 {f.windowEnd}）{f.windowOpen ? '，還在追蹤期內' : '，已結束'}。只計算已配對到客戶主檔的 {p.matchedCustomers} 家。</p>
            {f.visitDataGap && <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700">系統只有 2025 年 12 月以後的客情紀錄。這場活動在那之前結束，「已拜訪／還沒拜訪」無法判斷，下面不列。</p>}
            <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Stat label="已拜訪" value={f.visitDataGap ? '—' : `${f.visited} 家`} note={f.visitDataGap ? '沒有當時的客情紀錄' : followRate != null ? `占配對客戶 ${followRate}%；追蹤期內有客情紀錄` : undefined} />
              <Stat label="還沒拜訪" value={f.visitDataGap ? '—' : `${f.notVisited} 家`} note={f.visitDataGap ? '沒有當時的客情紀錄' : '追蹤期內沒有任何客情紀錄'} />
              <Stat label="會後報價" value={`${f.quotes} 張`} note={f.quoteAmount != null ? `合計 ${nt(f.quoteAmount)}` : '活動結束後，這些客戶新建的報價單'} />
              <Stat label="會後訂單" value={`${f.orders} 張`} note={f.orderAmount != null ? `合計 ${nt(f.orderAmount)}` : '活動結束後，這些客戶新建的訂貨單（不含草稿、已取消）'} />
            </div>
            {!f.visitDataGap && f.notVisitedList.length > 0 && (
              <div className="mt-5 border-t border-stone-900/[0.06] pt-5">
                <p className={eyebrow}>還沒拜訪的客戶</p>
                <ul className="mt-2 divide-y divide-stone-900/[0.06]">
                  {list.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <Link href={`/customers/${x.id}`} className="text-stone-800 transition-colors hover:text-brand-700">{x.name}<span className="ml-2 text-xs text-stone-400">{x.area}</span></Link>
                      <span className="text-xs text-stone-500">{x.owner}</span>
                    </li>
                  ))}
                </ul>
                {f.notVisitedList.length > 10 && (
                  <button onClick={() => setShowAll((v) => !v)} className="mt-2 rounded-full px-3 py-1.5 text-xs font-medium text-brand-700 transition-all hover:bg-brand-50 active:scale-95 print:hidden">
                    {showAll ? '收起' : `顯示全部 ${f.notVisitedList.length} 家`}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
