import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { renderToBuffer } from '@react-pdf/renderer'
import { getQuote } from '@/lib/notion'
import { QuoteDocument } from '@/lib/pdf'
import { authOptions } from '@/lib/auth'
import React from 'react'

// @react-pdf/renderer and Node.js `path` require the Node.js runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 已核准：公開下載（客戶從分享頁按下載，維持既有行為）。
 * 未核准：只有登入的內部人員可看，並加上「內部預覽」浮水印——方便業務送審前確認版面，
 * 但不會被當成正式報價單交給客戶。
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const quote = await getQuote(params.id)
    if (!quote) return NextResponse.json({ error: '找不到報價單' }, { status: 404 })

    const approved = quote.status === '已核准'
    if (!approved) {
      const session = await getServerSession(authOptions)
      if (!session) {
        return NextResponse.json({ error: '此報價單尚未核准，無法產生 PDF。' }, { status: 403 })
      }
    }

    const buffer = await renderToBuffer(
      <QuoteDocument quote={quote} watermark={approved ? undefined : `內部預覽 · ${quote.status}`} />,
    )
    const filename = `${approved ? '' : '【預覽】'}報價單_${quote.quoteNumber}_${quote.customerName}.pdf`

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        // inline：瀏覽器直接開啟預覽，需要時再從檢視器下載
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (err) {
    console.error('PDF generation error:', err)
    return NextResponse.json({ error: 'PDF 產生失敗' }, { status: 500 })
  }
}
