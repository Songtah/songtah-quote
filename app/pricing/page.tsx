import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import { PricingContent } from '@/components/PricingContent'

export default async function PricingPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  return (
    <AppShell
      title="報價成本試算"
      description="管理產品進貨成本、定價與毛利，快速估算折扣後的獲利空間。"
      hidePhaseNote
    >
      <PricingContent />
    </AppShell>
  )
}
