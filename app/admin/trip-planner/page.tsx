import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import { TripPlannerContent } from '@/components/TripPlannerContent'

export default async function TripPlannerPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  return (
    <AppShell
      title="行程規劃"
      description="出國行程時間軸排程工具。"
      hidePhaseNote
    >
      <TripPlannerContent />
    </AppShell>
  )
}
