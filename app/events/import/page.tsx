import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import { canEdit } from '@/lib/permissions'
import { EventImportContent } from '@/components/EventImportContent'

export default async function EventImportPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')
  if (!canEdit(session as any, 'events')) redirect('/events')

  return (
    <AppShell
      title="匯入歷史活動紀錄"
      description="把過去的課程或展會參與名單匯入系統，自動建立活動、配對客戶，記錄到客戶的活動足跡。"
      hidePhaseNote
    >
      <EventImportContent />
    </AppShell>
  )
}
