/**
 * lib/event-forms-model.ts — 活動問卷／滿意度調查的資料形狀與驗證（前後端共用，不含資料庫存取）。
 *
 * 一場活動各有一份「活動問卷」（kind=survey，填完換贈品）與一份「滿意度調查」（kind=satisfaction）。
 * 題目由活動負責人自己訂（使用者 2026-11-10 定調），系統不預設題目。
 */
export type FormKind = 'survey' | 'satisfaction'
export const FORM_KIND_LABEL: Record<FormKind, string> = { survey: '活動問卷', satisfaction: '滿意度調查' }

export const QUESTION_TYPES = ['text', 'textarea', 'single', 'multi', 'rating', 'products'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  text: '簡答', textarea: '長文字', single: '單選', multi: '複選', rating: '1–5 分', products: '關聯產品',
}

/** 關聯產品題的選項：從產品目錄挑出來的品項（code＝貨號）。訪客看到的是 name，可複選 */
export type FormProduct = { code: string; name: string; brand: string }
export type FormQuestion = { id: string; label: string; type: QuestionType; options: string[]; required: boolean; products?: FormProduct[] }
export const MAX_PRODUCTS = 30
/** 填答者身分：required＝姓名、手機、單位必填；optional＝可留可不留；none＝完全匿名 */
export type FormIdentity = 'required' | 'optional' | 'none'

export type EventForm = {
  id: string; eventId: string; kind: FormKind; title: string; intro: string; gift: string
  identity: FormIdentity; questions: FormQuestion[]; open: boolean; updatedAt: string
}
/** 基本資料的職稱選項（使用者 2026-11-11 指定牙技師／牙醫師；另留「其他」給助理、學生等，避免必填時填不下去） */
export const JOB_TITLES = ['牙技師', '牙醫師', '其他'] as const

export type FormResponse = {
  id: string; name: string; phone: string; institution: string
  /** 技所／診所所在縣市、鄉鎮市區 */
  city: string; district: string; jobTitle: string
  answers: Record<string, string | string[] | number>
  giftClaimedAt: string; giftClaimedBy: string; createdAt: string
}

export const MAX_QUESTIONS = 30
export const MAX_OPTIONS = 20
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

/** 整理並驗證後台送來的表單設定；有問題丟出可直接顯示給使用者的訊息 */
export function sanitizeFormInput(kind: FormKind, input: any): Omit<EventForm, 'id' | 'eventId' | 'updatedAt'> {
  const rawQs: any[] = Array.isArray(input?.questions) ? input.questions.slice(0, MAX_QUESTIONS) : []
  const seen = new Set<string>()
  const questions: FormQuestion[] = rawQs.map((q, i) => {
    const type: QuestionType = QUESTION_TYPES.includes(q?.type) ? q.type : 'text'
    const label = clip(q?.label, 200)
    if (!label) throw new Error(`第 ${i + 1} 題沒有填題目`)
    let id = clip(q?.id, 40).replace(/[^a-zA-Z0-9_-]/g, '')
    if (!id || seen.has(id)) id = `q${i + 1}_${Math.random().toString(36).slice(2, 8)}`
    seen.add(id)
    if (type === 'products') {
      // 關聯產品題：選項＝挑選的產品名稱（同名時加上貨號區分），products 保留貨號供之後串接產品資料
      const codes = new Set<string>(), names = new Set<string>()
      const products: FormProduct[] = []
      for (const p of (Array.isArray(q?.products) ? q.products : []).slice(0, MAX_PRODUCTS)) {
        const code = clip(p?.code, 60); let name = clip(p?.name, 100)
        if (!code || !name || codes.has(code)) continue
        if (names.has(name)) name = `${name}（${code}）`.slice(0, 100)
        codes.add(code); names.add(name)
        products.push({ code, name, brand: clip(p?.brand, 60) })
      }
      if (!products.length) throw new Error(`第 ${i + 1} 題「${label}」還沒有挑選產品`)
      return { id, label, type, options: products.map((p) => p.name), required: q?.required === true, products }
    }
    const options = type === 'single' || type === 'multi'
      ? Array.from(new Set((Array.isArray(q?.options) ? q.options : []).map((o: unknown) => clip(o, 100)).filter(Boolean))).slice(0, MAX_OPTIONS) as string[]
      : []
    if ((type === 'single' || type === 'multi') && options.length < 2) throw new Error(`第 ${i + 1} 題「${label}」至少要兩個選項`)
    return { id, label, type, options, required: q?.required === true }
  })
  const open = input?.open === true
  if (open && questions.length === 0) throw new Error('還沒有題目，不能開放填寫')
  // 活動問卷要換贈品，一定要留手機才能確認「一人一份」
  const identity: FormIdentity = kind === 'survey' ? 'required' : (['required', 'optional', 'none'].includes(input?.identity) ? input.identity : 'none')
  return { kind, title: clip(input?.title, 100), intro: clip(input?.intro, 1000), gift: kind === 'survey' ? clip(input?.gift, 200) : '', identity, questions, open }
}

/** 驗證訪客送出的答案；回傳整理後的答案，或丟出訊息 */
export function validateAnswers(form: Pick<EventForm, 'questions'>, raw: any): Record<string, string | string[] | number> {
  const out: Record<string, string | string[] | number> = {}
  for (const q of form.questions) {
    const v = raw?.[q.id]
    let val: string | string[] | number | null = null
    if (q.type === 'text') val = clip(v, 200) || null
    else if (q.type === 'textarea') val = clip(v, 2000) || null
    else if (q.type === 'single') val = typeof v === 'string' && q.options.includes(v) ? v : null
    else if (q.type === 'multi' || q.type === 'products') { const arr = Array.isArray(v) ? v.filter((x) => typeof x === 'string' && q.options.includes(x)) : []; val = arr.length ? Array.from(new Set(arr)) : null }
    else if (q.type === 'rating') { const n = Number(v); val = Number.isInteger(n) && n >= 1 && n <= 5 ? n : null }
    if (val == null) { if (q.required) throw new Error(`請回答「${q.label}」`); continue }
    out[q.id] = val
  }
  return out
}

/** 各題彙總：選擇題各選項票數、評分題平均、文字題回答數 */
export type QuestionSummary = { id: string; label: string; type: QuestionType; answered: number; counts?: Record<string, number>; average?: number; texts?: string[] }
export function summarize(form: Pick<EventForm, 'questions'>, responses: Pick<FormResponse, 'answers'>[]): QuestionSummary[] {
  return form.questions.map((q) => {
    const vals = responses.map((r) => r.answers?.[q.id]).filter((v) => v != null && v !== '')
    const s: QuestionSummary = { id: q.id, label: q.label, type: q.type, answered: vals.length }
    if (q.type === 'single' || q.type === 'multi' || q.type === 'products') {
      s.counts = Object.fromEntries(q.options.map((o) => [o, 0]))
      for (const v of vals) for (const o of (Array.isArray(v) ? v : [v])) if (typeof o === 'string' && o in s.counts) s.counts[o]++
    } else if (q.type === 'rating') {
      const nums = vals.filter((v): v is number => typeof v === 'number')
      s.average = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : 0
      s.counts = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [String(n), nums.filter((x) => x === n).length]))
    } else s.texts = vals.map(String).slice(0, 200)
    return s
  })
}
