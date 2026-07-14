import { AppShell } from '@/components/AppShell'
import { requireViewPermission } from '@/lib/permissions'
import { getCatalogFilterOptions, getTaxonomyBrowser } from '@/lib/products-catalog'
import { CatalogManagerContent } from '@/components/CatalogManagerContent'

export const dynamic = 'force-dynamic'

export default async function ProductCatalogPage() {
  await requireViewPermission('products')

  const opts = getCatalogFilterOptions()
  const taxonomy = getTaxonomyBrowser()

  return (
    <AppShell
      title="商品目錄管理"
      description="瀏覽所有商品，編輯售價、圖片與商品介紹。分類體系:11 主分類 × 62 功能分類(2026-07-14 總表)。"
      hidePhaseNote
    >
      <CatalogManagerContent
        brands={opts.brands}
        categories={opts.categories}
        productTypes={opts.productTypes}
        taxonomy={taxonomy}
      />
    </AppShell>
  )
}
