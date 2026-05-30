import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { CEODashboardContent } from '@/components/CEODashboardContent'
import { authOptions } from '@/lib/auth'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const role        = (session.user as any)?.role        as string | undefined ?? 'viewer'
  const accountType = (session.user as any)?.accountType as string | undefined ?? ''
  const permissions = (session.user as any)?.permissions

  const isAdmin = role === 'admin' || accountType === '行政' || accountType === '中央管理'

  return (
    <AppShell
      title="首頁總覽"
      description="業績概況、客情動態與核心指標一覽。"
      sessionUser={{ role, accountType, permissions }}
    >
      <CEODashboardContent isAdmin={isAdmin} />
    </AppShell>
  )
}
