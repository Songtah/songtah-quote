'use client'

/**
 * 活動詳情 →「線上報名頁」設定：一個活動一個報名頁（/register/[活動 id]）。
 * 開關、收費與報名費、付款說明、名額、廣告圖；儲存後即時生效，並提供連結、QR code 與預覽。
 */
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { EventItem } from '@/lib/notion/events'
import { formatNT } from '@/lib/online-registration'

type Settings = Pick<EventItem, 'onlineRegistration' | 'paid' | 'fee' | 'paymentNote' | 'bannerUrl' | 'capacity' | 'deadline'>

export function EventRegistrationPageSettings({
  event, seatsTaken, onSaved,
}: { event: EventItem; seatsTaken: number; onSaved: (patch: Partial<EventItem>) => void }) {
  const [s, setS] = useState<Settings>({
    onlineRegistration: event.onlineRegistration, paid: event.paid, fee: event.fee,
    paymentNote: event.paymentNote, bannerUrl: event.bannerUrl, capacity: event.capacity, deadline: event.deadline,
  })
  const [busy, setBusy] = useState<'' | 'save' | 'upload'>('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  const [url, setUrl] = useState('')

  useEffect(() => {
    const link = `${window.location.origin}/register/${event.id}`
    setUrl(link)
    QRCode.toDataURL(link, { width: 480, margin: 1 }).then(setQr).catch(() => {})
  }, [event.id])

  const dirty = s.onlineRegistration !== event.onlineRegistration || s.paid !== event.paid || s.fee !== event.fee ||
    s.paymentNote !== event.paymentNote || s.capacity !== event.capacity || (s.deadline || '') !== (event.deadline || '')

  async function save() {
    setBusy('save'); setMsg(null)
    try {
      if (s.paid && !(s.fee > 0)) throw new Error('收費活動請填寫報名費')
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onlineRegistration: s.onlineRegistration, paid: s.paid, fee: s.paid ? s.fee : 0,
          paymentNote: s.paymentNote, capacity: s.capacity || 0,
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
            {s.paid && (
              <label className="flex items-center gap-2 text-sm text-stone-600">
                每人報名費 NT$
                <input type="number" min={1} step={100} value={s.fee || ''} onChange={(e) => setS({ ...s, fee: Number(e.target.value) })} className="input-soft w-32" />
              </label>
            )}
            {!s.paid && <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">免費參加</span>}
          </div>

          {s.paid && (
            <label className={label}>付款說明（報名完成後顯示給報名者）
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
            <span className={label}>廣告圖（建議橫式 1200×630，JPG／PNG／WebP，4 MB 內）</span>
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
            {s.paid && s.fee > 0 && <span className="text-xs text-stone-400">報名頁顯示：報名費 {formatNT(s.fee)}／人</span>}
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
