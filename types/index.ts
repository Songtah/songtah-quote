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
  quoteNumber: string        // e.g. "26040901"
  customerName: string
  customerId: string
  customerPhone: string
  customerAddress: string
  customerTaxId: string
  salesperson: string
  validUntil: string
  paymentTerms: string
  total: number
  status: '草稿' | '已送出' | '已確認' | '已過期'
  shareUrl: string
  note: string
  createdAt: string
  items?: QuoteItem[]
}

export interface CreateQuotePayload {
  customerName: string
  customerId: string
  customerPhone: string
  customerAddress: string
  customerTaxId: string
  salesperson: string
  validUntil: string
  paymentTerms: string
  note: string
  items: Omit<QuoteItem, 'subtotal'>[]
}
