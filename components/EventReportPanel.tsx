'use client'

/**
 * 活動底下的「結案報告」分頁：一頁看完這場活動的成效。
 * 2026-11-14 改成「總覽＋個別主題」：總覽一張張卡片點了進主題；主題＝參與成果、問卷與滿意度、業績、費用、會後追蹤。
 * 列印時全部主題依序印出。
 * 每個數字下方都寫算法（lib/event-report.ts 檔頭有完整定義）；資料即時計算，沒有另外存一份。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { EventReport } from '@/lib/event-report'
import type { QuestionSummary } from '@/lib/event-forms-model'

const nt = (n: number) => `NT$ ${Math.round(n).toLocaleString('zh-TW')}`
const eyebrow = 'text-[11px] font-bold uppercase tracking-widest text-stone-400'

type Tab = 'overview' | 'participation' | 'forms' | 'sales' | 'cost' | 'follow'

function Kpi({ label, value, note, tone = 'text-stone-800', onClick, active, action = '點開名單' }: { label: string; value: string; note?: string; tone?: string; onClick?: () => void; active?: boolean; action?: string }) {
  const inner = (
    <>
      <p className="text-xs text-stone-500">{label}{onClick && <span className="ml-1 text-brand-600">{action}</span>}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${tone}`}>{value}</p>
      {note && <p className="mt-1.5 text-xs leading-5 text-stone-400">{note}</p>}
    </>
  )
  return onClick
    ? <button type="button" onClick={onClick} aria-expanded={active} className={`card-soft p-5 text-left transition-all hover:ring-2 hover:ring-brand-200 active:scale-[0.99] ${active ? 'ring-2 ring-brand-300' : ''}`}>{inner}</button>
    : <div className="card-soft p-5">{inner}</div>
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
  const [showFirst, setShowFirst] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  useEffect(() => {   // Esc 關閉名單視窗
    if (!showFirst) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowFirst(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showFirst])

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
  const sec = r.sections ?? { registration: true, survey: true, satisfaction: true }
  const followRate = f.started && p.matchedCustomers > 0 ? Math.round((f.visited / p.matchedCustomers) * 100) : null
  const list = showAll ? f.notVisitedList : f.notVisitedList.slice(0, 10)
  const s = r.sales
  const formsLabel = sec.survey && sec.satisfaction ? '問卷與滿意度' : sec.survey ? '活動問卷' : '滿意度調查'
  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: '總覽' },
    { key: 'participation', label: '參與成果' },
    ...((sec.survey || sec.satisfaction) ? [{ key: 'forms' as Tab, label: formsLabel }] : []),
    { key: 'sales', label: '業績' },
    { key: 'cost', label: '費用' },
    { key: 'follow', label: '會後追蹤' },
  ]
  // 沒選到的主題畫面上隱藏、列印時照印
  const show = (k: Tab) => (tab === k ? '' : 'hidden print:block')
  const go = (k: Tab) => () => { setTab(k); window.scrollTo({ top: 0, behavior: 'smooth' }) }

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

      {/* 主題切換 */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 print:hidden" role="tablist" aria-label="結案報告主題">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all active:scale-95 ${tab === t.key ? 'bg-brand-500 text-white shadow-sm' : 'bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 總覽：每張卡片是一個主題的重點，點了進該主題 */}
      <div className={`${show('overview')} space-y-3`}>
      <p className={`${eyebrow} hidden print:block`}>總覽</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {sec.registration
          ? <Kpi label="報名人數" value={p.people.toLocaleString()} note={`${p.registrations} 筆報名${p.attendanceMarked ? `，到場 ${p.attended} 人（出席率 ${p.attendanceRate}%）` : '，尚未標記到場'}`} onClick={go('participation')} action="看參與成果" />
          : <Kpi label="問卷填寫" value={`${p.formRespondents} 人`} note={survey ? `活動問卷 ${survey.responses} 份，贈品發出 ${survey.giftClaimed} 份` : '有留個人資料的問卷回覆'} onClick={go('participation')} action="看參與成果" />}
        <Kpi label="首次接觸客戶" value={`${p.firstContactCustomers} 家`} note={`${sec.registration ? '報名與問卷' : '問卷'}共配對到 ${p.matchedCustomers} 家客戶${sec.registration && p.fromFormsOnly ? `（${p.fromFormsOnly} 家只填了問卷）` : ''}，其中 ${p.existingCustomers} 家是既有往來`} tone="text-brand-700"
          onClick={p.firstContactCustomers ? () => setShowFirst((v) => !v) : undefined} active={showFirst} />
        {sec.satisfaction
          ? <Kpi label="滿意度" value={sat?.average != null ? `${sat.average} / 5` : '—'} note={sat ? (sat.average != null ? `${sat.responses} 份回覆，${sat.ratingQuestions} 題評分題的平均` : `${sat.responses} 份回覆，沒有評分題`) : '還沒建立滿意度調查'} onClick={go('forms')} action="看詳細" />
          : sec.survey && sec.registration   // 沒有報名時第一張卡已是問卷填寫，不重複
            ? <Kpi label="活動問卷" value={survey ? `${survey.responses} 份` : '—'} note={survey ? `贈品發出 ${survey.giftClaimed} 份` : '還沒建立活動問卷'} onClick={go('forms')} action="看詳細" />
            : <Kpi label="既有往來客戶" value={`${p.existingCustomers} 家`} note="活動前已有客情紀錄，或標記為公司既有客戶" onClick={go('participation')} action="看參與成果" />}
        <Kpi label="活動業績" value={s.amount != null ? nt(s.amount) : `${s.orders} 張`}
          note={`促銷訂單 ${s.promoOrders} 張、參加客戶訂單 ${s.attendeeOrders} 張${s.roi != null ? `；投報 ${s.roi} 倍` : ''}${!s.promotions.length ? '；這場活動還沒有促銷' : ''}`}
          tone="text-brand-700" onClick={go('sales')} action="看業績" />
        <Kpi label={over ? '超支' : '已核准支出'} value={c.budget.spent || c.budget.budget ? nt(over ? c.budget.spent - c.budget.budget : c.budget.spent) : '—'}
          note={c.budget.budget ? `預算 ${nt(c.budget.budget)}${c.perHead != null ? `，每位 ${nt(c.perHead)}` : ''}` : '還沒編預算'} tone={over ? 'text-red-600' : 'text-stone-800'} onClick={go('cost')} action="看費用" />
        <Kpi label="會後已拜訪" value={!f.started ? '—' : f.visitDataGap ? '—' : `${f.visited} 家`}
          note={!f.started ? '活動結束後開始計算' : f.visitDataGap ? '沒有當時的客情紀錄' : `還沒拜訪 ${f.notVisited} 家；追蹤期到 ${f.windowEnd}`} onClick={go('follow')} action="看追蹤" />
      </div>
      </div>

      {showFirst && p.firstContactList.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/30 sm:items-center sm:p-4 print:hidden" onClick={() => setShowFirst(false)} role="dialog" aria-modal="true" aria-label="首次接觸客戶名單">
        <div className="card-soft flex max-h-[85vh] w-full max-w-2xl flex-col rounded-b-none p-5 sm:rounded-b-3xl sm:p-6" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-stone-900">首次接觸客戶 <span className="text-sm font-normal text-stone-400">{p.firstContactList.length} 家</span></h3>
            <button onClick={() => setShowFirst(false)} className="rounded-full bg-stone-100 px-4 py-1.5 text-sm font-semibold text-stone-600 transition-all hover:bg-stone-200 active:scale-95">關閉</button>
          </div>
          <p className="mt-1 text-xs text-stone-400">活動前沒有客情紀錄、也不是公司既有客戶；依負責業務排序。點客戶進客戶頁。</p>
          <div className="mt-4 grid gap-2 overflow-y-auto sm:grid-cols-2">
            {p.firstContactList.map((c) => (
              <Link key={c.id} href={`/customers/${c.id}`} className="flex items-start justify-between gap-3 rounded-2xl border border-stone-900/[0.06] p-3 transition-colors hover:bg-brand-50/40">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-stone-800">{c.name}</p>
                  <p className="text-xs text-stone-400">{[c.area, c.type].filter(Boolean).join('・')}</p>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <p className="text-stone-600">{c.owner}</p>
                  <p className="text-stone-400">來自{c.source}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
        </div>
      )}

      {/* 參與成果 */}
      <section className={`card-soft p-6 ${show('participation')}`}>
        <h3 className="font-semibold text-stone-900">參與成果</h3>
        <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
          {sec.registration ? <>
          <Stat label="報名" value={`${p.registrations} 筆／${p.people} 人`} note={p.cancelled ? `另有 ${p.cancelled} 筆取消，不計入` : '不含已取消'} />
          <Stat label="到場" value={p.attendanceMarked ? `${p.attended} 人` : '—'} note={p.attendanceMarked ? `出席率 ${p.attendanceRate}%（到場人數 ÷ 報名人數）` : '報名名單裡還沒有人被標成「已到場」'} />
          </> : <Stat label="問卷填寫" value={`${p.formRespondents} 人`} note="有留個人資料的問卷回覆" />}
          <Stat label="既有往來／首次接觸" value={`${p.existingCustomers}／${p.firstContactCustomers} 家`} note="客戶來自報名名單與問卷回覆的客戶配對（同一家只算一次）；既有往來＝活動前已有客情紀錄，或標記為公司既有客戶" />
          <Stat label="未配對" value={`${p.unmatched} 筆`} note="報名或問卷回覆還沒對到客戶主檔，不會進業務的拜訪建議；可在報名名單、問卷回覆名單的「客戶配對」補配" />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Bars title="單位類型" rows={p.byUnitType} />
          <Bars title="縣市" rows={p.byCity} />
          {sec.registration && <Bars title="報名來源" rows={p.bySource} />}
        </div>
      </section>

      {/* 問卷與滿意度（依活動類型只顯示用得到的） */}
      {(sec.survey || sec.satisfaction) && <section className={`card-soft p-6 ${show('forms')}`}>
        <h3 className="font-semibold text-stone-900">{formsLabel}</h3>
        <div className={`mt-4 grid gap-6 ${sec.survey && sec.satisfaction ? 'lg:grid-cols-2' : ''}`}>
          {sec.survey && <div>
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
          </div>}
          {sec.satisfaction && <div>
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
          </div>}
        </div>
      </section>}

      {/* 業績 */}
      <section className={`card-soft p-6 ${show('sales')}`}>
        <h3 className="font-semibold text-stone-900">業績</h3>
        <p className="mt-1 text-xs leading-5 text-stone-400">訂貨單在訂貨頁選了這場活動的促銷，就會自動算進來；配對到的參加客戶在活動開始日以後下的其他訂單也算。都不含草稿、已取消。{s.amount == null ? '金額只有中央管理看得到。' : ''}</p>
        {s.promotions.length === 0
          ? <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700">這場活動底下還沒有促銷。到「促銷」分頁新增後，業務在訂貨單選這個促銷，訂單就會算進這場活動。</p>
          : <div className="mt-3 flex flex-wrap gap-2">
              {s.promotions.map((x) => (
                <span key={x.id} className="rounded-full bg-cream-50 px-3 py-1 text-xs text-stone-600 ring-1 ring-stone-900/[0.06]">
                  {x.name}<span className="ml-1.5 text-stone-400">{x.startDate ? `${x.startDate}～${x.endDate || ''}` : '未設日期'}・品項 {x.items}（已確認 {x.confirmedItems}）</span>
                </span>
              ))}
            </div>}
        <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="活動業績" value={s.amount != null ? nt(s.amount) : `${s.orders} 張`} note={`${s.orders} 張訂單、${s.customers} 家客戶`} />
          <Stat label="促銷訂單" value={s.promoAmount != null ? nt(s.promoAmount) : `${s.promoOrders} 張`} note={`${s.promoOrders} 張，訂貨單綁了本活動促銷`} />
          <Stat label="參加客戶訂單" value={s.attendeeAmount != null ? nt(s.attendeeAmount) : `${s.attendeeOrders} 張`} note={`${s.attendeeOrders} 張，配對客戶活動後下的其他訂單`} />
          <Stat label="投報倍數" value={s.roi != null ? `${s.roi} 倍` : '—'} note={s.roi != null ? '活動業績 ÷ 已核准支出' : c.budget.spent > 0 ? '只有中央管理看得到' : '還沒有已核准的支出'} />
        </div>
        {s.drafts > 0 && <p className="mt-3 text-xs text-stone-400">另有 {s.drafts} 張草稿還沒送出，確認後才會算進來。</p>}
        {(s.bySalesperson.length > 0 || s.topProducts.length > 0) && (
          <div className="mt-6 grid gap-6 border-t border-stone-900/[0.06] pt-5 lg:grid-cols-2">
            {s.bySalesperson.length > 0 && <div>
              <p className={eyebrow}>各業務</p>
              <ul className="mt-2 divide-y divide-stone-900/[0.06] text-sm">
                {s.bySalesperson.map((x) => (
                  <li key={x.name} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-stone-700">{x.name}</span>
                    <span className="tabular-nums text-stone-500">{x.orders} 張{x.amount != null ? `・${nt(x.amount)}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>}
            {s.topProducts.length > 0 && <div>
              <p className={eyebrow}>促銷品項排行</p>
              <ul className="mt-2 divide-y divide-stone-900/[0.06] text-sm">
                {s.topProducts.map((x, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate text-stone-700" title={x.name}>{x.name}<span className="ml-1.5 text-xs text-stone-400">{x.brand}</span></span>
                    <span className="shrink-0 tabular-nums text-stone-500">{x.qty} 件{x.amount != null ? `・${nt(x.amount)}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>}
          </div>
        )}
        {s.list.length > 0 && (
          <div className="mt-6 border-t border-stone-900/[0.06] pt-5">
            <p className={eyebrow}>訂單</p>
            <ul className="mt-2 divide-y divide-stone-900/[0.06]">
              {s.list.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <Link href={`/orders/${o.id}`} className="min-w-0 text-stone-800 transition-colors hover:text-brand-700">
                    {o.customerName || '（未填客戶）'}<span className="ml-2 text-xs text-stone-400">{o.number}・{o.date}・{o.salesperson}</span>
                  </Link>
                  <span className="flex items-center gap-2 text-xs">
                    <span className={`rounded-full px-2 py-0.5 ${o.kind === '促銷' ? 'bg-brand-50 text-brand-700' : 'bg-stone-100 text-stone-600'}`}>{o.kind === '促銷' ? o.promotion || '促銷' : '參加客戶'}</span>
                    <span className="text-stone-400">{o.status}</span>
                    {o.amount != null && <span className="tabular-nums text-stone-700">{nt(o.amount)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {s.orders === 0 && s.promotions.length > 0 && <p className="mt-4 text-sm text-stone-400">還沒有訂單綁這場活動的促銷。</p>}
      </section>

      {/* 費用 */}
      <section className={`card-soft p-6 ${show('cost')}`}>
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
      <section className={`card-soft p-6 ${show('follow')}`}>
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
