/**
 * POST /api/admin/visit-reactions —— 用 Claude 判讀客情的「客戶反應」（只回結果，不寫入）
 *
 * Body: { ids: string[] }（客情頁面 id，一次最多 25 筆）
 * 用途：新判讀邏輯的驗證集與全庫重跑的試跑（差異報表）。金鑰只在伺服器端，不經本機。
 * 會產生 Anthropic API 費用（Haiku，每筆約台幣 0.01 元），故限中央管理。規則見 lib/visit-reaction-ai.ts。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { classifyVisitReaction } from '@/lib/visit-reaction-ai'
import { notion, notionCallWithRetry, getText, getTitle, getSelect, getDate } from '@/lib/notion/shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export const POST = withApiAuth('central-management', async (req: NextRequest) => {
  let body: { ids?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: '格式錯誤' }, { status: 400 }) }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string' && /^[0-9a-f-]{32,36}$/i.test(x)).slice(0, 25) : []
  if (!ids.length) return NextResponse.json({ error: '缺少 ids' }, { status: 400 })
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: '尚未設定 ANTHROPIC_API_KEY' }, { status: 503 })

  const results: any[] = []
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(ids.slice(i, i + 5).map(async (id) => {
      try {
        const page: any = await notionCallWithRetry('visit-reactions:get', () => notion.pages.retrieve({ page_id: id }))
        const text = getText(page, '拜訪內容')
        const r = await classifyVisitReaction(text)
        return {
          id, date: getDate(page, '日期'), name: getTitle(page, '單位名稱'),
          old: getSelect(page, '客戶反應'), oldContact: getText(page, '聯絡人'),
          ...(r ? { reaction: r.reaction, evidence: r.evidence, confidence: r.confidence, contact: r.contact, note: r.note } : { error: '判讀失敗' }),
        }
      } catch (e: any) {
        return { id, error: e?.message ?? '讀取失敗' }
      }
    }))
    results.push(...batch)
  }
  return NextResponse.json({ results })
})
