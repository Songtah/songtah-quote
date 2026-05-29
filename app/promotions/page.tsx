import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import { PromotionsContent } from '@/components/PromotionsContent'

export default async function PromotionsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user        = session.user as any
  const role        = user?.role        as string | undefined
  const accountType = user?.accountType as string | undefined
  const isAdmin     = role === 'admin' || accountType === '行政' || accountType === '中央管理'

  return (
    <AppShell
      title="促銷活動"
      description="管理季度展場、月度促銷與課程等活動，供業務開訂單時參考。"
      sessionUser={{
        role:        user?.role,
        accountType: user?.accountType,
        permissions: user?.permissions,
      }}
    >
      <PromotionsContent isAdmin={isAdmin} />
    </AppShell>
  )
}
