import { getServerSession } from 'next-auth'
import Link from 'next/link'
import { AppShell } from '@/components/AppShell'
import VisitsContent from '@/components/VisitsContent'
import DailyReportPanel from '@/components/DailyReportPanel'
import PipelineContent from '@/components/PipelineContent'
import CampaignsContent from '@/components/CampaignsContent'
import VisitSuggestionsContent from './VisitSuggestionsContent'
import { requireViewPermission } from '@/lib/permissions'
import { authOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function BdPage({
  searchParams,
}: {
  searchParams: { tab?: string }
}) {
  await requireViewPermission('bd')

  const session = await getServerSession(authOptions)

  const tab = searchParams.tab === 'report'
    ? 'report'
    : searchParams.tab === 'pipeline'
      ? 'pipeline'
      : searchParams.tab === 'campaigns'
        ? 'campaigns'
        : searchParams.tab === 'suggest'
          ? 'suggest'
          : 'visits'

  const TAB_ITEMS = [
    { id: 'pipeline',  href: '/bd?tab=pipeline',    label: '開發漏斗', hint: '客戶在哪個階段' },
    { id: 'suggest',   href: '/bd?tab=suggest',     label: '拜訪建議', hint: '下一步該找誰' },
    { id: 'visits',    href: '/bd',                 label: '客情紀錄', hint: '已完成哪些互動' },
    { id: 'campaigns', href: '/bd?tab=campaigns',   label: '追蹤名單', hint: '批次推進一群客戶' },
    { id: 'report',    href: '/bd?tab=report',      label: '紀錄匯入', hint: 'LINE 與日報轉紀錄' },
  ] as const

  return (
    <AppShell
      title={tab === 'report' ? '匯入' : tab === 'pipeline' ? '開發漏斗' : tab === 'campaigns' ? '追蹤名單' : tab === 'suggest' ? '拜訪建議' : '業務開發・客情紀錄'}
      description={
        tab === 'report'
          ? '將業務日報文字或 LINE 聊天記錄批次匯入客情紀錄。'
          : tab === 'pipeline'
            ? '陌生開發管線：BAS 新開業自動入池，認領、推進階段、追蹤到成交。'
            : tab === 'campaigns'
              ? '商品潛在購買清單派工追蹤：匯入名單、業務逐一聯絡、訂單自動判定成交。'
              : tab === 'suggest'
                ? '出門前的彈藥清單：選區域,系統依商品興趣、例行維繫、陌生開發整理值得跑的客戶與理由。'
                : '記錄每日客戶拜訪情況，掌握各地區業務動態。'
      }
    >
      {/* Sub-tab bar */}
      <nav className="card-soft mb-6 flex gap-1 overflow-x-auto p-1.5 [&::-webkit-scrollbar]:hidden" aria-label="業務開發功能">
        {TAB_ITEMS.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`min-w-max rounded-full px-4 py-2.5 text-left transition-all active:scale-95 ${
              tab === t.id
                ? 'bg-brand-500 text-white shadow-md shadow-brand-500/20'
                : 'text-stone-500 hover:bg-brand-50/60 hover:text-brand-700'
            }`}
          >
            <span className="block text-sm font-semibold">{t.label}</span>
            <span className={`hidden text-[11px] sm:block ${tab === t.id ? 'text-white/75' : 'text-stone-400'}`}>{t.hint}</span>
          </Link>
        ))}
      </nav>

      {tab === 'visits' ? (
        <VisitsContent />
      ) : tab === 'pipeline' ? (
        <PipelineContent currentUser={session?.user?.name ?? undefined} />
      ) : tab === 'campaigns' ? (
        <CampaignsContent />
      ) : tab === 'suggest' ? (
        <VisitSuggestionsContent currentUser={session?.user?.name ?? undefined} />
      ) : (
        <DailyReportPanel />
      )}
    </AppShell>
  )
}
