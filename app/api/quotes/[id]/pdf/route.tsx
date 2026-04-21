import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { getQuote } from '@/lib/notion'
import { QuoteDocument } from '@/lib/pdf'
import React from 'react'

// @react-pdf/renderer and Node.js `path` require the Node.js runtime.
// Without this, Next.js defaults to Edge Runtime which lacks filesystem APIs.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const quote = await getQuote(params.id)
    if (!quote) return NextResponse.json({ error: '找不到報價單' }, { status: 404 })

    const buffer = await renderToBuffer(<QuoteDocument quote={quote} />)

    const filename = `報價單_${quote.quoteNumber}_${quote.customerName}.pdf`

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    })
  } catch (err) {
    console.error('PDF generation error:', err)
    return NextResponse.json({ error: 'PDF 產生失敗' }, { status: 500 })
  }
}
