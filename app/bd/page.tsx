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
    { id: 'visits',    href: '/bd',                 label: '📋 客情紀錄' },
    { id: 'pipeline',  href: '/bd?tab=pipeline',    label: '🎯 開發漏斗' },
    { id: 'campaigns', href: '/bd?tab=campaigns',   label: '📇 追蹤名單' },
    { id: 'suggest',   href: '/bd?tab=suggest',     label: '🧭 拜訪建議' },
    { id: 'report',    href: '/bd?tab=report',      label: '📥 匯入' },
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
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TAB_ITEMS.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

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
