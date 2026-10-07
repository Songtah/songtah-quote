/**
 * POST /api/quotes/preview-pdf — 編輯中（尚未存檔）的報價單直接預覽 PDF。
 * 不寫入任何資料；只給有報價編輯權限的內部人員，並加上「預覽」浮水印。
 */
import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { withApiAuth } from '@/lib/api-auth'
import { QuoteDocument } from '@/lib/pdf'
import { parseQuoteInput } from '@/lib/quote-input'
import { computeQuoteTotals } from '@/lib/quote-model'
import type { Quote } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withApiAuth({ module: 'quote', action: 'edit' }, async (req: NextRequest) => {
  try {
    const body = await req.json()
    const { input, error } = parseQuoteInput(body)
    if (!input) return NextResponse.json({ error }, { status: 400 })
    const quote: Quote = {
      ...input,
      id: '',
      quoteNumber: typeof body?.quoteNumber === 'string' && body.quoteNumber ? body.quoteNumber : '（存檔後產生）',
      total: computeQuoteTotals(input).total,
      status: '草稿',
      shareUrl: '',
      createdAt: new Date().toISOString(),
    }
    const buffer = await renderToBuffer(<QuoteDocument quote={quote} watermark="預覽 · 尚未存檔" />)
    return new NextResponse(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('preview pdf error:', err)
    return NextResponse.json({ error: 'PDF 預覽失敗' }, { status: 500 })
  }
})
