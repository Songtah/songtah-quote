import { AppShell } from '@/components/AppShell'
import { isCentralManagement, requireViewPermission } from '@/lib/permissions'
import { getCatalogFilterOptions, getTaxonomyBrowser } from '@/lib/products-catalog'
import { CatalogManagerContent } from '@/components/CatalogManagerContent'

export const dynamic = 'force-dynamic'

export default async function ProductCatalogPage() {
  const session = await requireViewPermission('products')

  const opts = getCatalogFilterOptions()
  const taxonomy = getTaxonomyBrowser()

  return (
    <AppShell
      title="產品目錄"
      description="依品牌、分類與商品型態快速查找；同系列規格集中顯示，可維護照片、介紹、售價與技術文件。"
      hidePhaseNote
    >
      <CatalogManagerContent
        brands={opts.brands}
        categories={opts.categories}
        productTypes={opts.productTypes}
        taxonomy={taxonomy}
        canManageProducts={isCentralManagement(session)}
      />
    </AppShell>
  )
}
