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
 *  - assign  → **中央管理限定**：把客戶指派給任一位業務（不限建議對象）。
 *              規則比照公司客戶調度（/api/customers/assign-company）：指派對象必須是
 *              可承接新客戶的在職業務；只寫負責業務仍空白者（零覆蓋）；已歇業不指派；寫稽核。
 */
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import {
  listClaimSuggestions, addDismissed, pruneClaimSuggestions,
  loadClaimContext, decideClaim, TERRITORY_TIERS,
} from '@/lib/notion/visit-claim'
import { assignSalesperson, listCustomersByArea, getSystemCustomerById } from '@/lib/notion/customers'
import { canAcceptNewBusiness, getSystemUsers } from '@/lib/notion/accounts'
import { isInactiveCustomer } from '@/lib/customer-status'
import { createCrossSupportLog } from '@/lib/notion/cross-support'
import { getAuditActor, getAuditRequestContext, logAuditEvent } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MANAGER_TYPES = new Set(['中央管理', '總經理', '行政'])
const isManager = (session: any) =>
  session.user?.role === 'admin' || MANAGER_TYPES.has(session.user?.accountType ?? '')
/** 指派客戶給業務屬於中央調度，與 CLAUDE.md「公司客戶可經中央管理專屬流程指派」同一權限 */
const isCentralManagement = (session: any) =>
  session.user?.role === 'admin' || session.user?.accountType === '中央管理'

/** 可被指派的業務：在職、業務帳號、且為「全面開發」承接模式 */
async function listAssignableSalespeople(): Promise<string[]> {
  const users = await getSystemUsers().catch(() => [])
  return users
    .filter((u) => u.accountType === '業務' && canAcceptNewBusiness(u))
    .map((u) => u.name)
    .sort((a, b) => a.localeCompare(b, 'zh-TW'))
}

export const GET = withApiAuth({ module: 'bd', action: 'view' }, async (req: NextRequest, _ctx, session) => {
  try {
    const me = session.user?.name?.trim() ?? ''
    const requested = req.nextUrl.searchParams.get('salesperson')?.trim() ?? ''
    const manager = isManager(session)
    // 業務一律只看自己的。主管沒指定業務時看**全體**——中央管理／admin 帳號沒有
    // 對應的「業務人員」值，若退回看自己會永遠是空的。
    const focus = manager ? (requested || undefined) : me
    const items = await listClaimSuggestions(focus)
    const salespeople = manager
      ? Array.from(new Set(items.map((i) => i.salesperson))).sort((a, b) => a.localeCompare(b, 'zh-TW'))
      : undefined
    const canAssign = isCentralManagement(session)
    return NextResponse.json({
      focus: focus ?? '', viewingAll: manager && !requested,
      canActOnContested: manager, items, salespeople,
      canAssign,
      assignableSalespeople: canAssign ? await listAssignableSalespeople() : undefined,
    })
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
    if (!['claim', 'support', 'claim-all-in-territory', 'assign'].includes(action)) {
      return NextResponse.json({ error: '動作必須是 claim、support、claim-all-in-territory 或 assign' }, { status: 400 })
    }

    // ── 中央管理指派 ─────────────────────────────────────────────────────────
    if (action === 'assign') {
      if (!isCentralManagement(session)) {
        return NextResponse.json({ error: '只有中央管理可以指派客戶給業務' }, { status: 403 })
      }
      const assignTo = String(body.assignTo ?? '').trim()
      if (!assignTo) return NextResponse.json({ error: '請選擇要指派的業務' }, { status: 400 })

      const assignable = await listAssignableSalespeople()
      if (!assignable.includes(assignTo)) {
        return NextResponse.json({ error: `${assignTo} 不是可承接新客戶的在職業務` }, { status: 400 })
      }

      // 寫入前重讀客戶當下狀態
      const customer = await getSystemCustomerById(customerId)
      if (!customer) return NextResponse.json({ error: '找不到該客戶' }, { status: 404 })
      if (customer.salesperson) {
        await pruneClaimSuggestions({ customerIds: [customerId] })
        return NextResponse.json({ error: `此客戶已由 ${customer.salesperson} 負責，未變更` }, { status: 409 })
      }
      if (isInactiveCustomer(customer.status)) {
        return NextResponse.json({ error: `此客戶機構狀態為「${customer.status}」，不指派` }, { status: 409 })
      }

      // assignSalesperson 仍會逐筆重讀、只寫負責業務空白者（零覆蓋鐵則）
      const result = await assignSalesperson([customer.id], assignTo)
      await pruneClaimSuggestions({ customerIds: [customerId] })
      const suggestedTo = String(body.suggestedTo ?? '').trim()
      await logAuditEvent({
        module: 'bd', action: 'update', entityType: 'claim-suggestion',
        entityId: customerId, entityTitle: customer.name,
        summary: `中央管理將 ${customer.name}（${customer.city}${customer.district}）指派給 ${assignTo}`
          + (suggestedTo && suggestedTo !== assignTo ? `（系統原建議 ${suggestedTo}）` : ''),
        actor: getAuditActor(session), request: getAuditRequestContext(req),
        after: { action: 'assign', assignTo, suggestedTo, assigned: result.assigned },
      }).catch(() => {})

      if (result.assigned === 0) {
        return NextResponse.json({ error: '指派未生效，該客戶剛剛已被其他人負責' }, { status: 409 })
      }
      return NextResponse.json({ ok: true, action: 'assign', assignTo })
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
        .filter((s) => TERRITORY_TIERS.has(s.tier) && !s.contested)
      if (pool.length === 0) {
        return NextResponse.json({ error: '沒有可批次認領的轄區內待辦' }, { status: 409 })
      }
      const batch = pool.slice(0, 100)
      if (dryRun) {
        return NextResponse.json({
          dryRun: true, total: pool.length, willClaim: batch.length,
          excludedContested: (await listClaimSuggestions(salesperson))
            .filter((s) => TERRITORY_TIERS.has(s.tier) && s.contested).length,
          sample: batch.slice(0, 20).map((s) => ({
            name: s.customerName, area: `${s.customerCity}${s.customerDistrict}`, visitCount: s.visitCount,
          })),
        })
      }
      // assignSalesperson 逐筆重讀、只寫負責業務空白者，不需要在這裡再擋一次
      const ids = batch.map((s) => s.customerId)
      const result = await assignSalesperson(ids, salesperson)
      await pruneClaimSuggestions({ customerIds: ids })
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
      await pruneClaimSuggestions({ customerIds: [customerId], salesperson })
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
      await pruneClaimSuggestions({ customerIds: [customerId] })
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
    await pruneClaimSuggestions({ customerIds: [customerId] })
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
