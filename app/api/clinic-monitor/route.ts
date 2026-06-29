import { NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { getClinicMonitorRecords } from '@/lib/system-notion'

export const dynamic = 'force-dynamic'

// GET — 取得監控紀錄
export const GET = withApiAuth('admin', async (req: Request) => {
  const { searchParams } = new URL(req.url)
  const months = Number(searchParams.get('months') ?? 3)
  const records = await getClinicMonitorRecords(Math.min(months, 12))
  return NextResponse.json({ records })
})

// POST — 手動觸發 GitHub Actions workflow_dispatch
export const POST = withApiAuth('admin', async (req: Request) => {
  const body = await req.json().catch(() => ({}))
  const dryRun = body.dry_run === true

  const ghToken = process.env.GITHUB_PAT
  if (!ghToken) {
    return NextResponse.json({ error: '未設定 GITHUB_PAT，請聯絡系統管理員' }, { status: 500 })
  }

  // Trigger workflow dispatch
  const res = await fetch(
    'https://api.github.com/repos/Songtah/songtah-quote/actions/workflows/clinic-monitor.yml/dispatches',
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${ghToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { dry_run: dryRun ? 'true' : 'false' },
      }),
    }
  )

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `GitHub API 失敗：${res.status} ${text.slice(0, 200)}` }, { status: 502 })
  }

  return NextResponse.json({ ok: true, dry_run: dryRun })
})
