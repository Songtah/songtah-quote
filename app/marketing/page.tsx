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
      description="所有展會、課程與說明會都在這裡。點進一場活動，處理它的促銷、報名、問卷、滿意度與預算。"
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
