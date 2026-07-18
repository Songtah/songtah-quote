import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import { MarketingContent } from '@/components/MarketingContent'
import { canEdit } from '@/lib/permissions'

export default async function MarketingPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const user = session.user as any
  const isPromotionsAdmin = canEdit(session as any, 'promotions')

  return (
    <AppShell
      title="行銷管理"
      description="統合促銷活動、活動管理與活動規劃。"
      hidePhaseNote
      sessionUser={{
        role:        user?.role,
        accountType: user?.accountType,
        permissions: user?.permissions,
      }}
    >
      <MarketingContent isPromotionsAdmin={isPromotionsAdmin} />
    </AppShell>
  )
}
