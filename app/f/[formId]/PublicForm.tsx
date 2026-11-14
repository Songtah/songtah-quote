'use client'

import { useCallback, useEffect, useState } from 'react'
import { JOB_TITLES, type FormQuestion, type FormIdentity, type FormKind } from '@/lib/event-forms-model'
import { TW_CITIES, TW_DISTRICTS } from '@/lib/tw-districts'
import { PRIVACY_NOTICE_TITLE, PRIVACY_NOTICE_ITEMS, PRIVACY_CONSENT_LABEL, PRIVACY_MARKETING_LABEL } from '@/lib/privacy-notice'

type Def = {
  kind: FormKind; title: string; eventName: string; gift: string; giftImage?: string; open: boolean
  intro?: string; identity?: FormIdentity; questions?: FormQuestion[]
}
type Receipt = { id: string; name: string; claimed: boolean; createdAt: string }

const KEY = (formId: string) => `songtah-form-response:${formId}`

/** 訪客填寫問卷。送出後顯示完成畫面；活動問卷的完成畫面就是贈品兌換憑證，重新整理仍在。 */
/** 產品名稱分行：英文型號一行、中文名稱另起一行（例：SORINO K3 Pro／移動式吸塵器）。只有一種文字就不拆。 */
function splitProductName(name: string): string[] {
  const i = name.search(/[\u4e00-\u9fff]/)
  if (i <= 0) return [name]
  const head = name.slice(0, i).trim()
  return head ? [head, name.slice(i).trim()] : [name]
}

export function PublicForm({ formId }: { formId: string }) {
  const [def, setDef] = useState<Def | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [duplicate, setDuplicate] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [consent, setConsent] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [who, setWho] = useState({ name: '', phone: '', institution: '', city: '', district: '', jobTitle: '', email: '', website: '' })
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
    if (def?.identity === 'required' && !who.jobTitle) { setError('請選擇職稱'); return }
    const givesPersonal = def?.identity !== 'none' && !!(who.name || who.phone || who.institution || who.email)
    if (givesPersonal && (!consent || !marketing)) { setError('請閱讀個人資料蒐集告知事項並勾選兩項同意'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/public/forms/${formId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...who, answers, consent, marketing }),
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
            {def.giftImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={def.giftImage} alt="" className="mx-auto mt-3 aspect-square w-40 rounded-2xl bg-white object-contain p-2 ring-1 ring-stone-900/[0.06]" />
            )}
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
        {def.kind === 'survey' && (def.gift || def.giftImage) && (
          <div className="mt-3 flex items-center gap-3 rounded-2xl bg-brand-50 p-3">
            {def.giftImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={def.giftImage} alt="" className="size-20 shrink-0 rounded-xl bg-white object-contain p-1 ring-1 ring-stone-900/[0.06]" />
            )}
            <p className="min-w-0 text-sm leading-6 text-stone-700">
              <span className="block text-xs font-semibold text-brand-600">填完可領取</span>
              <span className="font-semibold">{def.gift || '現場贈品'}</span>
            </p>
          </div>
        )}
      </div>

      {def.identity !== 'none' && (
        <fieldset className="space-y-3">
          <legend className="text-[11px] font-bold uppercase tracking-widest text-stone-400">{idRequired ? '基本資料' : '基本資料（可不填）'}</legend>
          <label className="block text-sm font-medium text-stone-700">姓名{idRequired && <span className="text-red-500"> *</span>}
            <input className="input-soft mt-1 w-full" value={who.name} maxLength={50} required={idRequired} autoComplete="name" onChange={(e) => setWho({ ...who, name: e.target.value })} />
          </label>
          <label className="block text-sm font-medium text-stone-700">技所／診所名稱{idRequired && <span className="text-red-500"> *</span>}
            <input className="input-soft mt-1 w-full" value={who.institution} maxLength={100} required={idRequired} autoComplete="organization" onChange={(e) => setWho({ ...who, institution: e.target.value })} />
          </label>
          <div>
            <p className="text-sm font-medium text-stone-700">技所／診所地區{idRequired && <span className="text-red-500"> *</span>}</p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <select className="select-soft w-full" aria-label="縣市" value={who.city} required={idRequired} onChange={(e) => setWho({ ...who, city: e.target.value, district: '' })}>
                <option value="">縣市</option>
                {TW_CITIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select className="select-soft w-full" aria-label="鄉鎮市區" value={who.district} required={idRequired} disabled={!who.city} onChange={(e) => setWho({ ...who, district: e.target.value })}>
                <option value="">鄉鎮市區</option>
                {(TW_DISTRICTS[who.city] ?? []).map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <label className="block text-sm font-medium text-stone-700">電話{idRequired && <span className="text-red-500"> *</span>}
            <input className="input-soft mt-1 w-full" value={who.phone} maxLength={30} required={idRequired} inputMode="tel" autoComplete="tel" onChange={(e) => setWho({ ...who, phone: e.target.value })} />
          </label>
          <label className="block text-sm font-medium text-stone-700">信箱{idRequired && <span className="text-red-500"> *</span>}
            <input className="input-soft mt-1 w-full" type="email" value={who.email} maxLength={120} required={idRequired} inputMode="email" autoComplete="email" onChange={(e) => setWho({ ...who, email: e.target.value })} />
          </label>
          <div>
            <p className="text-sm font-medium text-stone-700">職稱{idRequired && <span className="text-red-500"> *</span>}</p>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="職稱">
              {JOB_TITLES.map((j) => (
                <button type="button" key={j} role="radio" aria-checked={who.jobTitle === j} onClick={() => setWho({ ...who, jobTitle: j })}
                  className={`chip min-h-11 transition-all active:scale-95 ${who.jobTitle === j ? 'chip-active' : ''}`}>{j}</button>
              ))}
            </div>
          </div>
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
          {q.type === 'products' && (() => {
            // 一律用卡片；整題都沒有圖時不留空白圖框，卡片只放品牌與名稱
            const hasImage = (q.products ?? []).some((p) => p.imageUrl)
            return (
              <div className="mt-2 grid grid-cols-2 gap-2.5">
                {(q.products ?? []).map((p) => {
                  const cur = (answers[q.id] as string[]) ?? []
                  const on = cur.includes(p.name)
                  return (
                    <button type="button" key={p.code} onClick={() => set(q.id, on ? cur.filter((x) => x !== p.name) : [...cur, p.name])} aria-pressed={on}
                      className={`relative flex flex-col overflow-hidden rounded-2xl text-left transition-all active:scale-95 ${on ? 'bg-brand-50 ring-2 ring-brand-500 shadow-md shadow-brand-500/20' : 'bg-white shadow-sm ring-1 ring-stone-900/[0.08]'}`}>
                      {/* 品牌固定在卡片左上角；沒填品牌也保留這一列，名稱才會對齊 */}
                      <span className="block min-h-[1.75rem] truncate px-3 pr-9 pt-2.5 text-[11px] font-semibold tracking-wide text-brand-600">{p.brand}</span>
                      {hasImage && (p.imageUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.imageUrl} alt="" loading="lazy" className="aspect-square w-full object-contain p-2" />
                        : <div className="mx-3 aspect-square rounded-xl bg-stone-100" aria-hidden="true" />)}
                      <span className={`block px-3 pb-3 pt-1 text-center text-sm font-medium leading-5 ${on ? 'text-brand-800' : 'text-stone-800'}`}>
                        {splitProductName(p.label || p.name).map((line, i) => <span key={i} className="block">{line}</span>)}
                      </span>
                      {on && <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white" aria-hidden="true">✓</span>}
                    </button>
                  )
                })}
              </div>
            )
          })()}
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

      {def.identity !== 'none' && (
        <div className="rounded-2xl bg-cream-50 p-4 ring-1 ring-brand-100/60">
          <button type="button" onClick={() => setNoticeOpen((v) => !v)} aria-expanded={noticeOpen}
            className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-stone-800 transition-all active:scale-[0.99]">
            {PRIVACY_NOTICE_TITLE}
            <span className="shrink-0 text-xs font-medium text-brand-700">{noticeOpen ? '收合' : '展開閱讀'}</span>
          </button>
          {noticeOpen && (
            <dl className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1 text-xs leading-5 text-stone-600">
              {PRIVACY_NOTICE_ITEMS.map((it) => (
                <div key={it.title}><dt className="font-semibold text-stone-700">{it.title}</dt><dd>{it.body}</dd></div>
              ))}
            </dl>
          )}
          <label className="mt-3 flex items-start gap-2.5 text-sm text-stone-700">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-brand-500" checked={consent} required={idRequired} onChange={(e) => setConsent(e.target.checked)} />
            <span>{PRIVACY_CONSENT_LABEL}{idRequired && <span className="text-red-500"> *</span>}</span>
          </label>
          <label className="mt-2 flex items-start gap-2.5 text-sm text-stone-700">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-brand-500" checked={marketing} required={idRequired} onChange={(e) => setMarketing(e.target.checked)} />
            <span>{PRIVACY_MARKETING_LABEL}{idRequired && <span className="text-red-500"> *</span>}</span>
          </label>
        </div>
      )}

      {error && <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="min-h-12 w-full rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40">
        {busy ? '送出中…' : '送出'}
      </button>
    </form>
  )
}
