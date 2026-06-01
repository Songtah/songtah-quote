import { AppShell } from '@/components/AppShell'
import { PromotionsContent } from '@/components/PromotionsContent'
import { requireViewPermission, canEdit } from '@/lib/permissions'

export default async function PromotionsPage() {
  const session = await requireViewPermission('promotions')

  const user        = session.user as any
  const isAdmin     = canEdit(session, 'promotions')

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
