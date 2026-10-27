/**
 * GET /r/[代碼] —— 報名頁短網址，轉到 /register/[活動 id]（代碼規則見 lib/online-registration shortCodeOf）。
 * 公開：只轉址到開放線上報名的活動，查無或撞號一律 404，不透露任何活動資訊。
 */
import { NextResponse } from 'next/server'
import { findOpenEventIdByShortCode } from '@/lib/notion/events'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: { code: string } }) {
  const id = await findOpenEventIdByShortCode(params.code.toLowerCase()).catch(() => null)
  if (!id) return new NextResponse('找不到這個報名頁', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  return NextResponse.redirect(new URL(`/register/${id}`, req.url), 307)
}
