import { AppShell } from '@/components/AppShell'
import { isCentralManagement, requireViewPermission } from '@/lib/permissions'
import { PricingContent } from '@/components/catalog/PricingContent'

export const dynamic = 'force-dynamic'

export default async function ProductPricingPage({ searchParams }: { searchParams: { tab?: string; period?: string } }) {
  const session = await requireViewPermission('products')
  const manage = isCentralManagement(session)
  return (
    <AppShell
      title="定價與價格公告"
      description={manage ? '補上待定價品項、批次調整售價；每月 1 日自動彙整上個月的價格異動並通知全公司。' : '每月 1 日公告上個月的價格異動。'}
      hidePhaseNote
    >
      <PricingContent canManage={manage} initialTab={manage && searchParams.tab !== 'announcements' ? 'workspace' : 'announcements'} initialPeriod={searchParams.period} />
    </AppShell>
  )
}
