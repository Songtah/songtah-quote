import { AppShell } from '@/components/AppShell'
import { ClinicMonitorContent } from '@/components/ClinicMonitorContent'
import { requireAdmin } from '@/lib/permissions'
import { getClinicMonitorRecords } from '@/lib/system-notion'

export const dynamic = 'force-dynamic'

export default async function ClinicMonitorPage() {
  await requireAdmin()

  const records = await getClinicMonitorRecords(3)

  return (
    <AppShell
      title="診所監控"
      description="每月比對全台健保特約牙醫診所開業／停業狀況，關聯崧達客戶。"
      hidePhaseNote
    >
      <ClinicMonitorContent initialRecords={records} />
    </AppShell>
  )
}
