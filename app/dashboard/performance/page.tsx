import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import PerformanceDetailContent from '@/components/PerformanceDetailContent'

export default async function PerformanceDetailPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const accountType = (session.user as any)?.accountType as string | undefined
  if (accountType !== '業務') redirect('/dashboard')

  return (
    <AppShell title="我的業績明細" description="近 6 個月訂單與品項明細。">
      <PerformanceDetailContent />
    </AppShell>
  )
}
