import { getServerSession } from 'next-auth'
import Link from 'next/link'
import { AppShell } from '@/components/AppShell'
import VisitsContent from '@/components/VisitsContent'
import DailyReportPanel from '@/components/DailyReportPanel'
import { LineImportContent } from '@/components/LineImportContent'
import PipelineContent from '@/components/PipelineContent'
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
  const role        = (session?.user as any)?.role        as string | undefined
  const accountType = (session?.user as any)?.accountType as string | undefined
  const isAdmin = role === 'admin' || accountType === '行政' || accountType === '中央管理'

  const tab = searchParams.tab === 'report'
    ? 'report'
    : searchParams.tab === 'pipeline'
      ? 'pipeline'
      : searchParams.tab === 'line-import' && isAdmin
        ? 'line-import'
        : 'visits'

  const TAB_ITEMS = [
    { id: 'visits',      href: '/bd',                   label: '📋 客情紀錄', adminOnly: false },
    { id: 'pipeline',    href: '/bd?tab=pipeline',      label: '🎯 開發漏斗', adminOnly: false },
    { id: 'report',      href: '/bd?tab=report',        label: '📤 業務日報', adminOnly: false },
    { id: 'line-import', href: '/bd?tab=line-import',   label: '📥 LINE 匯入', adminOnly: true },
  ] as const

  return (
    <AppShell
      title={tab === 'report' ? '業務日報' : tab === 'pipeline' ? '開發漏斗' : '業務開發・客情紀錄'}
      description={
        tab === 'report'
          ? '日報產生、LINE 推播，以及將業務日報批次匯入客情紀錄。'
          : tab === 'pipeline'
            ? '陌生開發管線：BAS 新開業自動入池，認領、推進階段、追蹤到成交。'
            : '記錄每日客戶拜訪情況，掌握各地區業務動態。'
      }
    >
      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {TAB_ITEMS.filter((t) => !t.adminOnly || isAdmin).map((t) => (
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
      ) : tab === 'report' ? (
        <DailyReportPanel isAdmin={isAdmin} />
      ) : (
        <LineImportContent />
      )}
    </AppShell>
  )
}
