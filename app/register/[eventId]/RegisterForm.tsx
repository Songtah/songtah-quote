'use client'

/**
 * 課程線上報名表（公開）。2026-10-27 依 SurveyCake 報名表整合：
 * 報名方案、多人同行姓名、性別、飲食需求、付款方式＋匯款後五碼／日期、如何得知課程（業務介紹填業務稱呼）。
 * 原本已有的欄位（姓名、手機、Email、職稱、單位、縣市地址、備註、同意條款）沿用。
 * 付款說明（匯款帳號、退費規則）送出前就顯示，已匯款的人可以直接填後五碼。
 * 各欄位隱藏／選填／必填依活動設定（formConfig）；伺服器同樣依設定驗證。
 */
import { useState } from 'react'
import {
  MAX_ATTENDEES_PER_SIGNUP, JOB_TITLES, GENDERS, DIETS, INFO_SOURCES, PAYMENT_METHODS,
  formatNT, type RegistrationPlan, type FormConfig, type FormFieldKey,
} from '@/lib/online-registration'

const UNIT_TYPES = ['牙醫診所', '牙體技術所', '醫院', '學校', '其他']
const CITIES = ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣',
  '嘉義市', '嘉義縣', '台南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '台東縣', '澎湖縣', '金門縣', '連江縣']

type Done = { amount: number; paymentNote: string; duplicate?: boolean }

export function RegisterForm({ eventId, paid, fee, seatsLeft, plans, paymentNote, formConfig }: {
  eventId: string; paid: boolean; fee: number; seatsLeft: number | null
  plans: RegistrationPlan[]; paymentNote: string; formConfig: FormConfig
}) {
  const show = (k: FormFieldKey) => formConfig[k] !== 'off'
  const req = (k: FormFieldKey) => formConfig[k] === 'required'
  const star = (k: FormFieldKey) => (req(k) ? ' *' : '')
  const [f, setF] = useState({
    name: '', phone: '', email: '', jobTitle: '', gender: '', diet: '不限',
    institution: '', unitType: '', city: '', address: '',
    attendees: 1, note: '', consent: false, website: '',
    infoSource: '', referrer: '',
    paymentMethod: '', transferLast5: '', paidDate: '',
  })
  // 只有一個方案時直接選好
  const [planIndex, setPlanIndex] = useState<number | null>(plans.length === 1 ? 0 : null)
  const [companions, setCompanions] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<Done | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }))

  const seatCap = seatsLeft ?? MAX_ATTENDEES_PER_SIGNUP
  const plan = planIndex !== null ? plans[planIndex] : undefined
  const attendees = plans.length ? (plan?.people ?? 1) : Number(f.attendees || 1)
  const total = !paid ? 0 : plans.length ? (plan?.price ?? 0) : fee * attendees
  const needPayment = paid && total > 0
  const showPaymentSection = needPayment && (show('paymentMethod') || !!paymentNote)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (plans.length && planIndex === null) { setError('請選擇報名方案'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/public/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...f, eventId, attendees, planIndex,
          companions: companions.slice(0, attendees - 1),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '報名失敗')
      setDone(json)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: any) {
      setError(err?.message ?? '報名失敗，請稍後再試')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <p className="text-xl font-bold text-emerald-800">{done.duplicate ? '您已經報名過了' : '報名完成，謝謝您！'}</p>
        <p className="mt-2 text-sm text-stone-500">我們已收到您的報名資料，活動前會與您聯繫。</p>
        {done.amount > 0 && (
          <div className="mt-6 rounded-2xl bg-amber-50 p-5 text-left ring-1 ring-amber-600/15">
            <p className="text-sm font-semibold text-amber-800">應繳報名費：{formatNT(done.amount)}</p>
            {done.paymentNote
              ? <p className="mt-2 whitespace-pre-line text-sm leading-7 text-amber-900">{done.paymentNote}</p>
              : <p className="mt-2 text-sm text-amber-900">付款方式將由專人與您聯繫。</p>}
          </div>
        )}
      </div>
    )
  }

  const label = 'block text-sm font-semibold text-stone-700'
  const legend = 'mb-1 text-base font-bold text-stone-800'
  const radio = (on: boolean) =>
    `flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold ring-1 transition-all active:scale-95 ${
      on ? 'bg-brand-50 text-brand-700 ring-brand-400' : 'bg-white text-stone-600 ring-stone-900/10 hover:bg-stone-50'}`

  return (
    <form onSubmit={submit} className="space-y-8">
      <h2 className="text-lg font-bold text-stone-800">填寫報名資料</h2>

      {plans.length > 0 && (
        <fieldset className="space-y-3">
          <legend className={legend}>報名方案 *</legend>
          <div className="grid gap-2">
            {plans.map((p, i) => {
              const full = p.people > seatCap
              const on = planIndex === i
              return (
                <label key={i} className={`flex min-h-14 items-center justify-between gap-3 rounded-2xl px-4 py-3 ring-1 transition-all ${
                  full ? 'cursor-not-allowed bg-stone-50 text-stone-400 ring-stone-900/5'
                    : on ? 'cursor-pointer bg-brand-50 ring-2 ring-brand-400' : 'cursor-pointer bg-white ring-stone-900/10 hover:bg-stone-50'}`}>
                  <span className="flex items-center gap-3">
                    <input type="radio" name="plan" checked={on} disabled={full} onChange={() => setPlanIndex(i)} className="size-4 accent-brand-500" />
                    <span>
                      <span className="block text-sm font-semibold text-stone-800">{p.name}</span>
                      <span className="block text-xs text-stone-500">{p.people} 位{full ? '・名額不足' : ''}</span>
                    </span>
                  </span>
                  {paid && <span className="text-base font-bold tabular-nums text-stone-800">{formatNT(p.price)}</span>}
                </label>
              )
            })}
          </div>
        </fieldset>
      )}

      <fieldset className="space-y-3">
        <legend className={legend}>參加者</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>{attendees > 1 ? '報名人姓名 *' : '姓名 *'}<input required maxLength={50} value={f.name} onChange={set('name')} autoComplete="name" className="input-soft mt-1 w-full font-normal" /></label>
          <label className={label}>手機 *<input required type="tel" inputMode="tel" maxLength={30} value={f.phone} onChange={set('phone')} autoComplete="tel" className="input-soft mt-1 w-full font-normal" /></label>
          {Array.from({ length: Math.max(attendees - 1, 0) }, (_, i) => (
            <label key={i} className={label}>同行者 {i + 1} 姓名 *
              <input required maxLength={50} value={companions[i] ?? ''}
                onChange={(e) => setCompanions((c) => { const n = [...c]; n[i] = e.target.value; return n })}
                className="input-soft mt-1 w-full font-normal" />
            </label>
          ))}
          {show('email') && <label className={label}>Email{star('email')}<input required={req('email')} type="email" maxLength={100} value={f.email} onChange={set('email')} autoComplete="email" className="input-soft mt-1 w-full font-normal" /></label>}
          {show('jobTitle') && <label className={label}>職稱{star('jobTitle')}
            <select required={req('jobTitle')} value={f.jobTitle} onChange={set('jobTitle')} className="select-soft mt-1 w-full font-normal">
              <option value="">請選擇</option>
              {JOB_TITLES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>}
          {show('gender') && <div className={label}>性別{star('gender')}
            <div className="mt-1 flex gap-2">
              {GENDERS.map((g) => (
                <label key={g} className={radio(f.gender === g)}>
                  <input type="radio" name="gender" value={g} checked={f.gender === g} onChange={set('gender')} required={req('gender')} className="sr-only" />{g}
                </label>
              ))}
            </div>
          </div>}
          {show('diet') && <label className={label}>飲食需求{star('diet')}
            <select value={f.diet} onChange={set('diet')} className="select-soft mt-1 w-full font-normal">
              {DIETS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </label>}
          {!plans.length && (
            <label className={label}>報名人數
              <select value={f.attendees} onChange={set('attendees')} className="select-soft mt-1 w-full font-normal">
                {Array.from({ length: Math.max(Math.min(MAX_ATTENDEES_PER_SIGNUP, seatCap), 1) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} 位</option>)}
              </select>
            </label>
          )}
        </div>
        {attendees > 1 && show('diet') && show('note') && <p className="text-xs text-stone-500">飲食需求有不同時，請寫在最下方備註。</p>}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className={legend}>服務單位</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>單位名稱 *<input required minLength={2} maxLength={100} value={f.institution} onChange={set('institution')} placeholder="例：崧達牙醫診所" className="input-soft mt-1 w-full font-normal" /></label>
          {show('unitType') && <label className={label}>單位類型{star('unitType')}
            <select required={req('unitType')} value={f.unitType} onChange={set('unitType')} className="select-soft mt-1 w-full font-normal">
              <option value="">請選擇</option>
              {UNIT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>}
          {show('city') && <label className={label}>縣市{star('city')}
            <select required={req('city')} value={f.city} onChange={set('city')} className="select-soft mt-1 w-full font-normal">
              <option value="">請選擇</option>
              {CITIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>}
          {show('address') && <label className={`${label} sm:col-span-2`}>單位地址{star('address')}<input required={req('address')} maxLength={200} value={f.address} onChange={set('address')} placeholder="例：台中市北屯區崇德路三段100號" autoComplete="street-address" className="input-soft mt-1 w-full font-normal" /></label>}
        </div>
      </fieldset>

      {showPaymentSection && (
        <fieldset className="space-y-3">
          <legend className={legend}>付款</legend>
          <div className="rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-amber-600/15">
            <p className="text-sm text-amber-700">{plan ? plan.name : `報名費 ${formatNT(fee)} × ${attendees} 位`}</p>
            <p className="text-lg font-bold tabular-nums text-amber-800">應繳 {formatNT(total)}</p>
            {paymentNote && <p className="mt-2 whitespace-pre-line border-t border-amber-600/15 pt-2 text-sm leading-7 text-amber-900">{paymentNote}</p>}
          </div>
          {show('paymentMethod') && <div className={label}>付款方式{star('paymentMethod')}
            <div className="mt-1 flex flex-wrap gap-2">
              {PAYMENT_METHODS.map((m) => (
                <label key={m} className={radio(f.paymentMethod === m)}>
                  <input type="radio" name="paymentMethod" value={m} checked={f.paymentMethod === m} onChange={set('paymentMethod')} required={req('paymentMethod')} className="sr-only" />
                  {m === '現金交業務' ? '現金（交由當區業務）' : '銀行匯款'}
                </label>
              ))}
            </div>
          </div>}
          {f.paymentMethod === '匯款' && (show('transferLast5') || show('paidDate')) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {show('transferLast5') && <label className={label}>匯款帳號後五碼{star('transferLast5')}
                <input required={req('transferLast5')} inputMode="numeric" pattern="\d{5}" maxLength={5} value={f.transferLast5} onChange={set('transferLast5')} placeholder="已匯款請填寫" className="input-soft mt-1 w-full font-normal tabular-nums" />
              </label>}
              {show('paidDate') && <label className={label}>匯款日期{star('paidDate')}
                <input required={req('paidDate')} type="date" value={f.paidDate} onChange={set('paidDate')} className="input-soft mt-1 w-full font-normal" />
              </label>}
              {!req('transferLast5') && !req('paidDate') && <p className="text-xs leading-5 text-stone-500 sm:col-span-2">還沒匯款可以先留白送出，匯款後依上方說明告知我們。</p>}
            </div>
          )}
        </fieldset>
      )}

      {(show('infoSource') || show('note')) && <fieldset className="space-y-3">
        <legend className={legend}>其他</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {show('infoSource') && <label className={label}>如何得知這堂課{star('infoSource')}
            <select required={req('infoSource')} value={f.infoSource} onChange={set('infoSource')} className="select-soft mt-1 w-full font-normal">
              <option value="">請選擇</option>
              {INFO_SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>}
          {f.infoSource === '業務介紹' && (
            <label className={label}>介紹的業務 *<input required maxLength={30} value={f.referrer} onChange={set('referrer')} placeholder="業務的名字或稱呼" className="input-soft mt-1 w-full font-normal" /></label>
          )}
          {show('note') && <label className={`${label} sm:col-span-2`}>備註{star('note')}<textarea required={req('note')} rows={3} maxLength={500} value={f.note} onChange={set('note')} placeholder="其他需求或想讓我們知道的事" className="input-soft mt-1 w-full font-normal" /></label>}
        </div>
      </fieldset>}

      <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} className="hidden" aria-hidden="true" name="website" />

      <label className="flex items-start gap-2 text-sm leading-6 text-stone-600">
        <input type="checkbox" checked={f.consent} onChange={set('consent')} required className="mt-1 accent-brand-500" />
        <span>我同意崧達企業蒐集、處理及利用以上資料，用於本活動的報名、保險、課程聯繫，以及後續活動與產品資訊通知；資料將依個人資料保護法妥善保存。</span>
      </label>

      {error && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="w-full rounded-full bg-brand-500 px-6 py-3.5 text-base font-semibold text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50">
        {busy ? '送出中…' : needPayment ? `送出報名（${formatNT(total)}）` : '送出報名'}
      </button>
    </form>
  )
}
