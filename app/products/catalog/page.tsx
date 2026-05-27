import { AppShell } from '@/components/AppShell'
import { requireViewPermission } from '@/lib/permissions'
import { getCatalogFilterOptions } from '@/lib/products-catalog'
import { CatalogManagerContent } from '@/components/CatalogManagerContent'

export const dynamic = 'force-dynamic'

export default async function ProductCatalogPage() {
  await requireViewPermission('products')

  const opts = getCatalogFilterOptions()

  return (
    <AppShell
      title="商品目錄管理"
      description="瀏覽所有商品，編輯售價、圖片與商品介紹。"
      hidePhaseNote
    >
      <CatalogManagerContent
        brands={opts.brands}
        categories={opts.categories}
        productTypes={opts.productTypes}
      />
    </AppShell>
  )
}
