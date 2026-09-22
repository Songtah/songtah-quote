/**
 * lib/notion/tender-track.ts — 標案追蹤狀態（第二期）
 *
 * 標案清單本身每天重抓（lib/notion/tenders），是「外部事實」；
 * 誰在追、追到哪一步是「我們的決定」，兩者分開存：
 * 事實放快照、決定放這裡，重抓不會把人的操作蓋掉。
 *
 * 用 Redis 而不是新開 Notion DB：第二期要的是「業務能認領並標狀態」，
 * 不需要 Notion 的欄位與檢視。等到要做報表或跨系統引用再升級成 DB。
 *
 * 狀態改成「投標中」時，若該機關是既有客戶，順手把開發階段推到「報價中」——
 * 依 CLAUDE.md 最高原則：漏斗由系統推進，不要求業務另外去客戶頁點一次。
 */
import { getRedisValue, setRedisValue } from './shared'
import { advanceCustomerDevStage } from './customers'

export const TENDER_STATUSES = ['待評估', '投標中', '已投標', '得標', '未得標', '放棄'] as const
export type TenderStatus = (typeof TENDER_STATUSES)[number]

export type TenderTrack = {
  tenderId: string
  status: TenderStatus
  owner: string        // 負責追這案的業務；空＝未認領
  note: string
  updatedBy: string
  updatedAt: string
}

const KEY = 'tender-track-v1'
const TTL_MS = 400 * 24 * 3600_000

export async function listTracks(): Promise<Record<string, TenderTrack>> {
  return (await getRedisValue<Record<string, TenderTrack>>(KEY).catch(() => null)) ?? {}
}

export async function saveTrack(input: {
  tenderId: string
  status?: TenderStatus
  owner?: string | null
  note?: string
  actor: string
  /** 機關比對到的客戶；有值且狀態轉為投標中時推進開發階段 */
  customerId?: string
}): Promise<TenderTrack> {
  const all = await listTracks()
  const prev = all[input.tenderId]
  const next: TenderTrack = {
    tenderId: input.tenderId,
    status: input.status ?? prev?.status ?? '待評估',
    owner: input.owner === null ? '' : (input.owner ?? prev?.owner ?? ''),
    note: input.note ?? prev?.note ?? '',
    updatedBy: input.actor,
    updatedAt: new Date().toISOString(),
  }
  all[input.tenderId] = next
  await setRedisValue(KEY, all, TTL_MS)

  // 投標＝正在報價，把客戶推進到「報價中」（不可逆的成交判定仍以訂單為準）
  if (input.customerId && next.status === '投標中' && prev?.status !== '投標中') {
    await advanceCustomerDevStage(input.customerId, '報價中', { actorName: input.actor, canManageAll: false })
      .catch(() => false)
  }
  return next
}
