import { notFound, redirect } from 'next/navigation'
import SalespersonReportClient from '@/components/SalespersonReportClient'
import { canView, requireSession } from '@/lib/permissions'
import { listCustomersByArea, listCustomersByAreas, type AreaCustomer } from '@/lib/notion/customers'
import { canAppearInSalesReports, getSystemUsers } from '@/lib/notion/accounts'
import { listTerritories } from '@/lib/notion/territories'
import { getTerritoryAreas, TERRITORY_CUSTOMER_TYPES, type TerritoryCustomerType } from '@/lib/territory-areas'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const INACTIVE_STATUS = new Set(['已歇業', '停業', '撤銷'])

export default async function SalespersonReportPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { scope?: string; type?: string; format?: string }
}) {
  const session = await requireSession()
  if (!canView(session, 'bd') && !canView(session, 'clinic_monitor')) redirect('/dashboard')

  const user = session.user as any
  const canViewAll = user?.role === 'admin' || user?.accountType === '中央管理' || user?.accountType === '總經理'
  const isCompanyReport = params.id === 'company'
  if (isCompanyReport && !canViewAll) redirect('/bd')
  if (!canViewAll && user?.id !== params.id) redirect('/bd')

  let salesperson: { id: string; name: string; ownerName: string }
  if (isCompanyReport) {
    salesperson = { id: 'company', name: '公司客戶', ownerName: '公司' }
  } else {
    const users = await getSystemUsers()
    const account = users.find((item) => item.id === params.id && canAppearInSalesReports(item))
    if (!account) notFound()
    const sameNameAccounts = users.filter((item) => canAppearInSalesReports(item) && item.name === account.name)
    if (sameNameAccounts.length !== 1 || sameNameAccounts[0].id !== account.id) redirect('/bd')
    salesperson = { id: account.id, name: account.name, ownerName: account.name }
  }

  const scope = isCompanyReport || searchParams.scope === 'customers' ? 'customers' : 'territories'
  const initialType = TERRITORY_CUSTOMER_TYPES.includes(searchParams.type as TerritoryCustomerType)
    ? searchParams.type as TerritoryCustomerType
    : ''
  const [allTerritories, areaResult] = await Promise.all([listTerritories(), getTerritoryAreas()])
  const territories = allTerritories.filter((territory) => territory.salespersonId === salesperson.id)

  let rawCustomers: AreaCustomer[] = []
  if (scope === 'customers') {
    rawCustomers = await listCustomersByArea({ salesperson: salesperson.ownerName })
  } else {
    rawCustomers = await listCustomersByAreas(territories)
  }
  const uniqueCustomers = Array.from(new Map(rawCustomers.map((customer) => [customer.id, customer])).values())
    .filter((customer) => !INACTIVE_STATUS.has(customer.status))
  const visibleCustomers = scope === 'customers' || canViewAll
    ? uniqueCustomers
    : uniqueCustomers.filter((customer) => !customer.salesperson || customer.salesperson === salesperson.ownerName)
  const hiddenCustomers = uniqueCustomers.filter((customer) => !visibleCustomers.some((visible) => visible.id === customer.id))
  const hiddenOtherOwnedByType = Object.fromEntries(TERRITORY_CUSTOMER_TYPES.map((type) => [
    type, hiddenCustomers.filter((customer) => customer.type === type).length,
  ])) as Record<TerritoryCustomerType, number>

  const areaMap = new Map(areaResult.items.map((area) => [`${area.city}|${area.district}`, area]))
  const territorySummaries = territories.map((territory) => {
    const area = areaMap.get(`${territory.city}|${territory.district}`)
    const marketByType = area?.byType ?? { '牙醫診所': 0, '牙體技術所': 0, '醫院': 0 }
    return {
      id: territory.id, city: territory.city, district: territory.district, status: territory.status,
      marketByType,
      marketTotal: TERRITORY_CUSTOMER_TYPES.reduce((sum, type) => sum + marketByType[type], 0),
      customerCount: visibleCustomers.filter((customer) => customer.city === territory.city && customer.district === territory.district).length,
    }
  })
  const marketByType = Object.fromEntries(TERRITORY_CUSTOMER_TYPES.map((type) => [
    type, territorySummaries.reduce((sum, territory) => sum + territory.marketByType[type], 0),
  ])) as Record<TerritoryCustomerType, number>
  const generatedAt = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())

  return (
    <SalespersonReportClient
      salesperson={{ id: salesperson.id, name: salesperson.name }}
      scope={scope}
      customers={visibleCustomers.map((customer) => ({
        id: customer.id, name: customer.name, city: customer.city, district: customer.district,
        type: customer.type, status: customer.status, devStage: customer.devStage,
        salesperson: customer.salesperson, phone: customer.phone, address: customer.address,
      }))}
      territories={territorySummaries}
      marketByType={marketByType}
      marketTotal={TERRITORY_CUSTOMER_TYPES.reduce((sum, type) => sum + marketByType[type], 0)}
      generatedAt={generatedAt}
      generatedBy={session.user?.name ?? ''}
      initialType={initialType}
      initialFormat={searchParams.format === 'csv' ? 'csv' : 'pdf'}
      hiddenOtherOwnedCount={hiddenCustomers.length}
      hiddenOtherOwnedByType={hiddenOtherOwnedByType}
      customerOnly={isCompanyReport}
    />
  )
}
