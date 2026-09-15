'use client'

import { useState } from 'react'

const CITIES = ['台北市', '新北市', '基隆市', '桃園市', '新竹市', '新竹縣', '苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣',
  '嘉義市', '嘉義縣', '台南市', '高雄市', '屏東縣', '宜蘭縣', '花蓮縣', '台東縣', '澎湖縣', '金門縣', '連江縣']

export function CheckinForm({ eventId, token }: { eventId: string; token: string }) {
  const [form, setForm] = useState({ institution: '', contact: '', phone: '', city: '', website: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/public/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, eventId, t: token }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '簽到失敗')
      setDone(true)
    } catch (err: any) {
      setError(err?.message ?? '簽到失敗，請稍後再試')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="mt-6 rounded-2xl bg-emerald-50 p-5 text-center ring-1 ring-emerald-600/15">
        <p className="text-lg font-bold text-emerald-800">簽到完成，謝謝您！</p>
        <p className="mt-1 text-sm text-emerald-700">歡迎到攤位與我們聊聊。</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      <label className="block">
        <span className="text-sm font-semibold text-stone-700">診所／技工所名稱</span>
        <input required minLength={2} maxLength={100} value={form.institution} onChange={set('institution')} className="input-soft mt-1 w-full" placeholder="例：崧達牙醫診所" />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-stone-700">姓名</span>
        <input required maxLength={50} value={form.contact} onChange={set('contact')} className="input-soft mt-1 w-full" autoComplete="name" />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-stone-700">聯絡電話</span>
        <input required type="tel" maxLength={30} value={form.phone} onChange={set('phone')} className="input-soft mt-1 w-full" autoComplete="tel" inputMode="tel" />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-stone-700">縣市</span>
        <select value={form.city} onChange={set('city')} className="select-soft mt-1 w-full">
          <option value="">請選擇</option>
          {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      {/* honeypot：對真人隱藏 */}
      <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} className="hidden" aria-hidden="true" name="website" />
      {error && <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="w-full rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-50">
        {busy ? '送出中…' : '完成簽到'}
      </button>
      <p className="text-center text-[11px] leading-5 text-stone-400">填寫資料僅供崧達企業聯繫活動相關資訊使用。</p>
    </form>
  )
}
