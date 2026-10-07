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
      title="產品"
      description={isCentralManagement(session)
        ? '搜尋產品、查看售價與規格；中央管理可維護照片、介紹、售價與技術文件。'
        : '搜尋產品、查看售價、照片、規格與技術文件。'}
      hidePhaseNote
    >
      <CatalogManagerContent
        taxonomy={taxonomy}
        canManageProducts={isCentralManagement(session)}
      />
    </AppShell>
  )
}
