import { AppShell } from '@/components/AppShell'
import { isCentralManagement, requireViewPermission } from '@/lib/permissions'
import { getTaxonomyBrowser } from '@/lib/products-catalog'
import { CatalogManagerContent } from '@/components/CatalogManagerContent'

export const dynamic = 'force-dynamic'

export default async function ProductCatalogPage() {
  const session = await requireViewPermission('products')

  const taxonomy = getTaxonomyBrowser()

  return (
    <AppShell
      title="產品目錄"
      description="從分類卡片快速瀏覽產品；同系列規格集中顯示，可維護照片、介紹、售價與技術文件。"
      hidePhaseNote
    >
      <CatalogManagerContent
        taxonomy={taxonomy}
        canManageProducts={isCentralManagement(session)}
      />
    </AppShell>
  )
}
