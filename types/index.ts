export interface Product {
  id: string
  name: string
  brand: string
  category: string
  spec: string
  unit: string
  price: number | null
  series: string
  active: boolean
  imageUrl: string
}

export interface Customer {
  id: string
  name: string
  address: string
  phone: string
  taxId: string
  city: string
  type: string
  status: string
}

export interface Equipment {
  id: string
  customerName: string
  serialNumber: string
  manufacturer: string
  status: string
  supportId: string
  teamViewerId: string
  productName: string
  originalCustomerId: string
  originalProductId: string
  thumbnail?: string
}

export interface Ticket {
  id: string
  equipmentId?: string
  number: string
  customerName: string
  title: string
  ticketType: string
  status: string
  priority: string
  scheduledDate: string
  contactName: string
  description: string
  supportOwner: string
  salesOwner: string
  cause?: string
  solution?: string
  note?: string
  manufacturer?: string
  createdDate?: string
}

export interface CreateTicketPayload {
  customerName: string
  customerId?: string
  equipmentId?: string
  productId?: string
  title: string
  ticketType: string
  priority: string
  status: string
  contactName: string
  supportOwner: string
  salesOwner: string
  scheduledDate?: string
  description: string
  cause?: string
  solution?: string
  keyPart?: string
  note?: string
  manufacturer?: string
}

export interface UpdateTicketPayload {
  status?: string
  priority?: string
  supportOwner?: string
  salesOwner?: string
  scheduledDate?: string
  cause?: string
  solution?: string
  note?: string
  equipmentId?: string
}

export interface QuoteItem {
  productId: string
  name: string
  brand: string
  category: string
  spec: string
  unit: string
  unitPrice: number
  quantity: number
  subtotal: number
  note: string
  imageUrl: string
  isCustom?: boolean
}

export interface Quote {
  id: string
  quoteNumber: string        // 新制 "T-115100701"（T-民國年月日＋流水號）；舊制 "26040901"
  customerName: string
  customerId: string
  companyTitle?: string
  contactPerson?: string     // 客戶聯絡人
  customerPhone: string
  customerAddress: string
  customerTaxId: string
  salesperson: string
  quoteDate?: string         // 報價日期（YYYY-MM-DD）；舊單無此欄時以建立日期代替
  validUntil: string
  paymentTerms: string
  deliveryTerms?: string     // 交貨條件
  taxMode?: '含稅' | '未稅'
  discount?: number          // 整單折讓（正數）
  layout?: string            // 版面設定 JSON（見 lib/quote-model QuoteLayout）
  total: number              // 應付總額（已扣折讓、含稅）
  status: '草稿' | '待行政審核' | '待總經理審核' | '已核准' | '已退回' | '已送出' | '已確認' | '已過期'
  shareUrl: string
  note: string
  approvalNote?: string
  createdAt: string
  items?: QuoteItem[]
}

export interface CreateQuotePayload {
  customerName: string
  customerId: string
  companyTitle?: string
  contactPerson?: string
  customerPhone: string
  customerAddress: string
  customerTaxId: string
  salesperson: string
  quoteDate?: string
  validUntil: string
  paymentTerms: string
  deliveryTerms?: string
  taxMode?: '含稅' | '未稅'
  discount?: number
  layout?: string
  note: string
  items: Omit<QuoteItem, 'subtotal'>[]
}
