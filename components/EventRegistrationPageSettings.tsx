'use client'

/**
 * 活動詳情 →「線上報名頁」設定：一個活動一個報名頁（/register/[活動 id]）。
 * 開關、收費與報名費／報名方案、付款說明、名額、廣告圖；儲存後即時生效，並提供連結、QR code 與預覽。
 */
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { EventItem } from '@/lib/notion/events'
import { formatNT, MAX_PLANS, MAX_ATTENDEES_PER_SIGNUP, shortCodeOf, FORM_FIELDS, FIELD_MODES } from '@/lib/online-registration'

type Settings = Pick<EventItem, 'onlineRegistration' | 'paid' | 'fee' | 'paymentNote' | 'bannerUrl' | 'capacity' | 'deadline' | 'plans' | 'formConfig'>

export function EventRegistrationPageSettings({
  event, seatsTaken, onSaved,
}: { event: EventItem; seatsTaken: number; onSaved: (patch: Partial<EventItem>) => void }) {
  const [s, setS] = useState<Settings>({
    onlineRegistration: event.onlineRegistration, paid: event.paid, fee: event.fee,
    paymentNote: event.paymentNote, bannerUrl: event.bannerUrl, capacity: event.capacity, deadline: event.deadline,
    plans: event.plans, formConfig: event.formConfig,
  })
  const [busy, setBusy] = useState<'' | 'save' | 'upload'>('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  const [url, setUrl] = useState('')

  useEffect(() => {
    // 對外一律給短網址（/r/前 6 碼），QR code 也較疏、較好掃；完整網址 /register/[id] 仍可用
    const link = `${window.location.origin}/r/${shortCodeOf(event.id)}`
    setUrl(link)
    QRCode.toDataURL(link, { width: 480, margin: 1 }).then(setQr).catch(() => {})
  }, [event.id])

  const dirty = s.onlineRegistration !== event.onlineRegistration || s.paid !== event.paid || s.fee !== event.fee ||
    s.paymentNote !== event.paymentNote || s.capacity !== event.capacity || (s.deadline || '') !== (event.deadline || '') ||
    JSON.stringify(s.plans) !== JSON.stringify(event.plans) || JSON.stringify(s.formConfig) !== JSON.stringify(event.formConfig)
  const setPlan = (i: number, patch: Partial<Settings['plans'][number]>) =>
    setS((x) => ({ ...x, plans: x.plans.map((p, j) => (j === i ? { ...p, ...patch } : p)) }))

  async function save() {
    setBusy('save'); setMsg(null)
    try {
      if (s.plans.some((p) => !p.name.trim() || !(p.people >= 1))) throw new Error('報名方案請填寫名稱與人數')
      if (s.paid && !s.plans.length && !(s.fee > 0)) throw new Error('收費活動請填寫報名費，或新增報名方案')
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onlineRegistration: s.onlineRegistration, paid: s.paid, fee: s.paid ? s.fee : 0,
          paymentNote: s.paymentNote, capacity: s.capacity || 0,
          plans: s.plans.map((p) => ({ ...p, name: p.name.trim() })),
          formConfig: s.formConfig,
          ...(s.deadline ? { deadline: s.deadline } : {}),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '儲存失敗')
      onSaved({ ...s, fee: s.paid ? s.fee : 0 })
      setMsg({ ok: true, text: s.onlineRegistration ? '已儲存，報名頁已開放' : '已儲存（報名頁目前關閉）' })
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? '儲存失敗' })
    } finally {
      setBusy('')
    }
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy('upload'); setMsg(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/events/${event.id}/banner`, { method: 'POST', body: form })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '上傳失敗')
      setS((x) => ({ ...x, bannerUrl: json.url }))
      onSaved({ bannerUrl: json.url })
      setMsg({ ok: true, text: '廣告圖已更新' })
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message ?? '上傳失敗' })
    } finally {
      setBusy('')
    }
  }

  async function removeBanner() {
    setBusy('upload'); setMsg(null)
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bannerUrl: '' }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '移除失敗')
      setS((x) => ({ ...x, bannerUrl: '' }))
      onSaved({ bannerUrl: '' })
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message ?? '移除失敗' })
    } finally {
      setBusy('')
    }
  }

  const label = 'block text-xs font-semibold text-stone-600'
  return (
    <div className="card-soft p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-stone-900">線上報名頁</h3>
          <p className="mt-1 text-sm leading-6 text-stone-500">
            這個活動專屬的報名網頁。報名資料直接進入下方報名名單，並自動配對客戶。
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-full bg-stone-100 px-4 py-2 text-sm font-semibold text-stone-700">
          <input type="checkbox" checked={s.onlineRegistration} onChange={(e) => setS({ ...s, onlineRegistration: e.target.checked })} />
          開放線上報名
        </label>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-stone-700">
              <input type="checkbox" checked={s.paid} onChange={(e) => setS({ ...s, paid: e.target.checked })} />
              收費活動
            </label>
            {s.paid && !s.plans.length && (
              <label className="flex items-center gap-2 text-sm text-stone-600">
                每人報名費 NT$
                <input type="number" min={1} step={100} value={s.fee || ''} onChange={(e) => setS({ ...s, fee: Number(e.target.value) })} className="input-soft w-32" />
              </label>
            )}
            {!s.paid && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">免費參加</span>}
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={label}>報名方案（選填；設定後報名者從方案中選一個，金額與人數依方案）</span>
              {s.plans.length < MAX_PLANS && (
                <button type="button" onClick={() => setS((x) => ({ ...x, plans: [...x.plans, { name: '', price: x.fee || 0, people: 1 }] }))}
                  className="min-h-10 rounded-full bg-stone-100 px-4 text-xs font-semibold text-stone-600 transition-all hover:bg-stone-200 active:scale-95">
                  ＋ 新增方案
                </button>
              )}
            </div>
            {s.plans.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {s.plans.map((p, i) => (
                  <li key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-2xl bg-cream-50 p-3 sm:grid-cols-[1fr_9rem_6rem_auto] sm:items-center">
                    <input value={p.name} onChange={(e) => setPlan(i, { name: e.target.value })} maxLength={40}
                      placeholder="例：台北場單人" aria-label={`方案 ${i + 1} 名稱`} className="input-soft col-span-2 text-sm sm:col-span-1" />
                    {s.paid && (
                      <label className="flex items-center gap-1 text-xs text-stone-500">NT$
                        <input type="number" min={0} step={100} value={p.price || ''} onChange={(e) => setPlan(i, { price: Number(e.target.value) })}
                          aria-label={`方案 ${i + 1} 金額`} className="input-soft w-full text-sm" />
                      </label>
                    )}
                    <label className="flex items-center gap-1 text-xs text-stone-500">
                      <select value={p.people} onChange={(e) => setPlan(i, { people: Number(e.target.value) })} aria-label={`方案 ${i + 1} 人數`} className="select-soft text-sm">
                        {Array.from({ length: MAX_ATTENDEES_PER_SIGNUP }, (_, n) => n + 1).map((n) => <option key={n} value={n}>{n} 位</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setS((x) => ({ ...x, plans: x.plans.filter((_, j) => j !== i) }))}
                      className="min-h-10 rounded-full px-3 text-xs font-semibold text-stone-500 transition-all hover:bg-stone-200 active:scale-95">刪除</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-stone-500">{s.paid ? '未設定方案：報名者自選人數，金額＝每人報名費 × 人數。' : '未設定方案：報名者自選人數。'}</p>
            )}
          </div>

          <div>
            <span className={label}>報名表欄位（姓名、手機、單位名稱固定必填）</span>
            <ul className="mt-2 divide-y divide-stone-900/[0.06] rounded-2xl bg-cream-50 px-3">
              {FORM_FIELDS.map((fd) => (
                <li key={fd.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm text-stone-700">
                    {fd.label}
                    {'hint' in fd && fd.key !== 'address' && <span className="ml-2 text-xs text-stone-500">{fd.hint}</span>}
                  </span>
                  <span role="radiogroup" aria-label={`${fd.label}設定`} className="inline-flex rounded-full bg-white p-0.5 ring-1 ring-stone-900/10">
                    {FIELD_MODES.map((m) => {
                      const on = s.formConfig[fd.key] === m.value
                      return (
                        <button key={m.value} type="button" role="radio" aria-checked={on}
                          onClick={() => setS((x) => ({ ...x, formConfig: { ...x.formConfig, [fd.key]: m.value } }))}
                          className={`min-h-9 rounded-full px-3 text-xs font-semibold transition-all active:scale-95 ${
                            on ? (m.value === 'off' ? 'bg-stone-200 text-stone-700' : 'bg-brand-500 text-white') : 'text-stone-500 hover:text-stone-700'}`}>
                          {m.label}
                        </button>
                      )
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {s.paid && (
            <label className={label}>付款說明（報名表上與報名完成後都會顯示：匯款帳號、匯款期限、退費規則等）
              <textarea rows={3} maxLength={1900} value={s.paymentNote} onChange={(e) => setS({ ...s, paymentNote: e.target.value })}
                placeholder={'例：請於 3 日內匯款\n銀行：○○銀行（000）帳號：0000-000-000000\n匯款後請告知帳號末 5 碼'}
                className="input-soft mt-1 w-full text-sm font-normal" />
            </label>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>名額（留空＝不限）
              <input type="number" min={0} value={s.capacity || ''} onChange={(e) => setS({ ...s, capacity: Number(e.target.value) })} className="input-soft mt-1 w-full text-sm font-normal" />
              <span className="mt-1 block font-normal text-stone-400">目前已報名 {seatsTaken} 位{s.capacity > 0 ? `，剩 ${Math.max(s.capacity - seatsTaken, 0)} 位` : ''}</span>
            </label>
            <label className={label}>報名截止日（留空＝活動當天）
              <input type="date" value={(s.deadline || '').slice(0, 10)} onChange={(e) => setS({ ...s, deadline: e.target.value })} className="input-soft mt-1 w-full text-sm font-normal" />
            </label>
          </div>

          <div>
            <span className={label}>廣告圖（橫式，寬 1200px 以上，例如 1200×630、2000×770；JPG／PNG／WebP，4 MB 內；整張完整顯示不裁切）</span>
            {s.bannerUrl ? (
              <div className="mt-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.bannerUrl} alt="廣告圖" className="max-h-56 w-full rounded-2xl bg-stone-100 object-contain ring-1 ring-stone-900/5" />
                <div className="mt-2 flex gap-2">
                  <label className="button-secondary inline-flex min-h-10 cursor-pointer items-center px-4 text-xs">
                    {busy === 'upload' ? '處理中…' : '更換圖片'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} disabled={!!busy} className="hidden" />
                  </label>
                  <button onClick={removeBanner} disabled={!!busy} className="rounded-full bg-stone-100 px-4 text-xs font-semibold text-stone-600 transition-all hover:bg-stone-200 active:scale-95 disabled:opacity-40">移除</button>
                </div>
              </div>
            ) : (
              <label className="mt-2 flex min-h-28 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 text-sm text-stone-500 transition-all hover:border-brand-400 hover:text-brand-600">
                {busy === 'upload' ? '上傳中…' : '＋ 上傳廣告圖'}
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} disabled={!!busy} className="hidden" />
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={save} disabled={!!busy || !dirty} className="button-primary min-h-11 px-6 disabled:opacity-40">
              {busy === 'save' ? '儲存中…' : '儲存設定'}
            </button>
            {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</span>}
            {s.paid && !s.plans.length && s.fee > 0 && <span className="text-xs text-stone-500">報名頁顯示：報名費 {formatNT(s.fee)}／人</span>}
          </div>
        </div>

        <div className="rounded-2xl bg-cream-50 p-4 text-center">
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="報名頁 QR code" className="mx-auto size-40 rounded-xl bg-white p-2 ring-1 ring-stone-900/5" />
          )}
          <p className="mt-2 break-all text-[11px] text-stone-500">{url}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 ring-1 ring-stone-900/10 transition-all hover:bg-stone-50 active:scale-95">
              {copied ? '已複製' : '複製連結'}
            </button>
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 ring-1 ring-stone-900/10 transition-all hover:bg-stone-50 active:scale-95">
              預覽報名頁
            </a>
            {qr && (
              <a href={qr} download={`報名QR-${event.name}.png`}
                className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 ring-1 ring-stone-900/10 transition-all hover:bg-stone-50 active:scale-95">
                下載 QR
              </a>
            )}
          </div>
          {!event.onlineRegistration && <p className="mt-3 text-xs text-amber-700">尚未開放：勾選「開放線上報名」並儲存後才能報名</p>}
        </div>
      </div>
    </div>
  )
}
