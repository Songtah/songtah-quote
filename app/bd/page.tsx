import { getServerSession } from 'next-auth'
import Link from 'next/link'
import { AppShell } from '@/components/AppShell'
import VisitsContent from '@/components/VisitsContent'
import DailyReportPanel from '@/components/DailyReportPanel'
import PipelineContent from '@/components/PipelineContent'
import CampaignsContent from '@/components/CampaignsContent'
import VisitSuggestionsContent from './VisitSuggestionsContent'
import BdTodayContent from '@/components/BdTodayContent'
import { requireViewPermission } from '@/lib/permissions'
import { authOptions } from '@/lib/auth'
import { getBdTodayDashboard } from '@/lib/dashboard-today'

export const dynamic = 'force-dynamic'

export default async function BdPage({
  searchParams,
}: {
  searchParams: { tab?: string; action?: string; customer?: string }
}) {
  await requireViewPermission('bd')

  const session = await getServerSession(authOptions)
  const sessionUser = session?.user as any
  const canImportForOthers = sessionUser?.role === 'admin' || sessionUser?.accountType === '中央管理'

  const tab = searchParams.tab === 'report'
    ? 'report'
    : searchParams.tab === 'pipeline'
      ? 'pipeline'
      : searchParams.tab === 'campaigns'
        ? 'campaigns'
        : searchParams.tab === 'suggest'
          ? 'suggest'
          : searchParams.tab === 'visits'
            ? 'visits'
            : 'today'

  const todayData = tab === 'today'
    ? await getBdTodayDashboard(session?.user?.name ?? '', canImportForOthers)
    : null

  const TAB_ITEMS = [
    { id: 'today',    href: '/bd',              label: '今日工作', hint: '先處理最重要的客戶' },
    { id: 'visits',   href: '/bd?tab=visits',   label: '客情紀錄', hint: '查看與新增互動' },
    { id: 'report',   href: '/bd?tab=report',   label: '紀錄匯入', hint: 'LINE 與日報轉紀錄' },
    { id: 'pipeline', href: '/bd?tab=pipeline', label: '客戶跟進', hint: '看下一步與期限' },
  ] as const

  const isLegacyTool = tab === 'campaigns' || tab === 'suggest'

  return (
    <AppShell
      title={tab === 'report' ? '紀錄匯入' : tab === 'pipeline' ? '客戶跟進' : tab === 'campaigns' ? '追蹤名單' : tab === 'suggest' ? '拜訪建議' : tab === 'visits' ? '客情紀錄' : '業務開發'}
      description={
        tab === 'report'
          ? '將業務日報文字或 LINE 聊天記錄批次匯入客情紀錄。'
          : tab === 'pipeline'
            ? '先看每位客戶的下一步與處理期限；新增客情、試用或報價後，狀態會自動前進。'
            : tab === 'campaigns'
              ? '商品潛在購買清單派工追蹤：匯入名單、業務逐一聯絡、訂單自動判定成交。'
              : tab === 'suggest'
                ? '出門前的彈藥清單：選區域,系統依商品興趣、例行維繫、陌生開發整理值得跑的客戶與理由。'
              : tab === 'visits'
                ? '記錄每次客戶互動，留下明確的下一步。'
                : '先看今天該處理誰，再記錄結果或安排下一步。'
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

      {isLegacyTool && (
        <div className="mb-5 flex flex-col gap-3 rounded-2xl bg-cream-100/70 px-4 py-3 text-sm text-stone-600 sm:flex-row sm:items-center sm:justify-between">
          <span>這是低頻進階工具，所有既有功能與網址都保留。</span>
          <Link href="/bd" className="shrink-0 font-semibold text-brand-700 hover:text-brand-800">返回今日工作</Link>
        </div>
      )}

      {tab === 'today' && todayData ? (
        <BdTodayContent data={todayData} />
      ) : tab === 'visits' ? (
        <VisitsContent
          initialOpenCreate={searchParams.action === 'new'}
          initialCustomerName={searchParams.customer}
          canManageAll={canImportForOthers}
        />
      ) : tab === 'pipeline' ? (
        <PipelineContent currentUser={session?.user?.name ?? undefined} />
      ) : tab === 'campaigns' ? (
        <CampaignsContent canManageAll={canImportForOthers} />
      ) : tab === 'suggest' ? (
        <VisitSuggestionsContent currentUser={session?.user?.name ?? undefined} />
      ) : (
        <DailyReportPanel
          currentUser={session?.user?.name ?? ''}
          canImportForOthers={canImportForOthers}
        />
      )}
    </AppShell>
  )
}
