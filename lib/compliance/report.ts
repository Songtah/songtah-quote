/**
 * lib/compliance/report.ts —— 產出檢舉書文字（由人審核後自行送出；系統不代送）
 *
 * 規則庫未經律師審閱前，用語固定為「疑似違反，請主管機關查明」，不寫「已違反」。
 * 受理機關只給名稱與法條依據；線上檢舉頁網址由中央管理確認後填在對象資料，系統不猜網址。
 */
import 'server-only'
import { RULE_BY_ID, RULES_SOURCE, RULES_VERIFIED_AT } from './rules'
import type { Capture, Finding, Target } from './store'

const tw = (iso: string) => new Date(Date.parse(iso) + 8 * 3600_000).toISOString().replace('T', ' ').slice(0, 19)

/** 受理機關：依業者登記所在地。醫療器材管理法第41條以醫療器材商登記所在地定管轄。 */
export function agencyFor(target: Target): string {
  const city = (target.city ?? '').trim().replace(/^台/, '臺')
  if (!city) return '（尚未確認業者登記所在地；請先查明後填入對象資料）'
  return `${city}政府衛生局`
}
export const FDA_HOTLINE = '食藥署消費者服務專線 0800-285-000'

export type ReportPackage = { agency: string; channelUrl: string; hotline: string; text: string; evidence: { url: string; capturedAt: string; sha256: string; blobUrl: string; archiveUrl: string }[] }

export function buildReport(target: Target, findings: Finding[], captures: Map<string, Capture>): ReportPackage {
  const agency = agencyFor(target)
  const lines: string[] = []
  lines.push('主旨：檢舉疑似違反醫療器材相關法規之情事，請貴局查明。', '')
  lines.push('一、被檢舉對象', `　　名稱：${target.name}${target.aliases.length ? `（${target.aliases.join('、')}）` : ''}`)
  if (target.city) lines.push(`　　登記所在地：${target.city}`)
  lines.push('', '二、疑似違規事實')
  findings.forEach((f, i) => {
    const rule = RULE_BY_ID.get(f.ruleId)
    const cap = captures.get(f.captureId)
    lines.push(
      `（${i + 1}）${rule?.title ?? f.ruleId}`,
      `　　網址：${f.url}`,
      `　　發現時間：${cap ? tw(cap.capturedAt) : tw(f.createdAt)}（臺北時間）`,
      ...(f.product ? [`　　品項：${f.product}`] : []),
      `　　頁面原文：「${f.quote}」`,
      `　　說明：${f.reason}`,
      `　　疑似違反：${rule ? `${rule.law}${rule.article}` : f.ruleId}`,
      ...(rule ? [`　　相關罰則：${rule.penalty}`] : []),
      '',
    )
  })
  lines.push('三、證據')
  const evidence: ReportPackage['evidence'] = []
  const seen = new Set<string>()
  for (const f of findings) {
    const cap = captures.get(f.captureId)
    if (!cap || seen.has(cap.id)) continue
    seen.add(cap.id)
    evidence.push({ url: cap.url, capturedAt: cap.capturedAt, sha256: cap.sha256, blobUrl: cap.blobUrl, archiveUrl: cap.archiveUrl })
    lines.push(
      `（${evidence.length}）${cap.url}`,
      `　　擷取時間：${tw(cap.capturedAt)}（臺北時間）`,
      `　　原始網頁檔 SHA-256：${cap.sha256}`,
      ...(cap.archiveUrl ? [`　　第三方存檔（Internet Archive）：${cap.archiveUrl}`] : ['　　第三方存檔：尚未取得，建議送出前另行截圖存證']),
    )
  }
  lines.push('', '四、請求事項', '　　上述內容疑似違反前揭法規，惟是否構成違規仍待貴局認定，請依法查明處理，並請對檢舉人身分保密。', '')
  lines.push('檢舉人：（請填姓名）', '聯絡方式：（請填電話或電子郵件）', `日期：${tw(new Date().toISOString()).slice(0, 10)}`)
  lines.push('', `（法條引自全國法規資料庫 ${RULES_SOURCE}，查證日期 ${RULES_VERIFIED_AT}）`)
  return { agency, channelUrl: target.channelUrl ?? '', hotline: FDA_HOTLINE, text: lines.join('\n'), evidence }
}
