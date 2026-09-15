import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import { SupportContent } from '@/components/SupportContent'

export default async function SupportPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  return (
    <AppShell
      title="支援中心"
      description="系統操作手冊與常見問題；找不到答案或發現問題，可以直接回報。"
      hidePhaseNote
    >
      <SupportContent reporter={session.user?.name ?? ''} />
    </AppShell>
  )
}
