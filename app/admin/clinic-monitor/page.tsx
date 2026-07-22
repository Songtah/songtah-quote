import Link from 'next/link'
import { AppShell } from '@/components/AppShell'
import { ClinicMonitorContent } from '@/components/ClinicMonitorContent'
import RegionStatsContent from '@/components/RegionStatsContent'
import TerritoryContent from '@/components/TerritoryContent'
import OpportunityContent from './OpportunityContent'
import { canEdit, requireViewPermission } from '@/lib/permissions'
import { peekRegionStatsRows } from '@/lib/notion/customers'
import { canAcceptNewBusiness, getSystemUsers } from '@/lib/notion/accounts'

export const dynamic = 'force-dynamic'

export default async function ClinicMonitorPage({
  searchParams,
}: {
  searchParams: { tab?: string }
}) {
  const session = await requireViewPermission('clinic_monitor')
  const role        = (session?.user as any)?.role        as string | undefined
  const accountType = (session?.user as any)?.accountType as string | undefined
  // 分派/轉移=改寫主檔的管理動作,限 admin/中央管理/總經理(與 /api/customers/assign|reassign 一致)
  const canAssign = role === 'admin' || accountType === '中央管理' || accountType === '總經理'
  // 公司既有客戶調度(公司↔業務)更嚴,僅限中央管理(與 /api/customers/assign-company 一致)
  const canManageCompany = role === 'admin' || accountType === '中央管理'
  const canClaim = canEdit(session, 'clinic_monitor')
  const currentUserId = (session.user as any)?.id ?? ''

  const tab = searchParams.tab === 'regions'
    ? 'regions'
    : searchParams.tab === 'territory'
      ? 'territory'
      : searchParams.tab === 'opportunity'
        ? 'opportunity'
        : 'monitor'

  // 區域/轄區分頁共用同一份 region-stats 快取(SSR 只讀快取,不觸發全庫掃描)
  const regionInitial = tab === 'regions' || tab === 'territory'
    ? await peekRegionStatsRows()
    : null
  const managementUsers = tab === 'territory' || tab === 'regions' ? await getSystemUsers() : []
  const accountOptions = managementUsers
    .filter(canAcceptNewBusiness)
    .map((user) => ({ id: user.id, name: user.name }))
  const maintenanceAccounts = managementUsers
    .filter((user) => user.status !== '停用' && user.accountType === '業務' && user.assignmentMode === '既有客戶維護')
    .map((user) => ({ id: user.id, name: user.name }))

  const TAB_ITEMS = [
    { id: 'monitor',   href: '/admin/clinic-monitor',                 label: '🩺 客戶監控' },
    { id: 'regions',   href: '/admin/clinic-monitor?tab=regions',     label: '📊 區域客戶儀表板' },
    { id: 'territory', href: '/admin/clinic-monitor?tab=territory',   label: '🗺️ 業務轄區管理' },
    { id: 'opportunity', href: '/admin/clinic-monitor?tab=opportunity', label: '🔍 商機偵測' },
  ] as const

  return (
    <AppShell
      title={tab === 'regions' ? '區域客戶儀表板' : tab === 'territory' ? '業務轄區管理' : tab === 'opportunity' ? '商機偵測' : '客戶資料監控'}
      description={
        tab === 'regions'
          ? '各鄉鎮市區的機構規模、公司既有客戶覆蓋與各業務轄區客戶數。'
          : tab === 'territory'
            ? '先設定業務負責開發的地區，再由業務逐筆認領客戶；新增轄區不會改動客戶歸屬或轉化統計。'
            : tab === 'opportunity'
              ? '從 Google 商家資訊挖出診所的設備/數位訊號(如一日假牙=院內技工室),標記商機、鎖定設備直客。'
              : '每月比對全台牙科單位的開業／停業狀況，關聯崧達客戶。'
      }
      hidePhaseNote
    >
      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-stone-900/[0.06] mb-6 overflow-x-auto">
        {TAB_ITEMS.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'regions' ? (
        <RegionStatsContent initialData={regionInitial} canAssign={canAssign} assignableSalespersons={accountOptions.map((account) => account.name)} />
      ) : tab === 'territory' ? (
        <TerritoryContent
          initialData={regionInitial}
          canAssign={canAssign}
          canManageCompany={canManageCompany}
          canClaim={canClaim}
          currentUserId={currentUserId}
          accountOptions={accountOptions}
          maintenanceAccounts={maintenanceAccounts}
        />
      ) : tab === 'opportunity' ? (
        <OpportunityContent canScan={canManageCompany} />
      ) : (
        <ClinicMonitorContent />
      )}
    </AppShell>
  )
}
