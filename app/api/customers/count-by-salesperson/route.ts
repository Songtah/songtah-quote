/**
 * GET /api/customers/count-by-salesperson?name=X — 某業務目前持有幾筆客戶
 *
 * 只讀區域統計快取(peekCustomerCountBySalesperson),不觸發全庫掃描。
 * 用途:帳號管理頁停用業務帳號前的提醒——快取可能有數小時延遲,數字僅供參考。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { peekCustomerCountBySalesperson } from '@/lib/notion/customers'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth({ module: 'accounts', action: 'edit' }, async (req: NextRequest) => {
  const name = req.nextUrl.searchParams.get('name')?.trim()
  if (!name) return NextResponse.json({ error: '缺少 name' }, { status: 400 })
  const count = await peekCustomerCountBySalesperson(name)
  return NextResponse.json({ count })
})
