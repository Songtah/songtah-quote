import { AppShell } from '@/components/AppShell'
import { AssetLibraryContent } from '@/components/AssetLibraryContent'
import { isAssetsDbConfigured } from '@/lib/assets-notion'
import { requireViewPermission } from '@/lib/permissions'

export const metadata = {
  title: '品牌素材庫',
}

export default async function AssetLibraryPage() {
  await requireViewPermission('assets')

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
