/**
 * 「機構代碼」的格式分流 —— 醫事監控判定的第一道關卡。
 *
 * 為什麼需要:客戶主檔的機構代碼欄從來沒驗過格式,快照端卻有格式檢查,
 * 兩邊不對稱造成兩種長期誤判——
 *   1. 學術機構用的是 4 碼代碼(0001 臺大牙醫系、M010 國防醫學大學…共 16 筆),
 *      永遠不會出現在衛福部 BAS 的院所清單裡,卻被當成「代碼消失」列入疑似歇業。
 *   2. 有人在代碼欄填「未立案」這種說明文字(2 筆),同樣月月出現在疑似歇業。
 * 這兩類都不是歇業,混在名單裡會讓真正要查證的 65 筆失去可信度。
 */
export type InstitutionCodeKind =
  | 'bas'       // 衛福部 BAS／健保院所代碼:5–20 碼英數,可與快照比對
  | 'academic'  // 學術機構代碼:1–4 碼英數,不在 BAS 體系,不做歇業判定
  | 'invalid'   // 非代碼(中文說明、符號…),需人工補正
  | 'empty'     // 未填

export function classifyInstitutionCode(code: string | null | undefined): InstitutionCodeKind {
  const value = (code ?? '').trim()
  if (!value) return 'empty'
  if (/^[A-Za-z0-9]{5,20}$/.test(value)) return 'bas'
  if (/^[A-Za-z0-9]{1,4}$/.test(value)) return 'academic'
  return 'invalid'
}

/** 只有這種代碼才該拿去跟 BAS 快照比對 */
export function isBasComparableCode(code: string | null | undefined): boolean {
  return classifyInstitutionCode(code) === 'bas'
}
