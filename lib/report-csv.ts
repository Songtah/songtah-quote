export type ExportFormat = 'pdf' | 'csv'

export type CustomerCsvRow = {
  name: string
  type: string
  status: string
  city: string
  district: string
  devStage: string
  salesperson: string
  phone: string
  address: string
}

const CSV_HEADERS = ['序號', '客戶名稱', '客戶類型', '機構狀態', '縣市', '行政區', '開發階段', '負責人', '電話', '地址']

function csvCell(value: string | number): string {
  let text = String(value ?? '').replace(/\r\n?/g, '\n')
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

export function buildCustomerCsv(customers: CustomerCsvRow[]): string {
  const rows = customers.map((customer, index) => [
    index + 1,
    customer.name,
    customer.type,
    customer.status,
    customer.city,
    customer.district,
    customer.devStage,
    customer.salesperson,
    customer.phone,
    customer.address,
  ])
  return `\uFEFF${[CSV_HEADERS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`
}

export function safeExportFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80)
}

export function taipeiDateStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function downloadCustomerCsv(customers: CustomerCsvRow[], filename: string): void {
  const blob = new Blob([buildCustomerCsv(customers)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeExportFilename(filename)}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
