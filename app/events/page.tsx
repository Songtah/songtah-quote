import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import { EventsContent } from '@/components/EventsContent'

export default async function EventsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  return (
    <AppShell
      title="活動管理"
      description="管理崧達舉辦的各類活動，追蹤報名情況。"
      hidePhaseNote
    >
      <EventsContent />
    </AppShell>
  )
}
