import { AppShell } from '@/components/AppShell'
import { getProductsSummary } from '@/lib/system-notion'
import { getCatalogFilterOptions } from '@/lib/products-catalog'
import { ProductsContent } from '@/components/ProductsContent'
import { requireViewPermission, canEdit } from '@/lib/permissions'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ProductsPage() {
  const session = await requireViewPermission('products')
  const allowEdit = canEdit(session, 'products')

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
      {allowEdit && (
        <div className="mb-5 flex items-center gap-3">
          <Link
            href="/products/catalog"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition"
          >
            ✏️ 商品目錄管理
          </Link>
          <span className="text-xs text-gray-400">設定售價、圖片、商品介紹</span>
        </div>
      )}
      <ProductsContent
        total={6037}
        brands={catalogOptions.brands}
        types={catalogOptions.productTypes}
        categories={catalogOptions.categories}
      />
    </AppShell>
  )
}
