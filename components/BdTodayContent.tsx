import Link from 'next/link'
import { ArrowRight, ClipboardList, FileUp, ListTodo, MapPinned, Target, UsersRound } from 'lucide-react'
import type { TodayDashboardData, TodayWorkItem } from '@/lib/dashboard-today'

const kindLabel: Record<TodayWorkItem['kind'], string> = {
  visit: '今日拜訪',
  'follow-up': '待追蹤',
  quote: '報價',
  ticket: '服務',
}

export default function BdTodayContent({ data }: { data: TodayDashboardData }) {
  const developmentItems = data.workItems.filter((item) => item.kind === 'visit' || item.kind === 'follow-up')

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,.75fr)]" aria-labelledby="today-work-title">
        <div className="card-soft overflow-hidden p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">今天先做這些</p>
              <h2 id="today-work-title" className="mt-2 text-2xl font-bold tracking-tight text-stone-800">
                {developmentItems.length > 0 ? `有 ${developmentItems.length} 位客戶需要處理` : '今天沒有到期的追蹤'}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-stone-500">
                先完成到期追蹤，再補上今天的客情紀錄。完成一件，下一步就會更清楚。
              </p>
            </div>
            <Link
              href="/bd?tab=visits&action=new"
              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95"
            >
              <ClipboardList className="size-4" /> 新增客情紀錄
            </Link>
          </div>

          <div className="mt-7 space-y-3">
            {developmentItems.length > 0 ? developmentItems.map((item, index) => (
              <div key={`${item.kind}-${item.id}`} className="flex flex-col gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-900/[0.05] sm:flex-row sm:items-center">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-stone-800">{item.customer}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.overdue ? 'bg-rose-50 text-rose-600' : 'bg-cream-100 text-brand-700'}`}>
                      {item.overdue ? '已逾期' : kindLabel[item.kind]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-stone-500">{item.action}</p>
                  <p className={`mt-1 text-xs ${item.overdue ? 'font-semibold text-rose-600' : 'text-stone-400'}`}>{item.time}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Link href={`/customers?q=${encodeURIComponent(item.customer)}`} className="rounded-full bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-600 transition-all hover:bg-stone-100 active:scale-95">
                    查看客戶
                  </Link>
                  <Link href={`/bd?tab=visits&action=new&customer=${encodeURIComponent(item.customer)}`} className="rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-brand-600 active:scale-95">
                    記錄結果
                  </Link>
                </div>
              </div>
            )) : (
              <div className="rounded-2xl bg-white px-5 py-8 text-center ring-1 ring-stone-900/[0.05]">
                <ListTodo className="mx-auto size-8 text-brand-500" />
                <p className="mt-3 font-semibold text-stone-700">目前沒有到期工作</p>
                <p className="mt-1 text-sm text-stone-400">可新增今天的客情，或查看拜訪建議尋找下一位客戶。</p>
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4" aria-label="今日摘要與快速操作">
          <div className="card-soft p-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">今日摘要</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Link href="/bd?tab=visits" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-900/[0.05] transition-all hover:-translate-y-0.5 active:scale-95">
                <span className="text-2xl font-bold text-stone-800">{data.counts.visits}</span>
                <span className="mt-1 block text-xs text-stone-500">今日紀錄</span>
              </Link>
              <Link href="/bd?tab=visits" className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-900/[0.05] transition-all hover:-translate-y-0.5 active:scale-95">
                <span className="text-2xl font-bold text-stone-800">{data.counts.followUps}</span>
                <span className="mt-1 block text-xs text-stone-500">待追蹤</span>
              </Link>
            </div>
          </div>

          <div className="card-soft p-4">
            <Link href="/bd?tab=report" className="flex min-h-14 items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-brand-50/50 active:scale-[0.99]">
              <span className="flex size-10 items-center justify-center rounded-full bg-brand-50 text-brand-700"><FileUp className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-stone-700">匯入紀錄</span><span className="block text-xs text-stone-400">LINE 或業務日報</span></span>
              <ArrowRight className="size-4 text-stone-300" />
            </Link>
            <Link href="/bd?tab=pipeline" className="flex min-h-14 items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-brand-50/50 active:scale-[0.99]">
              <span className="flex size-10 items-center justify-center rounded-full bg-cream-100 text-brand-700"><Target className="size-4" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-stone-700">查看客戶跟進</span><span className="block text-xs text-stone-400">先處理逾期與待聯絡客戶</span></span>
              <ArrowRight className="size-4 text-stone-300" />
            </Link>
          </div>
        </aside>
      </section>

      <details className="card-soft group overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-brand-50/40 sm:px-6">
          <span>
            <span className="block text-sm font-bold text-stone-700">進階工具</span>
            <span className="mt-0.5 block text-xs text-stone-400">需要安排陌生開發或批次追蹤時再使用</span>
          </span>
          <span className="rounded-full bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-500 group-open:bg-brand-50 group-open:text-brand-700">展開</span>
        </summary>
        <div className="grid gap-3 border-t border-stone-900/[0.06] p-4 sm:grid-cols-2 sm:p-6">
          <Link href="/bd?tab=suggest" className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-900/[0.05] transition-all hover:-translate-y-0.5 active:scale-[0.99]">
            <MapPinned className="size-5 text-brand-600" />
            <span className="flex-1"><span className="block text-sm font-bold text-stone-700">拜訪建議</span><span className="text-xs text-stone-400">依區域整理值得拜訪的客戶</span></span>
            <ArrowRight className="size-4 text-stone-300" />
          </Link>
          <Link href="/bd?tab=campaigns" className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-900/[0.05] transition-all hover:-translate-y-0.5 active:scale-[0.99]">
            <UsersRound className="size-5 text-brand-600" />
            <span className="flex-1"><span className="block text-sm font-bold text-stone-700">追蹤名單</span><span className="text-xs text-stone-400">批次推進一群客戶</span></span>
            <ArrowRight className="size-4 text-stone-300" />
          </Link>
        </div>
      </details>
    </div>
  )
}
