import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { createTicket } from '@/lib/system-notion'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { page, description, reporter } = body as {
      page: string
      description: string
      reporter?: string
    }

    if (!description?.trim()) {
      return NextResponse.json({ error: '請填寫問題描述' }, { status: 400 })
    }

    await createTicket({
      customerName: '【系統回報】',
      title: `[問題回報] ${page || '未指定頁面'}`,
      ticketType: '其他',
      contactName: reporter || (session.user as any)?.name || '內部用戶',
      description: `回報頁面：${page || '未指定'}\n\n問題描述：\n${description}`,
      status: '尚未處理',
      priority: '低',
      supportOwner: '',
      salesOwner: '',
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('bug-report error:', err)
    return NextResponse.json({ error: '回報失敗，請稍後再試' }, { status: 500 })
  }
}
