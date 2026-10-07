/**
 * POST /api/clinic-monitor/lookup
 *
 * 逐筆即時查衛福部醫事查詢系統（BAS），回機構代碼與開業狀態，並給建議。
 * 用於「資料不一致」「歇業候選」的人工確認（只標示建議，不自動改 CRM）。
 *
 * 查詢順序（2026-10-07）：
 *   1. 有機構代碼且 bas-cache 有該代碼的 BAS_SEQ → **直開衛福部詳細頁**讀真實開業狀態。
 *      名稱搜尋只回開業機構，已歇業／停業者用名稱永遠查不到；詳細頁則仍保留、讀得到狀態。
 *   2. 沒有代碼、快取查無、或詳細頁抓取失敗 → 退回原本的名稱搜尋。
 *
 * Body: { name: string, code?: string, kind?: string }
 *   name  客戶/機構名稱（查詢用）
 *   code  系統現有機構代碼（用於比對建議）
 *   kind  機構類別（'2'=牙體技術所、'1'=醫院/診所）；省略則自動嘗試
 *   city  客戶所在縣市；**有給就只採用同縣市結果，不跨縣市**（跨縣市同名多為不同家）
 *
 * Response:
 *   { found, mohwCode, status, closed, mohwName, address, candidates, suggestion }
 */

import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'
import { lookupInstitution, isClosedStatus, fetchStatusBySeq } from '@/lib/mohw-bas.mjs'
import { loadBasCacheIndex } from '@/lib/bas-cache-index'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export const POST = withApiAuth('admin', async (req: NextRequest) => {
  let name = '', code = '', customerStatus = '', city = '', kind: string | undefined
  try {
    const body = await req.json()
    name = (body.name ?? '').toString().trim()
    code = (body.code ?? '').toString().trim()
    customerStatus = (body.customerStatus ?? '').toString().trim()
    city = (body.city ?? '').toString().trim()
    kind = body.kind ? String(body.kind) : undefined
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  if (!name) return NextResponse.json({ error: '缺少機構名稱' }, { status: 400 })

  // 1. 依機構代碼直查詳細頁
  const row = code ? loadBasCacheIndex().get(code) : undefined
  if (row) {
    const d = await fetchStatusBySeq({ basSeq: row.basSeq, zoneSeq: row.zoneSeq })
    if (d?.status) {
      const status = d.status
      let form: 'closure' | 'status_mismatch' | 'ok'
      let suggestion: string
      if (/歇業|撤銷|註銷|廢止/.test(status)) {
        form = 'closure'
        suggestion = `依機構代碼直查衛福部：開業狀態「${status}」→ 建議將客戶機構狀態更新為「${/撤銷|註銷|廢止/.test(status) ? '撤銷' : '已歇業'}」。`
      } else if (/停業/.test(status)) {
        form = 'closure'
        suggestion = '依機構代碼直查衛福部：開業狀態「停業」（暫停營業，日後可能復業）→ 建議將客戶機構狀態更新為「停業」，不要標成已歇業。'
      } else if (customerStatus && isClosedStatus(customerStatus)) {
        form = 'status_mismatch'
        suggestion = `狀態不符：系統「${customerStatus}」、衛福部「${status}」→ 機構實際仍開業，建議更新客戶機構狀態。`
      } else {
        form = 'ok'
        suggestion = `依機構代碼直查衛福部：仍為「${status}」，不是歇業。此代碼不在本月牙科開業列表，可能是登記科別或機構類別異動，可視情況略過此筆。`
      }
      return NextResponse.json({
        found: true, lookupBy: 'code', form,
        mohwCode: d.code ?? code, status, closed: isClosedStatus(status),
        mohwName: d.name || row.name, address: row.address, detailUrl: row.detailUrl,
        candidates: [], partialOnly: false, partialCandidates: [], ambiguous: false,
        outOfCity: false, outOfCityCandidates: [], searchedCity: '',
        suggestion,
      })
    }
    // 詳細頁抓取失敗（逾時／WAF）→ 往下退回名稱搜尋
  }

  // 2. 名稱搜尋（只找得到開業中的機構）
  try {
    const r = await lookupInstitution({ name, kind, city })

    // 分類變更形態 + 建議（對齊形態表 6/7/8、5）
    // form: closure(6 真歇業) / recode(7 換照換碼) / unknown(8 查無) / status_mismatch(5) / ok
    let form: 'closure' | 'recode' | 'unknown' | 'status_mismatch' | 'ok'
    let suggestion: string
    if (!r.found && (r as any).partialOnly) {
      // 只有「名稱包含」的相似機構（例：查「雅德思牙醫診所」回到「左營雅德思牙醫診所」）→ 不採用
      form = 'unknown'
      const near = ((r as any).partialCandidates ?? []).map((c: any) => `${c.name}（${c.address}）`).slice(0, 3).join('、')
      suggestion = `衛福部沒有名稱完全相同的機構${near ? `；相似名稱：${near}，屬不同家、不採用` : ''}。可能已更名或歇業，建議人工確認。`
    } else if (!r.found && r.outOfCity) {
      // 同縣市查無，只有外縣市有同名 → 不採用（跨縣市同名多為不同家）
      form = 'unknown'
      const others = (r.outOfCityCandidates ?? []).map((c: any) => `${c.name}（${c.address}）`).slice(0, 3).join('、')
      suggestion = `${city} 查無此名稱${others ? `；其他縣市有同名機構：${others}，但跨縣市不採用` : ''}。建議人工至衛福部網站確認是否遷址或歇業。`
    } else if (!r.found) {
      form = 'unknown'
      suggestion = '衛福部查無此名稱，可能已更名或歇業，建議人工至衛福部網站確認。'
    } else if (isClosedStatus(r.status)) {
      form = 'closure'
      suggestion = `衛福部開業狀態為「${r.status}」→ 建議將客戶機構狀態更新為「歇業／停業」。`
    } else if ((r as any).ambiguous) {
      // 同縣市有多家名稱完全相同 → 無法判斷是哪一家，不給換碼建議
      form = 'unknown'
      suggestion = `${city} 有多家名稱完全相同的機構，無法判斷是哪一家，請人工至衛福部確認。`
    } else if (code && r.code && code !== r.code) {
      form = 'recode'
      suggestion = `機構仍開業但代碼不同（衛福部 ${r.code} ／系統 ${code}）→ 可能換照換碼，建議更新機構代碼為 ${r.code}。`
    } else if (!code && r.code) {
      form = 'recode'
      suggestion = `衛福部機構代碼為 ${r.code} → 建議補填至客戶機構代碼。`
    } else if (customerStatus && isClosedStatus(customerStatus)) {
      // 系統標記停業/歇業，但衛福部顯示開業 → 狀態不符（形態 5）
      form = 'status_mismatch'
      suggestion = `狀態不符：系統「${customerStatus}」、衛福部「${r.status || '開業'}」→ 機構實際仍開業，建議更新客戶機構狀態。`
    } else {
      form = 'ok'
      suggestion = `衛福部開業狀態「${r.status || '—'}」、機構代碼 ${r.code || '—'} 與系統一致，無需變更。`
    }

    return NextResponse.json({
      found:     r.found,
      form,
      mohwCode:  r.code,
      status:    r.status,
      closed:    isClosedStatus(r.status),
      mohwName:  r.name,
      address:   r.address,
      candidates: r.candidates,
      partialOnly: (r as any).partialOnly ?? false,
      partialCandidates: (r as any).partialCandidates ?? [],
      ambiguous: (r as any).ambiguous ?? false,
      outOfCity: r.outOfCity ?? false,
      outOfCityCandidates: r.outOfCityCandidates ?? [],
      searchedCity: city,
      lookupBy: 'name',
      detailUrl: (r as any).basSeq ? `https://ma.mohw.gov.tw/Accessibility/BASSearch/BASBasicData?BAS_SEQ=${(r as any).basSeq}&ZONE_SEQ=${(r as any).zoneSeq}` : '',
      suggestion,
    })
  } catch (e: any) {
    return NextResponse.json(
      { error: `查詢衛福部失敗：${e?.message ?? '未知錯誤'}（可能被 WAF 阻擋或逾時，請稍後再試）` },
      { status: 502 }
    )
  }
})
