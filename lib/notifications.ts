/**
 * lib/notifications.ts —— 系統通知：站內通知中心（鈴鐺）＋網頁推播（手機／電腦）
 *
 * 2026-10-28 使用者選定「① 站內通知中心 ＋ ② 網頁推播」，LINE 個人通知不做。
 *
 * 收件對象用「頻道」表示，不列舉帳號（環境變數登入的 admin 不在帳號庫，列舉會漏人）：
 *   u:<帳號 id>   個人        n:<姓名>   以姓名指定（報價／訂單上記的是業務姓名）
 *   t:<帳號類型>  例 t:行政、t:中央管理、t:總經理      r:admin   系統管理員
 * 每個登入者訂閱自己的頻道（channelsOf），讀通知、收推播都依頻道。
 *
 * 最高原則（業務只回報）：通知不是待辦，不要求人回來點「已處理」。
 * 需要處理的通知帶 resolveKey，事情處理掉（例：報價已簽核）時 resolveNotifications 直接把它收掉。
 *
 * 儲存在 Redis：
 *   notif:item:<id>        通知內容（JSON，60 天）
 *   notif:ch:<頻道>         sorted set，score＝建立時間，member＝通知 id
 *   notif:key:<resolveKey>  set，這件事產生的通知 id
 *   notif:read:<帳號 id>    set，已讀的通知 id
 *   push:ch:<頻道>          hash，裝置 endpoint → 推播訂閱（JSON）
 */
import 'server-only'
import webpush from 'web-push'
import crypto from 'crypto'
import { getRedis } from '@/lib/notion/shared'

export type NotificationItem = {
  id: string
  title: string
  body: string
  href: string
  createdAt: number
  resolveKey?: string
}

const TTL_S = 60 * 86400
const MAX_PER_CHANNEL = 200
const LIST_LIMIT = 50

/** 登入者訂閱的頻道 */
export function channelsOf(user: { id?: string; name?: string | null; accountType?: string; role?: string }): string[] {
  const ch = new Set<string>()
  if (user.id) ch.add(`u:${user.id}`)
  if (user.name?.trim()) ch.add(`n:${user.name.trim()}`)
  if (user.accountType) ch.add(`t:${user.accountType}`)
  if (user.role === 'admin') ch.add('r:admin')
  return Array.from(ch)
}

let vapidReady: boolean | null = null
function pushReady(): boolean {
  if (vapidReady !== null) return vapidReady
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY
  vapidReady = !!(pub && priv)
  if (vapidReady) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://songtah-quote.vercel.app', pub!, priv!)
  return vapidReady
}
export const pushPublicKey = () => (pushReady() ? process.env.VAPID_PUBLIC_KEY! : '')

/**
 * 發通知給一或多個頻道：寫入通知中心並推播到訂閱的裝置。永不 throw（通知失敗不能讓主流程失敗）。
 * 同一個 resolveKey 已有未收掉的通知時不重發（例：報價改了又送審，不會疊兩則）。
 */
export async function notify(channels: string[], n: { title: string; body: string; href: string; resolveKey?: string }): Promise<void> {
  const r = getRedis()
  const targets = Array.from(new Set(channels.filter(Boolean)))
  if (!r || !targets.length) return
  try {
    if (n.resolveKey && (await r.scard(`notif:key:${n.resolveKey}`)) > 0) return
    const item: NotificationItem = { id: crypto.randomUUID(), ...n, createdAt: Date.now() }
    await r.set(`notif:item:${item.id}`, item, { ex: TTL_S })
    for (const ch of targets) {
      await r.zadd(`notif:ch:${ch}`, { score: item.createdAt, member: item.id })
      await r.zremrangebyrank(`notif:ch:${ch}`, 0, -MAX_PER_CHANNEL - 1)
    }
    if (n.resolveKey) {
      await r.sadd(`notif:key:${n.resolveKey}`, item.id)
      await r.expire(`notif:key:${n.resolveKey}`, TTL_S)
    }
    await sendPush(targets, item)
  } catch (e) {
    console.warn('[notify] failed:', (e as Error)?.message ?? e)
  }
}

/** 事情已處理：收掉這件事產生的通知（所有人的通知中心一起消失） */
export async function resolveNotifications(resolveKey: string): Promise<void> {
  const r = getRedis()
  if (!r) return
  try {
    const ids = await r.smembers(`notif:key:${resolveKey}`)
    if (ids.length) await r.del(...ids.map((id) => `notif:item:${id}`))
    await r.del(`notif:key:${resolveKey}`)
  } catch (e) {
    console.warn('[notify] resolve failed:', (e as Error)?.message ?? e)
  }
}

/** 登入者的通知（新到舊）與未讀數；已收掉或過期的通知順手從頻道清掉 */
export async function listNotifications(userId: string, channels: string[]) {
  const r = getRedis()
  if (!r) return { items: [] as (NotificationItem & { read: boolean })[], unread: 0 }
  const idLists = await Promise.all(channels.map((ch) => r.zrange<string[]>(`notif:ch:${ch}`, 0, LIST_LIMIT - 1, { rev: true })))
  const ids = Array.from(new Set(idLists.flat()))
  if (!ids.length) return { items: [], unread: 0 }
  const [rows, readIds] = await Promise.all([
    r.mget<(NotificationItem | null)[]>(...ids.map((id) => `notif:item:${id}`)),
    r.smembers(`notif:read:${userId}`),
  ])
  const gone = ids.filter((_, i) => !rows[i])
  if (gone.length) await Promise.all(channels.map((ch) => r.zrem(`notif:ch:${ch}`, ...gone))).catch(() => {})
  const read = new Set(readIds)
  const items = rows.filter((x): x is NotificationItem => !!x)
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, LIST_LIMIT)
    .map((x) => ({ ...x, read: read.has(x.id) }))
  return { items, unread: items.filter((x) => !x.read).length }
}

export async function markRead(userId: string, ids: string[]): Promise<void> {
  const r = getRedis()
  if (!r || !ids.length) return
  await r.sadd(`notif:read:${userId}`, ...(ids as [string, ...string[]]))
  await r.expire(`notif:read:${userId}`, TTL_S)
}

// ── 網頁推播 ───────────────────────────────────────────────

export type PushSubscriptionJSON = { endpoint: string; keys: { p256dh: string; auth: string } }

/** 裝置訂閱推播：登記在登入者的每個頻道 */
export async function savePushSubscription(channels: string[], sub: PushSubscriptionJSON): Promise<void> {
  const r = getRedis()
  if (!r) throw new Error('通知服務未設定')
  for (const ch of channels) await r.hset(`push:ch:${ch}`, { [sub.endpoint]: JSON.stringify(sub) })
}

export async function removePushSubscription(channels: string[], endpoint: string): Promise<void> {
  const r = getRedis()
  if (!r) return
  for (const ch of channels) await r.hdel(`push:ch:${ch}`, endpoint)
}

async function sendPush(channels: string[], item: NotificationItem): Promise<void> {
  const r = getRedis()
  if (!r || !pushReady()) return
  // 同一台裝置可能同時在多個頻道（個人＋帳號類型），以 endpoint 去重，只推一次
  const subs = new Map<string, { sub: PushSubscriptionJSON; channel: string }>()
  for (const ch of channels) {
    const all = (await r.hgetall<Record<string, string | PushSubscriptionJSON>>(`push:ch:${ch}`)) ?? {}
    for (const [endpoint, raw] of Object.entries(all)) {
      if (subs.has(endpoint)) continue
      try { subs.set(endpoint, { sub: typeof raw === 'string' ? JSON.parse(raw) : raw, channel: ch }) } catch { /* 壞資料略過 */ }
    }
  }
  const payload = JSON.stringify({ title: item.title, body: item.body, href: item.href, tag: item.resolveKey ?? item.id })
  await Promise.all(Array.from(subs.entries()).map(async ([endpoint, { sub }]) => {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 86400 })
    } catch (e: any) {
      // 404／410＝裝置已取消訂閱或換了瀏覽器：從所有頻道移除
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await Promise.all(channels.map((ch) => r.hdel(`push:ch:${ch}`, endpoint))).catch(() => {})
      } else {
        console.warn('[push] send failed:', e?.statusCode ?? e?.message ?? e)
      }
    }
  }))
}
