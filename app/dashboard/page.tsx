import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { SalesTodayDashboard } from '@/components/SalesTodayDashboard'
import { authOptions } from '@/lib/auth'
import { getTodayDashboard } from '@/lib/dashboard-today'
import { canView } from '@/lib/permissions'

export default async function DashboardPage() {
  const session = await getServerSession(authOptions)
  if (!session) redirect('/login')

  const userName = session.user?.name?.trim() ?? ''
  const accountType = (session.user as any)?.accountType as string | undefined
  const role = (session.user as any)?.role as string | undefined
  const visibleModules = {
    bd: canView(session, 'bd'),
    crm: canView(session, 'crm'),
    quote: canView(session, 'quote'),
    orders: canView(session, 'orders'),
    products: canView(session, 'products'),
    rma: canView(session, 'rma'),
    marketing: true,
    clinicMonitor: canView(session, 'clinic_monitor'),
    admin: (role === 'admin' || accountType === '行政') && canView(session, 'admin'),
    accounts: canView(session, 'accounts'),
    audit: role === 'admin',
  }
  const hasPersonalSalesQueue = accountType === '業務'
  const data = await getTodayDashboard(userName, {
    bd: hasPersonalSalesQueue && visibleModules.bd,
    quote: hasPersonalSalesQueue && visibleModules.quote,
    rma: hasPersonalSalesQueue && visibleModules.rma,
  })
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'Asia/Taipei',
  }).format(new Date()))
  const greeting = hour < 11 ? '早安' : hour < 17 ? '午安' : '晚安'

  return (
    <SalesTodayDashboard userName={userName} greeting={greeting} data={data} visibleModules={visibleModules} />
  )
}
