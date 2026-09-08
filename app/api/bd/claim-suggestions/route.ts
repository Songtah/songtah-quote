/**
 * GET  /api/bd/claim-suggestions          我的待認領建議（主管可用 ?salesperson= 看指定業務）
 * POST /api/bd/claim-suggestions          處理一筆建議：認領 或 標記為跨區支援
 *
 * 依三層機制（見 lib/notion/visit-claim.ts）：轄區內由建檔流程自動認領，
 * 這支只處理第二、三層——轄區外／未設轄區者的「建議」，一律需要人確認。
 *
 * 兩個動作都會寫入正式資料，故各自重驗：
 *  - claim   → 逐筆重讀客戶，只寫「負責業務仍空白」者；有爭議（他人也拜訪過）需主管操作。
 *  - support → 建立跨區支援報備（順手補上那個沒人主動填的機制），並記入否決名單。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import {
  listClaimSuggestions, addDismissed, invalidateClaimSuggestions,
  loadClaimContext, decideClaim,
} from '@/lib/notion/visit-claim'
import { assignSalesperson, listCustomersByArea } from '@/lib/notion/customers'
import { createCrossSupportLog } from '@/lib/notion/cross-support'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MANAGER_TYPES = new Set(['中央管理', '總經理', '行政'])
const isManager = (session: any) =>
  session.user?.role === 'admin' || MANAGER_TYPES.has(session.user?.accountType ?? '')

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (req: NextRequest, _ctx, session) => {
  try {
    const me = session.user?.name?.trim() ?? ''
    const requested = req.nextUrl.searchParams.get('salesperson')?.trim() ?? ''
    // 只有主管能看別人的建議；業務一律只看自己的
    const focus = requested && isManager(session) ? requested : me
    const items = await listClaimSuggestions(focus)
    return NextResponse.json({ focus, canActOnContested: isManager(session), items })
  } catch (error) {
    console.error('claim-suggestions GET error:', error)
    return NextResponse.json({ error: '讀取待認領建議失敗' }, { status: 500 })
  }
})

export const POST = withApiAuth({ module: 'bd', action: 'edit' }, async (req: NextRequest, _ctx, session) => {
  try {
    const me = session.user?.name?.trim() ?? ''
    if (!me) return NextResponse.json({ error: '無法辨識使用者' }, { status: 400 })

    const body = await req.json()
    const action = String(body.action ?? '')
    const dryRun = body.dryRun === true
    const customerId = String(body.customerId ?? '').trim()
    const salesperson = String(body.salesperson ?? '').trim() || me
    const note = String(body.note ?? '').trim()
    if (!customerId && action !== 'claim-all-in-territory') {
      return NextResponse.json({ error: '缺少客戶' }, { status: 400 })
    }
    if (action !== 'claim' && action !== 'support' && action !== 'claim-all-in-territory') {
      return NextResponse.json({ error: '動作必須是 claim、support 或 claim-all-in-territory' }, { status: 400 })
    }
    // 業務只能處理自己的建議
    if (salesperson !== me && !isManager(session)) {
      return NextResponse.json({ error: '只能處理自己的待認領建議' }, { status: 403 })
    }

    // ── 批次認領「轄區內待辦」──────────────────────────────────────────────
    // 只處理 in-territory-backlog：轄區比對是確定的，不涉及判斷。
    // 有爭議者（他人也拜訪過）一律排除，仍需逐筆由主管處理。
    // 比照 /api/territories/[id]/claim：先 dryRun 預覽再寫入，單次上限 100 家。
    if (action === 'claim-all-in-territory') {
      const pool = (await listClaimSuggestions(salesperson))
        .filter((s) => s.tier === 'in-territory-backlog' && !s.contested)
      if (pool.length === 0) {
        return NextResponse.json({ error: '沒有可批次認領的轄區內待辦' }, { status: 409 })
      }
      const batch = pool.slice(0, 100)
      if (dryRun) {
        return NextResponse.json({
          dryRun: true, total: pool.length, willClaim: batch.length,
          excludedContested: (await listClaimSuggestions(salesperson))
            .filter((s) => s.tier === 'in-territory-backlog' && s.contested).length,
          sample: batch.slice(0, 20).map((s) => ({
            name: s.customerName, area: `${s.customerCity}${s.customerDistrict}`, visitCount: s.visitCount,
          })),
        })
      }
      // assignSalesperson 逐筆重讀、只寫負責業務空白者，不需要在這裡再擋一次
      const ids = batch.map((s) => s.customerId)
      const result = await assignSalesperson(ids, salesperson)
      await invalidateClaimSuggestions()
      await logAuditEvent({
        module: 'bd', action: 'update', entityType: 'claim-suggestion',
        entityId: `bulk:${salesperson}`, entityTitle: `${salesperson} 批次認領轄區內待辦`,
        summary: `${salesperson} 批次認領轄區內待辦 ${result.assigned} 家（送出 ${ids.length} 家）`,
        actor: getAuditActor(session), request: getAuditRequestContext(req),
        after: { assigned: result.assigned, skipped: result.skipped.length, remaining: pool.length - batch.length },
      }).catch(() => {})
      return NextResponse.json({
        ok: true, action, assigned: result.assigned,
        skipped: result.skipped.length, remaining: Math.max(0, pool.length - batch.length),
      })
    }

    const suggestion = (await listClaimSuggestions(salesperson))
      .find((s) => s.customerId === customerId.replace(/-/g, ''))
    if (!suggestion) {
      return NextResponse.json({ error: '這筆建議已不存在（可能已被處理或客戶已有人負責）' }, { status: 409 })
    }

    if (action === 'support') {
      await createCrossSupportLog({
        reportingSalesperson: salesperson,
        customerId,
        customerName: suggestion.customerName,
        supportDate: suggestion.lastVisitDate || new Date().toISOString().slice(0, 10),
        reason: note || '客情回報後由業務確認為跨區支援，非開發',
        originalSalesperson: '',
        rawMessage: `由待認領建議標記；${salesperson} 回報過此客戶 ${suggestion.visitCount} 次`,
      }).catch((error) => {
        // 報備建檔失敗不該讓否決卡住——否決名單仍要寫，否則同一筆會一直跳出來
        console.error('cross-support log create failed:', error)
      })
      await addDismissed(salesperson, customerId)
      await invalidateClaimSuggestions()
      await logAuditEvent({
        module: 'bd', action: 'update', entityType: 'claim-suggestion',
        entityId: customerId, entityTitle: suggestion.customerName,
        summary: `${salesperson} 將 ${suggestion.customerName} 標記為跨區支援，不認領`,
        actor: getAuditActor(session), request: getAuditRequestContext(req),
        after: { action: 'support', visitCount: suggestion.visitCount, note },
      }).catch(() => {})
      return NextResponse.json({ ok: true, action: 'support' })
    }

    // ── claim ──────────────────────────────────────────────────────────────
    // 第三層：歸屬有爭議（該客戶另有其他業務拜訪過）→ 只有主管能拍板
    if (suggestion.contested && !isManager(session)) {
      return NextResponse.json({
        error: `${suggestion.otherVisitors.join('、')} 也拜訪過這家客戶，認領需由主管核可`,
      }, { status: 403 })
    }

    // 重驗：認領前重讀該區客戶，確認負責業務仍為空白且非公司/盤商
    const fresh = (await listCustomersByArea({
      city: suggestion.customerCity, district: suggestion.customerDistrict,
    })).find((c) => c.id.replace(/-/g, '') === customerId.replace(/-/g, ''))
    if (!fresh) return NextResponse.json({ error: '找不到該客戶' }, { status: 404 })
    if (fresh.salesperson) {
      await invalidateClaimSuggestions()
      return NextResponse.json({ error: `此客戶已由 ${fresh.salesperson} 負責` }, { status: 409 })
    }
    // 再跑一次完整判定，確保承接模式等把關在寫入當下仍成立
    const decision = decideClaim({
      salesperson, customer: fresh, context: await loadClaimContext(),
      visitCount: suggestion.visitCount, otherVisitors: suggestion.otherVisitors,
    })
    if (decision.action === 'skip') {
      return NextResponse.json({ error: `不可認領：${decision.reason}` }, { status: 409 })
    }

    // assignSalesperson 內部仍會逐筆重讀、只寫空白者（零覆蓋鐵則）
    const result = await assignSalesperson([fresh.id], salesperson)
    await invalidateClaimSuggestions()
    await logAuditEvent({
      module: 'bd', action: 'update', entityType: 'claim-suggestion',
      entityId: customerId, entityTitle: suggestion.customerName,
      summary: `${salesperson} 由客情回報建議認領 ${suggestion.customerName}（${suggestion.customerCity}${suggestion.customerDistrict}）`,
      actor: getAuditActor(session), request: getAuditRequestContext(req),
      after: { action: 'claim', assigned: result.assigned, visitCount: suggestion.visitCount, contested: suggestion.contested },
    }).catch(() => {})

    if (result.assigned === 0) {
      return NextResponse.json({ error: '認領未生效，該客戶剛剛已被指派' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, action: 'claim', assigned: result.assigned })
  } catch (error: any) {
    console.error('claim-suggestions POST error:', error)
    return NextResponse.json({ error: error?.message ?? '處理失敗' }, { status: 500 })
  }
})
