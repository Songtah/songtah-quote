/**
 * lib/line-groups.ts —— 記下公司 LINE 官方帳號所在的群組（ID＋名稱）
 *
 * LINE 推播要用群組 ID（C 開頭），在 App 裡看不到；webhook 收到群組事件時順手記下，
 * 只供中央管理在 /api/admin/line-groups 查看、再把正確的 ID 填進環境變數。
 * 【禁止】拿這份清單自動決定推播收件人（2026-11-05 曾因名稱比對把工單推到客戶群組）。
 * 名稱由 LINE API group summary 取得，同一群組一天查一次。
 */
import { getRedis } from '@/lib/notion/shared'

const KEY = 'line:groups'   // hash：groupId → { name, seenAt }
type GroupInfo = { name: string; seenAt: string }

export async function rememberLineGroup(groupId: string): Promise<void> {
  const r = getRedis()
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!r || !token || !groupId) return
  try {
    const prev = await r.hget<GroupInfo>(KEY, groupId)
    if (prev && Date.now() - Date.parse(prev.seenAt) < 86400_000) return
    let name = prev?.name ?? ''
    const res = await fetch(`https://api.line.me/v2/bot/group/${groupId}/summary`, { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) name = ((await res.json()) as { groupName?: string }).groupName ?? name
    await r.hset(KEY, { [groupId]: { name, seenAt: new Date().toISOString() } })
  } catch (e) {
    console.warn('[line-groups] 記錄群組失敗:', (e as Error)?.message ?? e)
  }
}

export async function listLineGroups(): Promise<{ groupId: string; name: string; seenAt: string }[]> {
  const r = getRedis()
  if (!r) return []
  const all = ((await r.hgetall<Record<string, GroupInfo>>(KEY)) ?? {}) as Record<string, GroupInfo>
  return Object.entries(all).map(([groupId, g]) => ({ groupId, name: g.name, seenAt: g.seenAt }))
}

