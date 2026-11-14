import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import TicketForm from '@/components/TicketForm'
import { authOptions } from '@/lib/auth'
import { getSystemCustomerById } from '@/lib/notion/customers'

export const dynamic = 'force-dynamic'

export default async function NewTicketPage({ searchParams }: { searchParams: { customerId?: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  // 從客戶頁「建立工單」進來：客戶與負責業務直接帶入
  const c = searchParams.customerId ? await getSystemCustomerById(searchParams.customerId).catch(() => null) : null

  return (
    <AppShell
      title="新建工單"
      description="依照技術支援回報表單整理成網站版工單建立流程，會直接寫入工單資料庫。"
    >
      <TicketForm initialCustomer={c ? { id: c.id, name: c.name, salesperson: c.salesperson } : undefined} />
    </AppShell>
  )
}
