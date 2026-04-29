import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { DashboardContent } from '@/components/DashboardContent'
import { authOptions } from '@/lib/auth'
import { getDashboardSummary } from '@/lib/system-notion'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role = (session.user as { role?: string } | undefined)?.role ?? 'viewer'
  const accountType = (session.user as { accountType?: string } | undefined)?.accountType ?? ''
  const permissions = (session.user as { permissions?: any } | undefined)?.permissions
  let initialSummary = null
  let initialError = ''

  try {
    initialSummary = await Promise.race<Awaited<ReturnType<typeof getDashboardSummary>> | null>([
      getDashboardSummary(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
    ])
  } catch (error) {
    console.error('dashboard page summary error:', error)
  }

  return (
    <AppShell
      title="首頁總覽"
      description={`目前登入角色為 ${role}。這一版先把客戶、工單、商機、產品與帳號權限集中到單一入口，保留原有報價功能並逐步擴充。`}
      sessionUser={{ role, accountType, permissions }}
    >
      <DashboardContent initialSummary={initialSummary} initialError={initialError} />
    </AppShell>
  )
}
