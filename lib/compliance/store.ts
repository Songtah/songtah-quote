/**
 * lib/compliance/store.ts —— 法規合規監測的資料（Redis，僅中央管理經 API 存取）
 *
 * 監測名單、存證紀錄、發現、檢舉案都是敏感資料：只存 Redis／Blob，不進程式庫、不進 Notion 客戶庫、不寫稽核 DB。
 * 這些是資料不是快取：不設 TTL、不經 L1；Redis 不可用時一律 throw（fail-closed），不可回空陣列假裝沒資料。
 */
import 'server-only'
import crypto from 'crypto'
import { getRedis } from '@/lib/notion/shared'

export type SourcePlatform = '官網' | 'Facebook' | 'Instagram' | 'YouTube' | '賣場' | '其他'
export type TargetSource = {
  id: string
  platform: SourcePlatform
  url: string
  /** auto＝系統定期抓取（官網類）；manual＝有登入牆的平台，只能人工貼單篇網址 */
  mode: 'auto' | 'manual'
}
export type Target = {
  id: string
  name: string             // 公司登記名稱
  aliases: string[]        // 商標、簡稱（比對許可證申請商與內文用）
  kind: 'competitor' | 'self'
  status: 'active' | 'paused'
  city: string             // 登記所在地縣市（決定受理機關）；未確認留空
  channelUrl: string       // 該受理機關的線上陳情／檢舉頁，由中央管理確認後填入；系統不猜網址
  note: string
  sources: TargetSource[]
  createdAt: string
  lastCaptureAt?: string
}

export type Capture = {
  id: string
  targetId: string
  sourceId: string
  url: string
  capturedAt: string        // ISO（UTC）
  httpStatus: number
  sha256: string            // 原始回應位元組的雜湊
  textSha256: string        // 去標籤後文字的雜湊（判斷內容是否變動）
  bytes: number
  blobUrl: string           // 原始 HTML 存檔
  archiveUrl: string        // 第三方存檔（Wayback）；未存為 ''
  title: string
  licenseNos: string[]
  adApprovalNos: string[]
  judgedAt?: string
}

export type FindingStatus = '待審' | '不成立' | '成立' | '已產出檢舉書' | '已送出' | '已結案'
export type Finding = {
  id: string
  targetId: string
  captureId: string
  url: string
  ruleId: string
  source: 'hard' | 'ai'      // hard＝資料比對；ai＝模型判讀（僅疑似）
  product: string
  quote: string              // 頁面逐字原文依據
  reason: string
  confidence: '高' | '中' | '低'
  status: FindingStatus
  createdAt: string
  reviewNote: string
  caseNo: string             // 送出後回填的案號
  agency: string
}

const K = { targets: 'compliance:targets', captures: 'compliance:captures', findings: 'compliance:findings', lastText: 'compliance:last-text' }

function redis() {
  const r = getRedis()
  if (!r) throw new Error('Redis 未設定，法規合規監測無法使用')
  return r
}
export const newId = () => crypto.randomBytes(8).toString('hex')

async function all<T>(key: string): Promise<T[]> {
  const h = (await redis().hgetall<Record<string, T>>(key)) ?? {}
  return Object.values(h)
}

// ── 監測對象 ────────────────────────────────────────────────────────────────
export const listTargets = async () => (await all<Target>(K.targets)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
export const getTarget = async (id: string) => (await redis().hget<Target>(K.targets, id)) ?? null
export async function saveTarget(t: Target) { await redis().hset(K.targets, { [t.id]: t }) }
export async function deleteTarget(id: string) { await redis().hdel(K.targets, id) }

// ── 存證 ────────────────────────────────────────────────────────────────────
export const listCaptures = async (targetId?: string) =>
  (await all<Capture>(K.captures)).filter((c) => !targetId || c.targetId === targetId).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
export const getCapture = async (id: string) => (await redis().hget<Capture>(K.captures, id)) ?? null
export async function saveCapture(c: Capture) { await redis().hset(K.captures, { [c.id]: c }) }
/** 該網址上次擷取的文字雜湊（判斷有無變動，避免重複存相同內容） */
export const getLastTextHash = async (url: string) => (await redis().hget<string>(K.lastText, url)) ?? ''
export async function setLastTextHash(url: string, hash: string) { await redis().hset(K.lastText, { [url]: hash }) }

// ── 發現 ────────────────────────────────────────────────────────────────────
export const listFindings = async (targetId?: string) =>
  (await all<Finding>(K.findings)).filter((f) => !targetId || f.targetId === targetId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
export const getFinding = async (id: string) => (await redis().hget<Finding>(K.findings, id)) ?? null
export async function saveFinding(f: Finding) { await redis().hset(K.findings, { [f.id]: f }) }
/** 同一頁、同一規則、同一段原文只記一次 */
export async function addFindingOnce(f: Omit<Finding, 'id' | 'createdAt' | 'status' | 'reviewNote' | 'caseNo' | 'agency'>): Promise<Finding | null> {
  const key = crypto.createHash('sha256').update(`${f.url}|${f.ruleId}|${f.quote.replace(/\s+/g, '')}`).digest('hex').slice(0, 16)
  const existing = await getFinding(key)
  if (existing) return null
  const finding: Finding = { ...f, id: key, createdAt: new Date().toISOString(), status: '待審', reviewNote: '', caseNo: '', agency: '' }
  await saveFinding(finding)
  return finding
}
