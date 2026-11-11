/**
 * /api/public/forms/[formId] —— 活動問卷／滿意度調查的公開填寫端點（未登入）
 *
 * withApiAuth 的明確例外（同 public/checkin、public/register）：填答者沒有帳號。防線：
 *   1. 表單 id 為隨機 uuid，且必須是「開放填寫」狀態
 *   2. 每 IP 10 分鐘 30 次
 *   3. honeypot 欄位＋所有欄位長度上限＋答案依題目定義驗證
 *   4. 同一份問卷同一支手機只收一筆（贈品一人一份）
 * 回應只含表單題目與「這一筆回覆」的兌換狀態，絕不回傳其他人的回覆或任何客戶資料。
 *
 *   GET            表單題目（未開放時只回 open:false）
 *   GET ?r=回覆id  這筆回覆的兌換狀態（完成畫面用，訪客重新整理仍看得到）
 *   POST           送出回覆
 */
import { NextRequest, NextResponse } from 'next/server'
import { hitRateLimit } from '@/lib/notion/shared'
import { getEventById } from '@/lib/notion/events'
import { getFormById, getResponse, addResponse } from '@/lib/db/event-forms'
import { validateAnswers, JOB_TITLES } from '@/lib/event-forms-model'
import { isValidDistrict } from '@/lib/tw-districts'

export const dynamic = 'force-dynamic'
type Ctx = { params: { formId: string } }
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const ipOf = (req: NextRequest) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'

const receipt = (r: { id: string; name: string; giftClaimedAt: string; createdAt: string }) =>
  ({ id: r.id, name: r.name, claimed: !!r.giftClaimedAt, createdAt: r.createdAt })

export async function GET(req: NextRequest, { params }: Ctx) {
  if (await hitRateLimit(`form-get-rl:${ipOf(req)}`, 120, 10 * 60_000)) return NextResponse.json({ error: '操作太頻繁，請稍後再試' }, { status: 429 })
  const form = await getFormById(params.formId)
  if (!form) return NextResponse.json({ error: '找不到這份表單' }, { status: 404 })
  const event = await getEventById(form.eventId).catch(() => null)
  const base = { kind: form.kind, title: form.title, eventName: event?.name ?? '', gift: form.gift, giftImage: form.giftImage, open: form.open }
  const rid = req.nextUrl.searchParams.get('r')
  if (rid) {
    const r = await getResponse(form.id, rid)
    return r ? NextResponse.json({ ...base, response: receipt(r) }) : NextResponse.json({ error: '找不到這筆回覆' }, { status: 404 })
  }
  if (!form.open) return NextResponse.json(base)
  return NextResponse.json({ ...base, intro: form.intro, identity: form.identity, questions: form.questions })
}

export async function POST(req: NextRequest, { params }: Ctx) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: '資料格式錯誤' }, { status: 400 }) }
  if (clip(body?.website, 100)) return NextResponse.json({ ok: true })   // honeypot
  if (await hitRateLimit(`form-post-rl:${ipOf(req)}`, 30, 10 * 60_000)) return NextResponse.json({ error: '操作太頻繁，請稍後再試' }, { status: 429 })

  const form = await getFormById(params.formId)
  if (!form) return NextResponse.json({ error: '找不到這份表單' }, { status: 404 })
  if (!form.open) return NextResponse.json({ error: '這份表單目前沒有開放填寫' }, { status: 403 })

  const name = clip(body?.name, 50), phone = clip(body?.phone, 30), institution = clip(body?.institution, 100)
  const city = clip(body?.city, 10), district = clip(body?.district, 10)
  const jobTitle = (JOB_TITLES as readonly string[]).includes(body?.jobTitle) ? (body.jobTitle as string) : ''
  const areaOk = !!city && isValidDistrict(city, district)
  if (form.identity === 'required' && (!name || institution.length < 2 || phone.replace(/\D/g, '').length < 8 || !areaOk || !jobTitle)) {
    return NextResponse.json({ error: '請填寫姓名、技所／診所名稱、所在地區、電話與職稱' }, { status: 400 })
  }
  try {
    const answers = validateAnswers(form, body?.answers)
    const anonymous = form.identity === 'none'
    const { response, duplicate } = await addResponse(form, {
      name: anonymous ? '' : name, phone: anonymous ? '' : phone, institution: anonymous ? '' : institution,
      city: anonymous || !areaOk ? '' : city, district: anonymous || !areaOk ? '' : district, jobTitle: anonymous ? '' : jobTitle, answers,
    })
    return NextResponse.json({ ok: true, duplicate, response: receipt(response) })
  } catch (e: any) {
    const msg = e?.message ?? ''
    if (msg.startsWith('請回答')) return NextResponse.json({ error: msg }, { status: 400 })
    console.error('public form submit error:', e)
    return NextResponse.json({ error: '送出暫時失敗，請稍後再試或洽現場人員' }, { status: 500 })
  }
}
