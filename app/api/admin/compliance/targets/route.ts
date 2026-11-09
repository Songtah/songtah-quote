/**
 * /api/admin/compliance/targets —— 監測對象（中央管理專用）
 * GET 列表（含各對象的存證數、待審發現數、持證數）｜POST 新增或批次匯入｜PATCH 修改｜DELETE 移除（不刪已存的證據）
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { isSafePublicUrl } from '@/lib/compliance/capture'
import { licenseIndexBuiltAt, licensesByApplicant } from '@/lib/compliance/licenses'
import { RULES, RULES_REVIEWED, RULES_VERIFIED_AT } from '@/lib/compliance/rules'
import { type SourcePlatform, type Target, type TargetSource, deleteTarget, getTarget, listCaptures, listFindings, listTargets, newId, saveTarget } from '@/lib/compliance/store'
import { EST_USD_PER_PAGE, JUDGE_MODEL } from '@/lib/compliance/judge'

export const dynamic = 'force-dynamic'

const PLATFORMS: SourcePlatform[] = ['官網', 'Facebook', 'Instagram', 'YouTube', '賣場', '其他']
const AUTO_PLATFORMS = new Set<SourcePlatform>(['官網', '賣場', '其他'])

function guessPlatform(url: string): SourcePlatform {
  const h = (() => { try { return new URL(url).hostname } catch { return '' } })()
  if (/facebook\.com|fb\.com/i.test(h)) return 'Facebook'
  if (/instagram\.com/i.test(h)) return 'Instagram'
  if (/youtube\.com|youtu\.be/i.test(h)) return 'YouTube'
  if (/shopee|ruten|momo|pchome|yahoo/i.test(h)) return '賣場'
  return '官網'
}

function cleanSources(input: unknown): TargetSource[] {
  if (!Array.isArray(input)) return []
  const out: TargetSource[] = []
  for (const s of input.slice(0, 12)) {
    const url = String((s as any)?.url ?? '').trim()
    if (!url || !isSafePublicUrl(url)) continue
    const platform = PLATFORMS.includes((s as any)?.platform) ? (s as any).platform as SourcePlatform : guessPlatform(url)
    // 有登入牆的平台一律人工貼單篇，系統不自動抓
    out.push({ id: String((s as any)?.id || newId()), platform, url, mode: AUTO_PLATFORMS.has(platform) ? 'auto' : 'manual' })
  }
  return out
}

function cleanTarget(body: any, base?: Target): Target | string {
  const name = String(body?.name ?? base?.name ?? '').trim().slice(0, 60)
  if (name.length < 2) return '請填公司名稱'
  const aliases = (Array.isArray(body?.aliases) ? body.aliases : base?.aliases ?? [])
    .map((a: unknown) => String(a).trim().slice(0, 40)).filter((a: string) => a.length >= 2).slice(0, 8)
  return {
    id: base?.id ?? newId(),
    name, aliases,
    kind: body?.kind === 'self' ? 'self' : (base?.kind ?? 'competitor'),
    status: body?.status === 'paused' ? 'paused' : body?.status === 'active' ? 'active' : (base?.status ?? 'active'),
    city: String(body?.city ?? base?.city ?? '').trim().slice(0, 10),
    channelUrl: (() => { const u = String(body?.channelUrl ?? base?.channelUrl ?? '').trim(); return u && isSafePublicUrl(u) ? u : '' })(),
    note: String(body?.note ?? base?.note ?? '').trim().slice(0, 300),
    sources: body?.sources !== undefined ? cleanSources(body.sources) : (base?.sources ?? []),
    createdAt: base?.createdAt ?? new Date().toISOString(),
    lastCaptureAt: base?.lastCaptureAt,
  }
}

export const GET = withApiAuth('central-management', async () => {
  try {
    const [targets, captures, findings] = await Promise.all([listTargets(), listCaptures(), listFindings()])
    const rows = targets.map((t) => {
      const caps = captures.filter((c) => c.targetId === t.id)
      const fs = findings.filter((f) => f.targetId === t.id)
      const held = licensesByApplicant([t.name, ...t.aliases])
      return {
        ...t,
        captureCount: caps.length,
        unjudgedCount: caps.filter((c) => !c.judgedAt).length,
        pendingFindings: fs.filter((f) => f.status === '待審').length,
        confirmedFindings: fs.filter((f) => f.status === '成立' || f.status === '已產出檢舉書').length,
        heldLicenses: held.length,
        heldActive: held.filter((l) => !l.st).length,
      }
    })
    return NextResponse.json({
      targets: rows,
      meta: {
        licenseIndexBuiltAt: licenseIndexBuiltAt(), rulesVerifiedAt: RULES_VERIFIED_AT, rulesReviewed: RULES_REVIEWED,
        ruleCount: RULES.length, judgeModel: JUDGE_MODEL, estUsdPerPage: EST_USD_PER_PAGE,
        judgeReady: Boolean(process.env.ANTHROPIC_API_KEY), blobReady: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '讀取失敗' }, { status: 500 })
  }
})

export const POST = withApiAuth('central-management', async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  try {
    // 批次匯入：{ items: [{ name, aliases?, city?, sources:[{url}] }] }；同名者略過
    if (Array.isArray(body?.items)) {
      const existing = new Set((await listTargets()).map((t) => t.name))
      let created = 0, skipped = 0
      for (const item of body.items.slice(0, 50)) {
        const t = cleanTarget(item)
        if (typeof t === 'string' || existing.has(t.name)) { skipped++; continue }
        await saveTarget(t); existing.add(t.name); created++
      }
      return NextResponse.json({ ok: true, created, skipped })
    }
    const t = cleanTarget(body)
    if (typeof t === 'string') return NextResponse.json({ error: t }, { status: 400 })
    if ((await listTargets()).some((x) => x.name === t.name)) return NextResponse.json({ error: '已有同名對象' }, { status: 409 })
    await saveTarget(t)
    return NextResponse.json({ ok: true, target: t })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '寫入失敗' }, { status: 500 })
  }
})

export const PATCH = withApiAuth('central-management', async (req: NextRequest) => {
  const body = await req.json().catch(() => ({}))
  try {
    const base = await getTarget(String(body?.id ?? ''))
    if (!base) return NextResponse.json({ error: '找不到對象' }, { status: 404 })
    const t = cleanTarget(body, base)
    if (typeof t === 'string') return NextResponse.json({ error: t }, { status: 400 })
    await saveTarget(t)
    return NextResponse.json({ ok: true, target: t })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '寫入失敗' }, { status: 500 })
  }
})

export const DELETE = withApiAuth('central-management', async (req: NextRequest) => {
  const id = req.nextUrl.searchParams.get('id') ?? ''
  try {
    if (!(await getTarget(id))) return NextResponse.json({ error: '找不到對象' }, { status: 404 })
    await deleteTarget(id)   // 只移除名單；已存的證據與發現保留
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? '刪除失敗' }, { status: 500 })
  }
})
