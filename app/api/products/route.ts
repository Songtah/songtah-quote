import { NextResponse } from 'next/server'
import { getProducts } from '@/lib/notion'

export const revalidate = 300 // 5 分鐘快取

export async function GET() {
  try {
    const products = await getProducts()
    return NextResponse.json(products)
  } catch (err) {
    console.error('getProducts error:', err)
    return NextResponse.json({ error: '無法取得產品資料' }, { status: 500 })
  }
}
