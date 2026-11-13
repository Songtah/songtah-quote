import { AppShell } from '@/components/AppShell'
import { isCentralManagement, requireViewPermission } from '@/lib/permissions'
import { ProductDetailContent } from '@/components/catalog/ProductDetailContent'

export const dynamic = 'force-dynamic'

export default async function ProductSeriesPage({ params, searchParams }: { params: { id: string }; searchParams: { sku?: string } }) {
  const session = await requireViewPermission('products')
  return (
    <AppShell title="產品" description="系列的照片、規格、售價與技術文件。" hidePhaseNote>
      <ProductDetailContent
        seriesId={decodeURIComponent(params.id)}
        initialSku={searchParams.sku}
        canManageProducts={isCentralManagement(session)}
      />
    </AppShell>
  )
}
