/**
 * GET /support/manual —— 系統操作手冊（登入後才能看）
 *
 * 手冊原文在 content/support/manual.html，是唯一來源：支援中心頁以 iframe 嵌入，
 * 也可直接在新分頁開啟。刻意不放 public/，否則未登入也能讀到內部作業流程。
 * 系統介面只有淺色，手冊固定為淺色主題，避免深色系統設定下與周圍畫面不一致。
 */
import { readFileSync } from 'fs'
import path from 'path'
import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

let cached: string | null = null

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.redirect(new URL('/login', req.url))

  cached ??= readFileSync(path.join(process.cwd(), 'content', 'support', 'manual.html'), 'utf8')
  const html = `<!doctype html>
<html lang="zh-Hant-TW" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<style>html{color-scheme:light}</style>
</head>
<body>
${cached}
</body>
</html>`
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Frame-Options': 'SAMEORIGIN',
    },
  })
}
