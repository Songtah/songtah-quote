'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FormQuestion, FormIdentity, FormKind } from '@/lib/event-forms-model'

type Def = {
  kind: FormKind; title: string; eventName: string; gift: string; open: boolean
  intro?: string; identity?: FormIdentity; questions?: FormQuestion[]
}
type Receipt = { id: string; name: string; claimed: boolean; createdAt: string }

const KEY = (formId: string) => `songtah-form-response:${formId}`

/** 訪客填寫問卷。送出後顯示完成畫面；活動問卷的完成畫面就是贈品兌換憑證，重新整理仍在。 */
export function PublicForm({ formId }: { formId: string }) {
  const [def, setDef] = useState<Def | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [duplicate, setDuplicate] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [who, setWho] = useState({ name: '', phone: '', institution: '', website: '' })
  const [answers, setAnswers] = useState<Record<string, string | string[] | number>>({})

  const loadReceipt = useCallback(async (rid: string) => {
    const res = await fetch(`/api/public/forms/${formId}?r=${encodeURIComponent(rid)}`)
    if (!res.ok) return false
    const json = await res.json()
    setDef(json); setReceipt(json.response)
    return true
  }, [formId])

  useEffect(() => {
    (async () => {
      try {
        let saved = ''
        try { saved = window.localStorage.getItem(KEY(formId)) ?? '' } catch {}
        if (saved && await loadReceipt(saved)) return
        const res = await fetch(`/api/public/forms/${formId}`)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error ?? '找不到這份表單')
        setDef(json)
      } catch (e: any) {
        setError(e?.message ?? '載入失敗，請重新整理')
      } finally { setLoading(false) }
    })()
  }, [formId, loadReceipt])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/public/forms/${formId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...who, answers }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '送出失敗，請再試一次')
      if (json.response) {
        setReceipt(json.response); setDuplicate(!!json.duplicate)
        try { window.localStorage.setItem(KEY(formId), json.response.id) } catch {}
        window.scrollTo({ top: 0 })
      }
    } catch (e: any) {
      setError(e?.message ?? '送出失敗，請再試一次')
    } finally { setBusy(false) }
  }

  if (loading) return <p className="py-8 text-center text-sm text-stone-400">載入中…</p>
  if (!def) return <p className="py-8 text-center text-sm text-stone-500">{error || '找不到這份表單。'}</p>

  const heading = def.title || (def.kind === 'survey' ? '活動問卷' : '滿意度調查')

  // ── 完成畫面 ──
  if (receipt) {
    const time = new Date(receipt.createdAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    return (
      <div className="text-center">
        <p className="text-[11px] font-bold uppercase tracking-widest text-brand-500">{def.eventName}</p>
        <h1 className="mt-1 text-xl font-bold text-stone-800">{duplicate ? '這支手機已經填過了' : '感謝你的填寫'}</h1>
        {def.kind === 'survey' ? (
          <div className={`mt-5 rounded-3xl p-5 ${receipt.claimed ? 'bg-stone-100' : 'bg-brand-50'}`}>
            <p className="text-xs font-semibold text-stone-500">{receipt.claimed ? '贈品已領取' : '請向現場人員出示此畫面領取贈品'}</p>
            {def.gift && <p className="mt-2 text-lg font-bold text-stone-800">{def.gift}</p>}
            <p className="mt-3 text-sm text-stone-600">{receipt.name}</p>
            <p className="mt-1 text-xs tabular-nums text-stone-400">填寫時間 {time}・編號 {receipt.id.slice(0, 6).toUpperCase()}</p>
            {!receipt.claimed && (
              <button type="button" onClick={() => loadReceipt(receipt.id)}
                className="mt-4 min-h-11 rounded-full border border-stone-200 bg-white px-5 text-sm font-medium text-stone-600 transition-all hover:border-stone-300 hover:bg-stone-50 active:scale-95">
                重新整理狀態
              </button>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-stone-500">你的意見已經送出，謝謝。</p>
        )}
      </div>
    )
  }

  if (!def.open || !def.questions) {
    return (
      <div className="py-6 text-center">
        <h1 className="text-lg font-bold text-stone-800">{heading}</h1>
        <p className="mt-2 text-sm text-stone-500">這份表單目前沒有開放填寫。</p>
      </div>
    )
  }

  const idRequired = def.identity === 'required'
  const set = (id: string, v: string | string[] | number) => setAnswers((a) => ({ ...a, [id]: v }))

  return (
    <form onSubmit={submit} className="space-y-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-widest text-brand-500">{def.eventName}</p>
        <h1 className="mt-1 text-xl font-bold text-stone-800">{heading}</h1>
        {def.intro && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-stone-500">{def.intro}</p>}
        {def.kind === 'survey' && def.gift && <p className="mt-3 rounded-2xl bg-brand-50 px-4 py-2.5 text-sm text-stone-700">填完可領取：<span className="font-semibold">{def.gift}</span></p>}
      </div>

      {def.identity !== 'none' && (
        <fieldset className="space-y-3">
          <legend className="text-[11px] font-bold uppercase tracking-widest text-stone-400">{idRequired ? '基本資料' : '基本資料（可不填）'}</legend>
          <label className="block text-sm font-medium text-stone-700">姓名{idRequired && <span className="text-red-500"> *</span>}
            <input className="input-soft mt-1 w-full" value={who.name} maxLength={50} required={idRequired} autoComplete="name" onChange={(e) => setWho({ ...who, name: e.target.value })} />
          </label>
          <label className="block text-sm font-medium text-stone-700">手機{idRequired && <span className="text-red-500"> *</span>}
            <input className="input-soft mt-1 w-full" value={who.phone} maxLength={30} required={idRequired} inputMode="tel" autoComplete="tel" onChange={(e) => setWho({ ...who, phone: e.target.value })} />
          </label>
          <label className="block text-sm font-medium text-stone-700">單位名稱{idRequired && <span className="text-red-500"> *</span>}
            <input className="input-soft mt-1 w-full" value={who.institution} maxLength={100} required={idRequired} placeholder="診所／技工所／學校" onChange={(e) => setWho({ ...who, institution: e.target.value })} />
          </label>
          {/* honeypot：真人看不到 */}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={who.website} onChange={(e) => setWho({ ...who, website: e.target.value })} className="hidden" aria-hidden="true" />
        </fieldset>
      )}

      {def.questions.map((q, i) => (
        <div key={q.id}>
          <p className="text-sm font-medium text-stone-700">{i + 1}. {q.label}{q.required && <span className="text-red-500"> *</span>}</p>
          {q.type === 'text' && <input className="input-soft mt-2 w-full" maxLength={200} required={q.required} value={(answers[q.id] as string) ?? ''} onChange={(e) => set(q.id, e.target.value)} />}
          {q.type === 'textarea' && <textarea className="input-soft mt-2 w-full" rows={3} maxLength={2000} required={q.required} value={(answers[q.id] as string) ?? ''} onChange={(e) => set(q.id, e.target.value)} />}
          {q.type === 'single' && (
            <div className="mt-2 flex flex-wrap gap-2">
              {q.options.map((o) => (
                <button type="button" key={o} onClick={() => set(q.id, o)} aria-pressed={answers[q.id] === o}
                  className={`chip min-h-11 transition-all active:scale-95 ${answers[q.id] === o ? 'chip-active' : ''}`}>{o}</button>
              ))}
            </div>
          )}
          {q.type === 'multi' && (
            <div className="mt-2 flex flex-wrap gap-2">
              {q.options.map((o) => {
                const cur = (answers[q.id] as string[]) ?? []
                const on = cur.includes(o)
                return (
                  <button type="button" key={o} onClick={() => set(q.id, on ? cur.filter((x) => x !== o) : [...cur, o])} aria-pressed={on}
                    className={`chip min-h-11 transition-all active:scale-95 ${on ? 'chip-active' : ''}`}>{o}</button>
                )
              })}
            </div>
          )}
          {q.type === 'rating' && (
            <div className="mt-2 flex gap-2" role="radiogroup" aria-label={q.label}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button type="button" key={n} onClick={() => set(q.id, n)} role="radio" aria-checked={answers[q.id] === n}
                  className={`chip size-11 justify-center tabular-nums transition-all active:scale-95 ${answers[q.id] === n ? 'chip-active' : ''}`}>{n}</button>
              ))}
              <span className="self-center pl-1 text-xs text-stone-400">1 最低・5 最高</span>
            </div>
          )}
        </div>
      ))}

      {error && <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="min-h-12 w-full rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40">
        {busy ? '送出中…' : '送出'}
      </button>
    </form>
  )
}
