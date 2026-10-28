/** GET /api/products/spec?code=貨號 —— 報價單選產品時帶入的規格文字（lib/product-spec-lines.ts） */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { productSpecLines } from '@/lib/product-spec-lines'

export const dynamic = 'force-dynamic'

export const GET = withApiAuth({ module: 'quote', action: 'view' }, async (req: NextRequest) => {
  const code = (req.nextUrl.searchParams.get('code') ?? '').trim()
  if (!/^[A-Za-z0-9._\-/]{2,40}$/.test(code)) return NextResponse.json({ lines: [] })
  return NextResponse.json({ lines: await productSpecLines(code) })
})
