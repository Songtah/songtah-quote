import { AppShell } from '@/components/AppShell'
import { isCentralManagement, requireViewPermission } from '@/lib/permissions'
import { ProductDetailContent } from '@/components/catalog/ProductDetailContent'

export const dynamic = 'force-dynamic'

export default async function ProductItemPage({ params }: { params: { code: string } }) {
  const session = await requireViewPermission('products')
  return (
    <AppShell title="產品" description="產品的照片、規格、售價與技術文件。" hidePhaseNote>
      <ProductDetailContent code={decodeURIComponent(params.code)} canManageProducts={isCentralManagement(session)} />
    </AppShell>
  )
}
