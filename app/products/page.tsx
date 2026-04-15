import { AppShell } from '@/components/AppShell'
import { getProductCategories, getProductsSummary } from '@/lib/system-notion'
import { ProductsContent } from '@/components/ProductsContent'
import { requireViewPermission } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function ProductsPage() {
  await requireViewPermission('products')

  const [summary, categories] = await Promise.all([
    getProductsSummary().catch(() => ({ total: 0, recent: [] })),
    getProductCategories().catch(() => ({ brands: [], types: [] })),
  ])

  return (
    <AppShell
      title="產品管理"
      description="搜尋與瀏覽產品清單，依廠牌或類型篩選。"
      hidePhaseNote
    >
      <ProductsContent
        total={summary.total}
        brands={categories.brands}
        types={categories.types}
      />
    </AppShell>
  )
}
