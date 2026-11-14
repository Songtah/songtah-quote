/**
 * lib/privacy-notice.ts — 問卷蒐集個人資料的告知事項（個人資料保護法第 8 條）與同意文字。
 * 改內容時一定要換 PRIVACY_NOTICE_VERSION：每筆回覆記下同意的版本，日後才知道當時看到的是哪一版。
 * 2026-11-14 依使用者要求建立；未經律師審閱，正式大量使用前建議請律師看過。
 */
import { COMPANY } from '@/lib/quote-model'

export const PRIVACY_NOTICE_VERSION = '2026-11-14b'   // b＝行銷同意改為必勾

export const PRIVACY_NOTICE_TITLE = '個人資料蒐集告知暨同意書'

/** 告知事項，依個資法第 8 條第 1 項各款順序 */
export const PRIVACY_NOTICE_ITEMS: { title: string; body: string }[] = [
  { title: '蒐集者', body: `${COMPANY.name}（以下稱本公司）。` },
  { title: '蒐集目的', body: '活動辦理與問卷調查、贈品發放、客戶管理與服務、產品及活動資訊提供（行銷），以及統計與研究分析。' },
  { title: '個人資料類別', body: '姓名、電話、電子信箱、職稱、服務單位名稱與所在地區，以及您在問卷中的回答。' },
  { title: '利用期間', body: '上述蒐集目的存續期間，或依相關法令規定、契約約定應保存的期間。' },
  { title: '利用地區', body: '中華民國境內。' },
  { title: '利用對象', body: '本公司，以及受本公司委託處理上述事務的協力廠商（僅限完成委託事項所需範圍）。' },
  { title: '利用方式', body: '以電子或書面方式，在蒐集目的範圍內處理與利用，包括聯繫、寄送產品與活動資訊、統計分析。' },
  { title: '您的權利', body: `您可以向本公司請求查詢或閱覽、製給複製本、補充或更正、停止蒐集處理或利用，以及刪除您的個人資料。請洽 ${COMPANY.email}，或來電 ${COMPANY.tel}。` },
  { title: '不提供的影響', body: '您可以自由選擇是否提供個人資料；但若未提供必填欄位，將無法完成本問卷與領取贈品。' },
]

export const PRIVACY_CONSENT_LABEL = '我已閱讀並了解上述個人資料蒐集告知事項，同意本公司在上述目的範圍內蒐集、處理及利用我的個人資料。'
/** 行銷同意（2026-11-14 使用者決定改為必勾；個資法第 20 條：當事人仍可隨時要求停止，必須照辦） */
export const PRIVACY_MARKETING_LABEL = '我願意收到崧達的產品與活動資訊（可隨時通知我們停止寄送）。'
