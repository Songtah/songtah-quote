/**
 * POST /api/public/register —— 課程線上報名（公開、未登入）
 *
 * withApiAuth 的明確例外（同 /api/public/checkin）：報名者沒有帳號。以下列防線取代登入：
 *   1. 只接受活動管理 DB 的頁面，且活動勾選「線上報名」、未截止、未額滿（lib/online-registration）
 *   2. 每 IP 10 分鐘 20 次   3. honeypot 欄位＋欄位長度上限＋必填驗證
 *   4. 同活動同手機（末 8 碼）＋同姓名不重複建立
 * 金額一律由伺服器依活動設定計算，不採用前端送來的數字：有報名方案時以方案序號查方案（金額、人數都由方案決定），
 * 沒有方案時沿用報名費 × 人數。
 * 回應只回報名結果與付款說明，不回傳任何客戶資料或配對結果。
 * 客戶配對由每小時排程 process-registrations 補上（含地址區域確認）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { getEventById, createRegistration, listEventRegistrations, UNIT_TYPES } from '@/lib/notion/events'
import { getRedisValue, setRedisValue } from '@/lib/notion/shared'
import {
  registrationGate, registrationAmount, MAX_ATTENDEES_PER_SIGNUP, JOB_TITLES,
  GENDERS, DIETS, INFO_SOURCES, PAYMENT_METHODS,
} from '@/lib/online-registration'
import { parseArea, normalizeCity } from '@/lib/event-import'

export const dynamic = 'force-dynamic'

const RATE_LIMIT = 20
const RATE_WINDOW_MS = 10 * 60_000
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
const digits = (s: string) => s.replace(/\D/g, '')
const oneOf = <T extends readonly string[]>(list: T, v: unknown) => ((list as readonly string[]).includes(v as string) ? (v as string) : '')

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: '資料格式錯誤' }, { status: 400 }) }

  if (clip(body?.website, 100)) return NextResponse.json({ ok: true, amount: 0 })   // honeypot

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
  const rlKey = `register-rl:${ip}`
  const hits = (await getRedisValue<number>(rlKey)) ?? 0
  if (hits >= RATE_LIMIT) return NextResponse.json({ error: '操作太頻繁，請稍後再試' }, { status: 429 })
  await setRedisValue(rlKey, hits + 1, RATE_WINDOW_MS)

  const eventId = clip(body?.eventId, 64)
  const name = clip(body?.name, 50)
  const phone = clip(body?.phone, 30)
  const email = clip(body?.email, 100)
  const jobTitle = (JOB_TITLES as readonly string[]).includes(body?.jobTitle) ? body.jobTitle : ''
  const institution = clip(body?.institution, 100)
  const unitType = (UNIT_TYPES as readonly string[]).includes(body?.unitType) ? body.unitType : ''
  const cityInput = clip(body?.city, 10)
  const address = clip(body?.address, 200)
  const note = clip(body?.note, 500)
  const gender = oneOf(GENDERS, body?.gender)
  const diet = oneOf(DIETS, body?.diet)
  const infoSource = oneOf(INFO_SOURCES, body?.infoSource)
  const referrer = infoSource === '業務介紹' ? clip(body?.referrer, 30) : ''
  const companionList: string[] = Array.isArray(body?.companions)
    ? body.companions.map((c: unknown) => clip(c, 50)).slice(0, MAX_ATTENDEES_PER_SIGNUP - 1)
    : []

  if (!name) return NextResponse.json({ error: '請填寫姓名' }, { status: 400 })
  if (digits(phone).length < 9) return NextResponse.json({ error: '請填寫正確的手機或聯絡電話' }, { status: 400 })
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'Email 格式不正確' }, { status: 400 })
  if (institution.replace(/\s/g, '').length < 2) return NextResponse.json({ error: '請填寫單位名稱' }, { status: 400 })
  if (!unitType) return NextResponse.json({ error: '請選擇單位類型' }, { status: 400 })
  if (!body?.consent) return NextResponse.json({ error: '請勾選同意個人資料使用說明' }, { status: 400 })
  if (infoSource === '業務介紹' && !referrer) return NextResponse.json({ error: '請填寫介紹您的業務稱呼' }, { status: 400 })

  const event = await getEventById(eventId)
  if (!event) return NextResponse.json({ error: '找不到此活動' }, { status: 404 })

  // 方案決定人數與金額；沒有方案時沿用自選人數
  const plan = event.plans.length ? event.plans[Math.floor(Number(body?.planIndex))] : undefined
  if (event.plans.length && !plan) return NextResponse.json({ error: '請選擇報名方案' }, { status: 400 })
  const attendees = plan
    ? plan.people
    : Math.min(Math.max(Math.floor(Number(body?.attendees) || 1), 1), MAX_ATTENDEES_PER_SIGNUP)
  const companions = companionList.slice(0, attendees - 1)
  if (attendees > 1 && (companions.length < attendees - 1 || companions.some((c) => !c))) {
    return NextResponse.json({ error: `請填寫全部 ${attendees} 位參加者的姓名` }, { status: 400 })
  }

  try {
    const existing = await listEventRegistrations(eventId)
    const active = existing.filter((r) => r.status !== '取消')

    // 重複報名先判斷：同一人按兩次送出，應回「已報名」而不是「名額不足」
    const tail = digits(phone).slice(-8)
    const mine = active.find((r) => digits(r.phone).slice(-8) === tail && r.contact.replace(/\s/g, '') === name.replace(/\s/g, ''))
    if (mine) {
      return NextResponse.json({ ok: true, duplicate: true, amount: mine.amount || 0, paymentNote: event.paid ? event.paymentNote : '' })
    }

    const gate = registrationGate(event, active.reduce((s, r) => s + (r.attendees || 1), 0))
    if (!gate.open) return NextResponse.json({ error: gate.reason }, { status: 409 })
    if (gate.seatsLeft !== null && attendees > gate.seatsLeft) {
      return NextResponse.json({ error: `名額剩 ${gate.seatsLeft} 位，請調整報名人數` }, { status: 409 })
    }
    const amount = plan ? (event.paid ? plan.price : 0) : registrationAmount(event, attendees)
    // 付款資訊只在需要付費時收；後五碼必須剛好 5 碼數字，日期須為 YYYY-MM-DD
    const paymentMethod = amount > 0 ? oneOf(PAYMENT_METHODS, body?.paymentMethod) : ''
    if (amount > 0 && !paymentMethod) return NextResponse.json({ error: '請選擇付款方式' }, { status: 400 })
    const last5 = paymentMethod === '匯款' ? digits(clip(body?.transferLast5, 10)) : ''
    if (last5 && last5.length !== 5) return NextResponse.json({ error: '匯款後五碼請填 5 位數字' }, { status: 400 })
    const paidDateRaw = paymentMethod === '匯款' ? clip(body?.paidDate, 10) : ''
    const paidDate = /^\d{4}-\d{2}-\d{2}$/.test(paidDateRaw) && !Number.isNaN(Date.parse(paidDateRaw)) ? paidDateRaw : ''

    // 區域：有地址以地址為準；否則用選的縣市（行政區不明）
    const fromAddress = parseArea(address)
    const city = fromAddress.city || normalizeCity(cityInput)

    await createRegistration({
      eventId, institution, contact: name, phone, email,
      city, district: fromAddress.city ? fromAddress.district : '', address,
      attendees, status: '已報名', source: '報名表單',
      jobTitle, unitType, note,
      paymentStatus: amount > 0 ? '未付款' : '免費',
      amount,
      plan: plan?.name, companions: companions.join('、'),
      gender, diet, infoSource, referrer,
      paymentMethod, transferLast5: last5, paidDate,
    })
    return NextResponse.json({ ok: true, amount, paymentNote: event.paid ? event.paymentNote : '' })
  } catch (error) {
    console.error('public register error:', error)
    return NextResponse.json({ error: '報名暫時失敗，請稍後再試' }, { status: 500 })
  }
}
