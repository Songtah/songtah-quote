import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { DashboardContent } from '@/components/DashboardContent'
import { authOptions } from '@/lib/auth'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = (session.user as { role?: string } | undefined)?.role ?? 'viewer'

  return (
    <AppShell
      title="CRM・RMA・BD 總覽"
      description={`目前登入角色為 ${role}。這一版先把客戶、工單、商機、產品與帳號權限集中到單一入口，保留原有報價功能並逐步擴充。`}
    >
      <DashboardContent />
    </AppShell>
  )
}
