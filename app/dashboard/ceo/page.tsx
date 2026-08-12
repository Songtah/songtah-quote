import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import { CEODashboardContent } from '@/components/CEODashboardContent'
import { CrossSupportPanel } from '@/components/CrossSupportPanel'

const CEO_ACCOUNT_TYPES = new Set(['行政', '中央管理', '總經理'])

export default async function CEODashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const role = user?.role ?? ''
  const accountType = user?.accountType ?? ''
  const canAccess = role === 'admin' || CEO_ACCOUNT_TYPES.has(accountType)
  if (!canAccess) redirect('/dashboard')

  return (
    <AppShell title="業績總覽" description="全公司訂單、業務排行與待辦聚合。" hidePhaseNote>
      <div className="space-y-6">
        <CEODashboardContent isAdmin={role === 'admin'} />
        <CrossSupportPanel />
      </div>
    </AppShell>
  )
}
