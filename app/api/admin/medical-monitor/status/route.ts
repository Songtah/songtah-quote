/**
 * POST /api/admin/medical-monitor/status
 * Body: { customerId: string, status: string }
 * 更新客戶「機構狀態」（連動 Notion 牙科單位資料）。供歇業候選/醫院待確認逐筆編輯開業狀態用。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { updateCustomerStatus } from '@/lib/system-notion'

const VALID = ['開業', '停業', '已歇業', '撤銷', '狀況不明']

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: '未授權' }, { status: 401 })

  let body: { customerId?: string; status?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: '格式錯誤' }, { status: 400 }) }

  const customerId = (body.customerId ?? '').trim()
  const status = (body.status ?? '').trim()
  if (!customerId) return NextResponse.json({ error: '缺少 customerId' }, { status: 400 })
  if (!VALID.includes(status)) return NextResponse.json({ error: `機構狀態須為：${VALID.join('／')}` }, { status: 400 })

  try {
    await updateCustomerStatus(customerId, status)
    return NextResponse.json({ ok: true, customerId, status })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '更新失敗' }, { status: 500 })
  }
}
