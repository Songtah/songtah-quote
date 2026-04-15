import { AppShell } from '@/components/AppShell'
import { CustomersContent } from '@/components/CustomersContent'
import { getDashboardSummary } from '@/lib/system-notion'
import { requireViewPermission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function CustomersPage() {
  await requireViewPermission('crm')

  const summary = await getDashboardSummary()
  const customers = summary.customers

  return (
    <AppShell
      title="CRM 客戶管理"
      description="搜尋客戶、查看主檔資訊、設備清單與相關工單紀錄。"
    >
      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="panel p-5">
          <p className="eyebrow mb-2">Customers</p>
          <p className="text-3xl font-black text-slate-900">{customers.total}</p>
          <p className="mt-2 text-sm text-slate-500">客戶主檔總數</p>
        </div>
        <div className="panel p-5">
          <p className="eyebrow mb-2">Search</p>
          <p className="text-lg font-bold text-slate-900">即時搜尋</p>
          <p className="mt-2 text-sm text-slate-500">直接輸入客戶名稱搜尋</p>
        </div>
        <div className="panel p-5">
          <p className="eyebrow mb-2">Detail</p>
          <p className="text-lg font-bold text-slate-900">客戶詳情頁</p>
          <p className="mt-2 text-sm text-slate-500">設備清單與工單紀錄</p>
        </div>
      </section>

      <CustomersContent
        total={customers.total}
        recent={customers.recent.map((r) => ({
          id: r.id,
          name: r.title,
          city: r.meta.split('・')[0] ?? '',
          district: '',
          type: r.meta.split('・')[1] ?? '',
          salesperson: '',
        }))}
      />
    </AppShell>
  )
}
