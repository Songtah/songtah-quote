/**
 * LINE Messaging API — push message to a group or user
 *
 * 設定方式：
 * 1. 前往 https://developers.line.biz/ 建立 Messaging API channel
 * 2. 將 Channel Access Token 填入 LINE_CHANNEL_ACCESS_TOKEN
 * 3. 將 Bot 加入群組後，透過 webhook 取得 Group ID，填入 LINE_GROUP_ID
 *    （或填入個別業務的 User ID → LINE_USER_IDS，逗號分隔）
 */

const LINE_PUSH_URL   = 'https://api.line.me/v2/bot/message/push'
const LINE_MULTICAST  = 'https://api.line.me/v2/bot/message/multicast'

/**
 * 【LINE 推播總開關】2026-11-06 起依老闆決定全面停用（團隊改在企業系統內接收通知）。
 * 為 true 時 pushLineMessage／multicastLineMessage 一律不打 LINE API，只留 log。
 * 要恢復：改成 false，並確認下方白名單的環境變數都填的是公司內部群組。
 */
export const LINE_PUSH_DISABLED = true

/**
 * 推播白名單（2026-11-05 事故後的鐵則）
 * 官方帳號同時在公司內部群組與客戶群組裡。推播收件人一律只能是環境變數明確寫死的 ID：
 *   LINE_GROUP_ID（業務日報群）、TECH_MANAGER_LINE_ID（售後服務／報修群）、LINE_USER_IDS（個別業務）。
 * 不得用群組名稱、最近活動時間或 webhook 記到的任何 ID 推導收件人；白名單外一律拒送（fail-closed）。
 */
function allowedRecipients(): Set<string> {
  const ids = [
    process.env.LINE_GROUP_ID,
    process.env.TECH_MANAGER_LINE_ID,
    ...(process.env.LINE_USER_IDS ?? '').split(','),
  ].map((s) => (s ?? '').trim()).filter(Boolean)
  return new Set(ids)
}

export function isAllowedLineRecipient(id: string): boolean {
  return allowedRecipients().has(id)
}

function assertAllowed(ids: string[]) {
  const allowed = allowedRecipients()
  const bad = ids.filter((id) => !allowed.has(id))
  if (bad.length) {
    throw new Error(`LINE 推播收件人不在白名單（僅允許環境變數明確指定的 ID），拒送：${bad.map((b) => b.slice(0, 6) + '…').join(', ')}`)
  }
}

export interface LineTextMessage {
  type: 'text'
  text: string
}

export type LineMessage = LineTextMessage

/** Push a single message to one recipient (group or user ID) */
export async function pushLineMessage(
  to: string,
  text: string
): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN 尚未設定')
  if (!to)    throw new Error('LINE 收件人 ID 尚未設定')
  if (LINE_PUSH_DISABLED) { console.info('[line-push] 推播已停用，略過:', text.slice(0, 40)); return }
  assertAllowed([to])

  const res = await fetch(LINE_PUSH_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text }],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`LINE push 失敗 (${res.status}): ${body}`)
  }
}

/**
 * Push to multiple individual users.
 * LINE_USER_IDS = comma-separated LINE User IDs
 */
export async function multicastLineMessage(
  userIds: string[],
  text: string
): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN 尚未設定')
  if (!userIds.length) throw new Error('沒有設定任何 LINE User ID')
  if (LINE_PUSH_DISABLED) { console.info('[line-push] 推播已停用，略過 multicast:', text.slice(0, 40)); return }
  assertAllowed(userIds)

  const res = await fetch(LINE_MULTICAST, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      to:       userIds,
      messages: [{ type: 'text', text }],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`LINE multicast 失敗 (${res.status}): ${body}`)
  }
}

/**
 * Smart send: tries group first, falls back to individual user IDs
 */
export async function sendDailyReport(text: string): Promise<string> {
  if (LINE_PUSH_DISABLED) return 'LINE 推播已停用（通知改在企業系統內查看）'
  const groupId  = process.env.LINE_GROUP_ID
  const userIds  = (process.env.LINE_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)

  if (groupId) {
    await pushLineMessage(groupId, text)
    return `已推播至 LINE 群組`
  }

  if (userIds.length) {
    await multicastLineMessage(userIds, text)
    return `已推播至 ${userIds.length} 位業務`
  }

  throw new Error('請在 .env.local 設定 LINE_GROUP_ID 或 LINE_USER_IDS')
}
