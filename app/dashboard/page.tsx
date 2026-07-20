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
      title="今日營運總覽"
      description={isAdmin ? '掌握團隊漏斗、待辦風險與經營結果。' : '聚焦今日拜訪、待追蹤與下一個業務動作。'}
      sessionUser={{ role, accountType, permissions }}
    >
      <CEODashboardContent isAdmin={isAdmin} />
    </AppShell>
  )
}
