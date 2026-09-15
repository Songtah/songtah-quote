'use client'

import { useState } from 'react'
import { MAX_ATTENDEES_PER_SIGNUP, JOB_TITLES, formatNT } from '@/lib/online-registration'

const UNIT_TYPES = ['牙醫診所', '牙體技術所', '醫院', '學校', '其他']
const CITIES = ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣',
  '嘉義市', '嘉義縣', '台南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '台東縣', '澎湖縣', '金門縣', '連江縣']

type Done = { amount: number; paymentNote: string; duplicate?: boolean }

export function RegisterForm({ eventId, paid, fee, seatsLeft }: { eventId: string; paid: boolean; fee: number; seatsLeft: number | null }) {
  const [f, setF] = useState({
    name: '', phone: '', email: '', jobTitle: '',
    institution: '', unitType: '', city: '', address: '',
    attendees: 1, note: '', consent: false, website: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<Done | null>(null)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }))

  const maxAttendees = Math.min(MAX_ATTENDEES_PER_SIGNUP, seatsLeft ?? MAX_ATTENDEES_PER_SIGNUP)
  const total = paid ? fee * Number(f.attendees || 1) : 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/public/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, attendees: Number(f.attendees), eventId }),
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
  return (
    <form onSubmit={submit} className="space-y-6">
      <h2 className="text-lg font-bold text-stone-800">填寫報名資料</h2>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-bold uppercase tracking-widest text-brand-500">基本資料</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>姓名 *<input required maxLength={50} value={f.name} onChange={set('name')} autoComplete="name" className="input-soft mt-1 w-full font-normal" /></label>
          <label className={label}>手機 *<input required type="tel" inputMode="tel" maxLength={30} value={f.phone} onChange={set('phone')} autoComplete="tel" className="input-soft mt-1 w-full font-normal" /></label>
          <label className={label}>Email<input type="email" maxLength={100} value={f.email} onChange={set('email')} autoComplete="email" className="input-soft mt-1 w-full font-normal" /></label>
          <label className={label}>職稱
            <select value={f.jobTitle} onChange={set('jobTitle')} className="select-soft mt-1 w-full font-normal">
              <option value="">請選擇</option>
              {JOB_TITLES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-bold uppercase tracking-widest text-brand-500">單位資訊</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>單位名稱 *<input required minLength={2} maxLength={100} value={f.institution} onChange={set('institution')} placeholder="例：崧達牙醫診所" className="input-soft mt-1 w-full font-normal" /></label>
          <label className={label}>單位類型 *
            <select required value={f.unitType} onChange={set('unitType')} className="select-soft mt-1 w-full font-normal">
              <option value="">請選擇</option>
              {UNIT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className={label}>縣市 *
            <select required value={f.city} onChange={set('city')} className="select-soft mt-1 w-full font-normal">
              <option value="">請選擇</option>
              {CITIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className={`${label} sm:col-span-2`}>單位地址<input maxLength={200} value={f.address} onChange={set('address')} placeholder="例：台中市北屯區崇德路三段100號" autoComplete="street-address" className="input-soft mt-1 w-full font-normal" /></label>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-bold uppercase tracking-widest text-brand-500">報名</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>報名人數
            <select value={f.attendees} onChange={set('attendees')} className="select-soft mt-1 w-full font-normal">
              {Array.from({ length: Math.max(maxAttendees, 1) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} 位</option>)}
            </select>
          </label>
          {paid && (
            <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm ring-1 ring-amber-600/15">
              <p className="text-amber-700">報名費 {formatNT(fee)} × {f.attendees} 位</p>
              <p className="text-lg font-bold text-amber-800">合計 {formatNT(total)}</p>
            </div>
          )}
          <label className={`${label} sm:col-span-2`}>備註<textarea rows={3} maxLength={500} value={f.note} onChange={set('note')} placeholder="同行人員姓名、飲食需求等" className="input-soft mt-1 w-full font-normal" /></label>
        </div>
      </fieldset>

      <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} className="hidden" aria-hidden="true" name="website" />

      <label className="flex items-start gap-2 text-sm leading-6 text-stone-600">
        <input type="checkbox" checked={f.consent} onChange={set('consent')} required className="mt-1" />
        <span>我同意崧達企業使用以上資料辦理本活動報名與後續活動、產品資訊聯繫。</span>
      </label>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="w-full rounded-full bg-brand-500 px-6 py-3.5 text-base font-semibold text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50">
        {busy ? '送出中…' : paid ? `送出報名（${formatNT(total)}）` : '送出報名'}
      </button>
    </form>
  )
}
