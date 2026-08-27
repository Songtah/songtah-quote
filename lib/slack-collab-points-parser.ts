/**
 * 解析 Slack「業務開發-討論區」的助攻回報，並自動判定助攻項目。
 * 比照 slack-cross-support-parser.ts 的自由文字打標籤做法。
 *
 * 格式（第一行固定標記，其餘欄位不限順序、可省略）：
 *   助攻
 *   業務：Sam            ← 助攻者（積分歸屬）
 *   受助：Amy            ← 被協助的業務
 *   客戶：OO牙醫診所
 *   案件：2026-Q3-XX案
 *   說明：協助挽回流失客戶，陪同拜訪三次
 *
 * 「項目」可自己指定；沒指定就依「說明＋事由」文字自動判定。
 *
 * 重要：自動判定只產生「建議項目」，紀錄一律以「待確認」建檔，
 * 仍須經受助業務確認、總經理認列（辦法第八章），且兩關都能改項目。
 * 系統的猜測不會直接變成發錢依據。
 */
import { COLLAB_ITEMS, type CollabItem } from './notion/collab-points'

export type CollabMessage = {
  helper: string
  helped: string
  customerName: string
  caseKey: string
  note: string
  item: CollabItem
  /** true = 由系統依文字判定；false = 訊息中明確指定 */
  autoClassified: boolean
}

export function isCollabReport(text: string): boolean {
  return /助攻/.test(text)
}

function getField(text: string, label: string): string {
  const m = text.match(new RegExp(`${label}[：:]\\s*(.+)`))
  return m ? m[1].trim() : ''
}

/**
 * 判定規則：由「最具體、分數最高」往下試，先命中先算。
 * 順序很重要——「介紹」同時出現在決策者引薦與產品簡報，
 * 靠決策者關鍵字（院長/老闆…）先攔截，才不會被簡報那條吃掉。
 */
const RULES: { item: CollabItem; keywords: RegExp }[] = [
  { item: '協助解決重大問題', keywords: /挽回|流失|重大|危機|客訴|搶救|急件|止血/ },
  { item: '介紹認識院長、老闆或決策者', keywords: /院長|老闆|決策者|負責人|引薦|牽線|主任|技師長/ },
  { item: '跨區支援擺攤或課程', keywords: /擺攤|展覽|展會|攤位|研討|講習|課程/ },
  { item: '協助產品教育訓練', keywords: /教育訓練|教學|培訓|訓練|上機|操作說明|教操作/ },
  { item: '陪同簡報介紹、Demo', keywords: /簡報|[Dd]emo|示範|試機|陪同|介紹產品|產品介紹/ },
  { item: '提供有效客戶基本聯絡資訊', keywords: /聯絡資訊|聯絡方式|聯繫方式|窗口|名單|電話|提供資訊/ },
]

/** 依文字判定助攻項目；都沒命中則回退到「其他由總經理認定具實質效益」 */
export function classifyCollabItem(text: string): { item: CollabItem; matched: boolean } {
  for (const rule of RULES) {
    if (rule.keywords.test(text)) return { item: rule.item, matched: true }
  }
  return { item: '其他由總經理認定具實質效益', matched: false }
}

export function parseCollabMessage(rawText: string): CollabMessage | null {
  const text = rawText.replace(/^```|```$/g, '').trim()
  if (!isCollabReport(text)) return null

  const helper = getField(text, '業務') || getField(text, '助攻者')
  const helped = getField(text, '受助') || getField(text, '協助') || getField(text, '對象')
  if (!helper || !helped) return null

  const note = getField(text, '說明') || getField(text, '事由') || getField(text, '內容')

  // 訊息中明確寫「項目：」且對得上項目表時，尊重填寫者，不做自動判定
  const explicit = getField(text, '項目')
  if (explicit && explicit in COLLAB_ITEMS) {
    return {
      helper, helped, customerName: getField(text, '客戶'), caseKey: getField(text, '案件'),
      note, item: explicit as CollabItem, autoClassified: false,
    }
  }

  const { item } = classifyCollabItem(`${note} ${explicit}`)
  return {
    helper, helped, customerName: getField(text, '客戶'), caseKey: getField(text, '案件'),
    note, item, autoClassified: true,
  }
}
