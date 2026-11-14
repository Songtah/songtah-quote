'use client'

import { useEffect, useState } from 'react'
import { PRIVACY_NOTICE_TITLE, PRIVACY_NOTICE_ITEMS, PRIVACY_CONSENT_LABEL, PRIVACY_MARKETING_LABEL } from '@/lib/privacy-notice'

type Info = { eventName: string; formTitle: string; name: string; consented: boolean; consentAt: string; marketing: boolean }

export function ConsentForm({ responseId, token }: { responseId: string; token: string }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState('')
  const [consent, setConsent] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`/api/public/consent/${responseId}?t=${encodeURIComponent(token)}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? '載入失敗'); setInfo(j) })
      .catch((e) => setError(e.message))
  }, [responseId, token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!consent) { setError('請勾選同意'); return }
    setBusy(true); setError('')
    try {
      const r = await fetch(`/api/public/consent/${responseId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token, consent, marketing }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? '送出失敗')
      setInfo((i) => (i ? { ...i, consented: true, consentAt: j.consentAt, marketing: j.marketing } : i))
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  if (error && !info) return <p className="text-center text-sm text-stone-500">{error}</p>
  if (!info) return <p className="text-center text-sm text-stone-400">載入中…</p>

  if (info.consented) {
    return (
      <div className="text-center">
        <h1 className="text-lg font-semibold text-stone-900">已收到您的同意</h1>
        <p className="mt-2 text-sm leading-6 text-stone-500">
          {info.name}您好，謝謝您。同意時間：{new Date(info.consentAt).toLocaleString('zh-TW')}
          {info.marketing ? '；您也同意收到產品與活動資訊。' : '。'}
        </p>
        <p className="mt-3 text-xs text-stone-400">若日後想查詢、更正或刪除您的資料，或不想再收到資訊，請依告知事項中的聯絡方式通知我們。</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-stone-900">{PRIVACY_NOTICE_TITLE}</h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          {info.name}您好：您先前填寫了{info.eventName ? `「${info.eventName}」的` : ''}{info.formTitle || '活動問卷'}。
          當時的問卷尚未附上個人資料蒐集告知，特此補充說明，請您閱讀後勾選是否同意。
        </p>
      </div>
      <dl className="space-y-2 rounded-2xl bg-cream-50 p-4 text-xs leading-5 text-stone-600 ring-1 ring-brand-100/60">
        {PRIVACY_NOTICE_ITEMS.map((it) => (
          <div key={it.title}><dt className="font-semibold text-stone-700">{it.title}</dt><dd>{it.body}</dd></div>
        ))}
      </dl>
      <label className="flex items-start gap-2.5 text-sm text-stone-700">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-brand-500" checked={consent} required onChange={(e) => setConsent(e.target.checked)} />
        <span>{PRIVACY_CONSENT_LABEL}<span className="text-red-500"> *</span></span>
      </label>
      <label className="flex items-start gap-2.5 text-sm text-stone-600">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-brand-500" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
        <span>{PRIVACY_MARKETING_LABEL}<span className="ml-1 text-xs text-stone-400">（選填）</span></span>
      </label>
      <p className="text-xs leading-5 text-stone-400">若您不同意，不必勾選；請依告知事項中的聯絡方式通知我們，我們會停止利用並依您的要求刪除資料。</p>
      {error && <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="min-h-12 w-full rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40">
        {busy ? '送出中…' : '送出同意'}
      </button>
    </form>
  )
}
