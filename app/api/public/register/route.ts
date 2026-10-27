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
import { hitRateLimit } from '@/lib/notion/shared'
import {
  registrationGate, registrationAmount, MAX_ATTENDEES_PER_SIGNUP, JOB_TITLES,
  GENDERS, DIETS, INFO_SOURCES, PAYMENT_METHODS,
} from '@/lib/online-registration'
import { parseArea, normalizeCity } from '@/lib/event-import'
import { isValidDistrict } from '@/lib/tw-districts'

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
  if (await hitRateLimit(`register-rl:${ip}`, RATE_LIMIT, RATE_WINDOW_MS)) return NextResponse.json({ error: '操作太頻繁，請稍後再試' }, { status: 429 })

  const eventId = clip(body?.eventId, 64)
  const name = clip(body?.name, 50)
  const phone = clip(body?.phone, 30)
  let email = clip(body?.email, 100)
  let jobTitle = (JOB_TITLES as readonly string[]).includes(body?.jobTitle) ? body.jobTitle : ''
  const institution = clip(body?.institution, 100)
  let unitType = (UNIT_TYPES as readonly string[]).includes(body?.unitType) ? body.unitType : ''
  let cityInput = clip(body?.city, 10)
  let districtInput = clip(body?.district, 10)
  let address = clip(body?.address, 200)
  let note = clip(body?.note, 500)
  let gender = oneOf(GENDERS, body?.gender)
  let diet = oneOf(DIETS, body?.diet)
  let infoSource = oneOf(INFO_SOURCES, body?.infoSource)
  const companionList: string[] = Array.isArray(body?.companions)
    ? body.companions.map((c: unknown) => clip(c, 50)).slice(0, MAX_ATTENDEES_PER_SIGNUP - 1)
    : []

  if (!name) return NextResponse.json({ error: '請填寫姓名' }, { status: 400 })
  if (digits(phone).length < 9) return NextResponse.json({ error: '請填寫正確的手機或聯絡電話' }, { status: 400 })
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: 'Email 格式不正確' }, { status: 400 })
  if (institution.replace(/\s/g, '').length < 2) return NextResponse.json({ error: '請填寫單位名稱' }, { status: 400 })
  if (!body?.consent) return NextResponse.json({ error: '請勾選同意個人資料使用說明' }, { status: 400 })

  const event = await getEventById(eventId)
  if (!event) return NextResponse.json({ error: '找不到此活動' }, { status: 404 })

  // 報名表欄位設定：隱藏的欄位一律丟掉（不信任前端），必填的缺值就擋
  const cfg = event.formConfig
  if (cfg.email === 'off') email = ''
  if (cfg.jobTitle === 'off') jobTitle = ''
  if (cfg.gender === 'off') gender = ''
  if (cfg.diet === 'off') diet = ''
  if (cfg.unitType === 'off') unitType = ''
  if (cfg.city === 'off') cityInput = ''
  // 鄉鎮市區必須屬於所選縣市（選單送來的值也驗，不信任前端）
  if (cfg.city === 'off' || cfg.district === 'off' || !isValidDistrict(normalizeCity(cityInput), districtInput)) districtInput = ''
  if (cfg.address === 'off') address = ''
  if (cfg.infoSource === 'off') infoSource = ''
  if (cfg.note === 'off') note = ''
  const missing = ([
    ['email', email, '請填寫 Email'], ['jobTitle', jobTitle, '請選擇職稱'], ['gender', gender, '請選擇性別'],
    ['diet', diet, '請選擇飲食需求'], ['unitType', unitType, '請選擇單位類型'], ['city', cityInput, '請選擇縣市'], ['district', districtInput, '請選擇鄉鎮市區'],
    ['address', address, '請填寫單位地址'], ['infoSource', infoSource, '請選擇如何得知這堂課'], ['note', note, '請填寫備註'],
  ] as const).find(([k, v]) => cfg[k] === 'required' && !v)
  if (missing) return NextResponse.json({ error: missing[2] }, { status: 400 })
  const referrer = infoSource === '業務介紹' ? clip(body?.referrer, 30) : ''
  if (infoSource === '業務介紹' && !referrer) return NextResponse.json({ error: '請填寫介紹您的業務稱呼' }, { status: 400 })

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
    const paymentMethod = amount > 0 && cfg.paymentMethod !== 'off' ? oneOf(PAYMENT_METHODS, body?.paymentMethod) : ''
    if (amount > 0 && cfg.paymentMethod === 'required' && !paymentMethod) return NextResponse.json({ error: '請選擇付款方式' }, { status: 400 })
    const isTransfer = paymentMethod === '匯款'
    const last5 = isTransfer && cfg.transferLast5 !== 'off' ? digits(clip(body?.transferLast5, 10)) : ''
    if (isTransfer && cfg.transferLast5 === 'required' && !last5) return NextResponse.json({ error: '請填寫匯款後五碼' }, { status: 400 })
    if (last5 && last5.length !== 5) return NextResponse.json({ error: '匯款後五碼請填 5 位數字' }, { status: 400 })
    const paidDateRaw = isTransfer && cfg.paidDate !== 'off' ? clip(body?.paidDate, 10) : ''
    const paidDate = /^\d{4}-\d{2}-\d{2}$/.test(paidDateRaw) && !Number.isNaN(Date.parse(paidDateRaw)) ? paidDateRaw : ''
    if (isTransfer && cfg.paidDate === 'required' && !paidDate) return NextResponse.json({ error: '請填寫匯款日期' }, { status: 400 })

    // 區域：有地址以地址為準；否則用選的縣市（行政區不明）
    const fromAddress = parseArea(address)
    const city = fromAddress.city || normalizeCity(cityInput)
    const district = fromAddress.city ? fromAddress.district : districtInput

    await createRegistration({
      eventId, institution, contact: name, phone, email,
      city, district, address,
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
