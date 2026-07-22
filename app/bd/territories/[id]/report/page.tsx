import { notFound, redirect } from 'next/navigation'
import TerritoryReportClient from '@/components/TerritoryReportClient'
import { canView, requireSession } from '@/lib/permissions'
import { listCustomersByArea } from '@/lib/notion/customers'
import { getSystemUsers } from '@/lib/notion/accounts'
import { getTerritory } from '@/lib/notion/territories'
import {
  getTerritoryAreas, TERRITORY_CUSTOMER_TYPES, type TerritoryCustomerType,
} from '@/lib/territory-areas'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const INACTIVE_STATUS = new Set(['已歇業', '停業', '撤銷'])

export default async function TerritoryReportPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { type?: string }
}) {
  const session = await requireSession()
  if (!canView(session, 'bd') && !canView(session, 'clinic_monitor')) redirect('/dashboard')

  let territory
  try {
    territory = await getTerritory(params.id)
  } catch {
    notFound()
  }

  const user = session.user as any
  const canViewAll = user?.role === 'admin' || user?.accountType === '中央管理' || user?.accountType === '總經理'
  const ownsTerritory = !!territory.salespersonId && territory.salespersonId === user?.id
  if (!canViewAll && !ownsTerritory) redirect('/bd')

  const [allCustomers, areaResult, users] = await Promise.all([
    listCustomersByArea({ city: territory.city, district: territory.district }),
    getTerritoryAreas(),
    getSystemUsers(),
  ])
  const activeCustomers = allCustomers.filter((customer) => !INACTIVE_STATUS.has(customer.status))
  const matchingOwners = users.filter((account) =>
    account.status !== '停用' && account.accountType === '業務' && account.name === territory.salesperson
  )
  const ownerIdentityUnique = matchingOwners.length === 1 && matchingOwners[0].id === territory.salespersonId
  const visibleCustomers = canViewAll
    ? activeCustomers
    : activeCustomers.filter((customer) =>
      !customer.salesperson || (ownerIdentityUnique && customer.salesperson === territory.salesperson)
    )
  const hiddenCustomers = activeCustomers.filter((customer) => !visibleCustomers.some((visible) => visible.id === customer.id))
  const hiddenOtherOwnedCount = activeCustomers.length - visibleCustomers.length
  const hiddenOtherOwnedByType = Object.fromEntries(TERRITORY_CUSTOMER_TYPES.map((type) => [
    type, hiddenCustomers.filter((customer) => customer.type === type).length,
  ])) as Record<TerritoryCustomerType, number>
  const area = areaResult.items.find((item) => item.city === territory.city && item.district === territory.district)
  const marketByType = area?.byType ?? { '牙醫診所': 0, '牙體技術所': 0, '醫院': 0 }
  const initialType = TERRITORY_CUSTOMER_TYPES.includes(searchParams.type as TerritoryCustomerType)
    ? searchParams.type as TerritoryCustomerType
    : ''
  const generatedAt = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date())

  return (
    <TerritoryReportClient
      territory={{
        id: territory.id, city: territory.city, district: territory.district,
        salesperson: territory.salesperson, status: territory.status,
      }}
      customers={visibleCustomers.map((customer) => ({
        id: customer.id, name: customer.name, type: customer.type,
        status: customer.status, devStage: customer.devStage, salesperson: customer.salesperson,
      }))}
      marketByType={marketByType}
      marketTotal={TERRITORY_CUSTOMER_TYPES.reduce((sum, type) => sum + marketByType[type], 0)}
      generatedAt={generatedAt}
      generatedBy={session.user?.name ?? ''}
      initialType={initialType}
      hiddenOtherOwnedCount={hiddenOtherOwnedCount}
      hiddenOtherOwnedByType={hiddenOtherOwnedByType}
      ownershipIdentityAmbiguous={!canViewAll && !ownerIdentityUnique}
    />
  )
}
