import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { canEdit } from '@/lib/permissions'
import { AppShell } from '@/components/AppShell'
import { EventDetailContent } from '@/components/EventDetailContent'

export default async function EventDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  const editable = canEdit(session, 'events')

  return (
    <AppShell
      title="活動詳情"
      description="查看活動資訊與報名名單。"
      hidePhaseNote
    >
      <EventDetailContent id={params.id} canEdit={editable} />
    </AppShell>
  )
}
