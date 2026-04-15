import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import TicketForm from '@/components/TicketForm'
import { authOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function NewTicketPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  return (
    <AppShell
      title="新建工單"
      description="依照技術支援回報表單整理成網站版工單建立流程，會直接寫入 Notion 工單資料庫。"
    >
      <TicketForm />
    </AppShell>
  )
}
