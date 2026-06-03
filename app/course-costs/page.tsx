import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import { CourseCostsContent } from '@/components/CourseCostsContent'

export default async function CourseCostsPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  return (
    <AppShell
      title="辦課成本試算"
      description="試算每場課程的成本、收入與利潤，輔助辦課決策。"
      hidePhaseNote
    >
      <CourseCostsContent />
    </AppShell>
  )
}
