import Link from 'next/link'
import { AppShell } from '@/components/AppShell'
import { CustomersContent } from '@/components/CustomersContent'
import { requireViewPermission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function CustomersPage() {
  await requireViewPermission('crm')

  return (
    <AppShell
      title="客戶管理"
      description="搜尋客戶、查看主檔資訊、設備清單與相關工單紀錄。"
    >
      <div className="mb-5 flex justify-end">
        <Link
          href="/admin/clinic-monitor?tab=regions"
          className="px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:border-stone-300 active:scale-95 transition-all"
        >
          📊 區域客戶儀表板
        </Link>
      </div>
      <CustomersContent />
    </AppShell>
  )
}
