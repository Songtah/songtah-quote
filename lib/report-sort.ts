import { normalizeTaiwanPlace, TAIWAN_CITY_ORDER } from './taiwan-geography'

export { normalizeTaiwanPlace } from './taiwan-geography'

export const REPORT_SORT_OPTIONS = [
  { value: 'location', label: '縣市／行政區' },
  { value: 'salesperson', label: '負責人' },
  { value: 'name', label: '客戶名稱' },
] as const

export type ReportSort = (typeof REPORT_SORT_OPTIONS)[number]['value']

export type SortableReportCustomer = {
  name: string
  city: string
  district: string
  type: string
  salesperson: string
}

const TYPE_ORDER = ['醫院', '牙醫診所', '牙體技術所'] as const
const collator = new Intl.Collator('zh-Hant-TW', { numeric: true, sensitivity: 'base' })

function comparePresentText(a: string, b: string): number {
  const left = a.trim()
  const right = b.trim()
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  return collator.compare(left, right)
}

function compareRanked(a: string, b: string, order: readonly string[], normalize = false): number {
  const left = normalize ? normalizeTaiwanPlace(a) : a.trim()
  const right = normalize ? normalizeTaiwanPlace(b) : b.trim()
  if (!left && !right) return 0
  if (!left) return 1
  if (!right) return -1
  const leftRank = order.indexOf(left)
  const rightRank = order.indexOf(right)
  if (leftRank !== -1 || rightRank !== -1) {
    if (leftRank === -1) return 1
    if (rightRank === -1) return -1
    if (leftRank !== rightRank) return leftRank - rightRank
  }
  return collator.compare(left, right)
}

export function compareReportLocation(
  a: Pick<SortableReportCustomer, 'city' | 'district' | 'type' | 'name'>,
  b: Pick<SortableReportCustomer, 'city' | 'district' | 'type' | 'name'>,
): number {
  return compareReportPlace(a, b)
    || compareRanked(a.type, b.type, TYPE_ORDER)
    || comparePresentText(a.name, b.name)
}

export function compareReportPlace(
  a: Pick<SortableReportCustomer, 'city' | 'district'>,
  b: Pick<SortableReportCustomer, 'city' | 'district'>,
): number {
  return compareRanked(a.city, b.city, TAIWAN_CITY_ORDER, true)
    || comparePresentText(normalizeTaiwanPlace(a.district), normalizeTaiwanPlace(b.district))
}

export function sortReportCustomers<T extends SortableReportCustomer>(customers: T[], sort: ReportSort): T[] {
  return [...customers].sort((a, b) => {
    if (sort === 'salesperson') {
      return comparePresentText(a.salesperson, b.salesperson)
        || compareReportLocation(a, b)
    }
    if (sort === 'name') {
      return comparePresentText(a.name, b.name)
        || compareReportLocation(a, b)
    }
    return compareReportLocation(a, b)
  })
}

export function isReportSort(value: string | undefined): value is ReportSort {
  return REPORT_SORT_OPTIONS.some((option) => option.value === value)
}
