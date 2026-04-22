import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import AdminQuoteContent from '@/components/AdminQuoteContent'

export default async function AdminPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user        = session.user as any
  const role        = user?.role        ?? ''
  const accountType = user?.accountType ?? ''

  const permissions = user?.permissions
  const canAccess =
    role === 'admin' ||
    accountType === '行政' ||
    permissions?.['admin']?.view === true
  if (!canAccess) redirect('/dashboard')

  return (
    <AppShell
      title="行政管理"
      description="報價單審核、簽核流程管理。"
      hidePhaseNote
    >
      <AdminQuoteContent />
    </AppShell>
  )
}
