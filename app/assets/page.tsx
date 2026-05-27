import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { AppShell } from '@/components/AppShell'
import { AssetLibraryContent } from '@/components/AssetLibraryContent'
import { isAssetsDbConfigured } from '@/lib/assets-notion'

export const metadata = {
  title: '品牌素材庫',
}

export default async function AssetLibraryPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const setupNeeded = !isAssetsDbConfigured()

  return (
    <AppShell
      title="品牌素材庫"
      description="共用圖片素材，點擊可預覽並下載壓縮版或原圖。"
      hidePhaseNote
    >
      <AssetLibraryContent setupNeeded={setupNeeded} />
    </AppShell>
  )
}
