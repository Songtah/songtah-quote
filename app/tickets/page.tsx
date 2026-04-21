import { AppShell } from '@/components/AppShell'
import { listSystemTickets } from '@/lib/system-notion'
import TicketList from '@/components/TicketList'
import NewTicketModal from '@/components/NewTicketModal'
import { requireViewPermission } from '@/lib/permissions'
import type { Ticket } from '@/types'

export const dynamic = 'force-dynamic'

export default async function TicketsPage() {
  await requireViewPermission('rma')

  let tickets: Ticket[] = []
  let loadError = ''

  try {
    tickets = await listSystemTickets()
  } catch (error) {
    console.warn('TicketsPage warning:', error)
    loadError = '目前無法即時讀取工單資料，可能是 Notion 權限或暫時的流量限制。'
  }

  const open = tickets.filter((t) => t.status !== '✅ 結案').length
  const closed = tickets.filter((t) => t.status === '✅ 結案').length

  return (
    <AppShell
      title="RMA 技術支援"
      description="維修案件、技術支援與設備追蹤。"
    >
      {/* Stats */}
      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="panel p-5">
          <p className="eyebrow mb-2">總案件數</p>
          <p className="text-3xl font-black text-slate-900">{tickets.length}</p>
        </div>
        <div className="panel p-5">
          <p className="eyebrow mb-2">處理中</p>
          <p className="text-3xl font-black text-blue-600">{open}</p>
        </div>
        <div className="panel p-5">
          <p className="eyebrow mb-2">已結案</p>
          <p className="text-3xl font-black text-green-600">{closed}</p>
        </div>
      </section>

      {/* Actions */}
      <div className="mb-5 flex justify-end">
        <NewTicketModal />
      </div>

      {/* Interactive ticket list */}
      <TicketList tickets={tickets} />

      {loadError && (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {loadError}
        </p>
      )}
    </AppShell>
  )
}
