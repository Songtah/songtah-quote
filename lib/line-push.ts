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
