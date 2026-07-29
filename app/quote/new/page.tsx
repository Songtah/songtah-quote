import QuoteForm from '@/components/QuoteForm'
import { requireViewPermission } from '@/lib/permissions'
import { AppShell } from '@/components/AppShell'

export const dynamic = 'force-dynamic'

export default async function NewQuotePage() {
  await requireViewPermission('quote')

  // 產品改由 QuoteForm 走 /api/products/search 伺服器端搜尋(與訂貨頁同源的
  // 產品資料庫),不再於此預先全量載入舊 Notion 產品庫。
  return (
    <AppShell title="新增報價單" description="" hidePhaseNote>
      <QuoteForm />
    </AppShell>
  )
}
