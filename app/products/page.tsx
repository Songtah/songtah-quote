import { AppShell } from '@/components/AppShell'
import { getProductsSummary } from '@/lib/system-notion'
import { getCatalogFilterOptions } from '@/lib/products-catalog'
import { ProductsContent } from '@/components/ProductsContent'
import { requireViewPermission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function ProductsPage() {
  await requireViewPermission('products')

  const [summary, catalogOptions] = await Promise.all([
    getProductsSummary().catch(() => ({ total: 0, recent: [] })),
    Promise.resolve(getCatalogFilterOptions()),
  ])

  return (
    <AppShell
      title="產品管理"
      description={`搜尋與瀏覽產品清單，共 ${catalogOptions.brands.length ? '6,037' : summary.total} 筆商品。`}
      hidePhaseNote
    >
      <ProductsContent
        total={6037}
        brands={catalogOptions.brands}
        types={catalogOptions.productTypes}
        categories={catalogOptions.categories}
      />
    </AppShell>
  )
}
