'use client'

/**
 * 活動底下的「活動問卷」「滿意度調查」分頁（kind 決定是哪一份）。
 * 上方：填寫連結與 QR code、開放狀態、回覆數；「題目設定」收在按鈕裡。
 * 下方：各題彙總與回覆名單。活動問卷的名單可按「已領」發贈品（同一支手機只收一筆）。
 */
import { useCallback, useEffect, useState } from 'react'
import QRCode from 'qrcode'
import {
  FORM_KIND_LABEL, QUESTION_TYPES, QUESTION_TYPE_LABEL, MAX_QUESTIONS, MAX_OPTIONS,
  MAX_PRODUCTS, type EventForm, type FormKind, type FormQuestion, type FormResponse, type QuestionSummary, type FormIdentity, type FormProduct,
} from '@/lib/event-forms-model'

type Draft = { title: string; intro: string; gift: string; identity: FormIdentity; questions: FormQuestion[]; open: boolean }
const emptyDraft = (kind: FormKind): Draft => ({ title: '', intro: '', gift: '', identity: kind === 'survey' ? 'required' : 'none', questions: [], open: false })
const newQuestion = (): FormQuestion => ({ id: `q_${Math.random().toString(36).slice(2, 9)}`, label: '', type: 'single', options: ['', ''], required: true })
const fmt = (iso: string) => iso ? new Date(iso).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
const btn2 = 'min-h-11 rounded-full border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 transition-all hover:border-stone-300 hover:bg-stone-50 active:scale-95 disabled:opacity-40'
const btn1 = 'min-h-11 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40'

/**
 * 關聯產品題的產品挑選：搜尋產品目錄（/api/products/search）點選加入，或輸入自訂名稱。
 * 每個產品可以有一張圖：目錄有圖的自動帶入，沒有的（或想換的）可自己上傳。訪客填寫時看到圖片卡片。
 */
function ProductPicker({ eventId, value, onChange }: { eventId: string; value: FormProduct[]; onChange: (v: FormProduct[]) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ skuCode: string; name: string; officialName?: string; manufacturer: string; imageUrl?: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [uploading, setUploading] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const kw = q.trim()
    if (!kw) { setResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(kw)}&limit=12`)
        const data = await res.json()
        setResults(Array.isArray(data) ? data : [])
      } catch { setResults([]) } finally { setSearching(false) }
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  const chosen = new Set(value.map((p) => p.code))
  // 目錄後來才補上圖片的產品：一鍵把目錄的圖帶進來（自訂名稱的不在目錄裡，不處理）
  const [filling, setFilling] = useState(false)
  const [fillNote, setFillNote] = useState('')
  const missingCatalogImages = value.filter((p) => !p.imageUrl && !p.code.startsWith('custom:'))
  async function fillCatalogImages() {
    setFilling(true); setFillNote('')
    try {
      const found: Record<string, string> = {}
      for (const p of missingCatalogImages) {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(p.code)}&limit=12`)
        const data = await res.json().catch(() => [])
        const hit = Array.isArray(data) ? data.find((r: any) => r.skuCode === p.code) : null
        if (hit?.imageUrl) found[p.code] = hit.imageUrl
      }
      const n = Object.keys(found).length
      if (n > 0) onChange(value.map((p) => (found[p.code] ? { ...p, imageUrl: found[p.code] } : p)))
      setFillNote(n > 0 ? `已帶入 ${n} 張圖片，記得按儲存。${n < missingCatalogImages.length ? '其餘的目錄裡還沒有圖，可自己上傳。' : ''}` : '這些產品在目錄裡都還沒有圖，可自己上傳。')
    } catch { setFillNote('帶入失敗，請再試一次。') } finally { setFilling(false) }
  }
  const setImage = (code: string, imageUrl: string) => onChange(value.map((p) => (p.code === code ? { ...p, imageUrl } : p)))
  async function upload(code: string, file: File) {
    setUploading(code); setError('')
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`/api/events/${eventId}/forms/image`, { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '上傳失敗')
      setImage(code, json.url)
    } catch (e: any) { setError(e?.message ?? '上傳失敗') } finally { setUploading('') }
  }
  return (
    <div className="mt-3 space-y-3 pl-6">
      {value.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {value.map((p) => (
            <li key={p.code} className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-900/[0.06]">
              {/* 品牌固定在卡片左上角，和訪客看到的位置一致 */}
              <input className="w-full bg-transparent px-3 pb-1 pt-2.5 text-[11px] font-semibold tracking-wide text-brand-700 outline-none placeholder:font-normal placeholder:text-stone-400 focus:bg-brand-50/60"
                value={p.brand} maxLength={60} placeholder="填品牌名稱" aria-label={`${p.name} 的品牌`}
                onChange={(e) => onChange(value.map((x) => (x.code === p.code ? { ...x, brand: e.target.value } : x)))} />
              {p.imageUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={p.imageUrl} alt="" className="aspect-[4/3] w-full bg-white object-contain p-2" />
                : <div className="mx-3 flex aspect-[4/3] items-center justify-center rounded-xl bg-stone-100 text-[11px] text-stone-400">沒有圖</div>}
              <div className="flex flex-1 flex-col gap-1.5 p-3 pt-2">
                <input className="input-soft w-full !px-2.5 !py-1.5 text-xs" value={p.label ?? ''} maxLength={60} placeholder={p.name} aria-label={`${p.name} 給訪客看的名稱`}
                  onChange={(e) => onChange(value.map((x) => (x.code === p.code ? { ...x, label: e.target.value } : x)))} />
                <p className="px-1 text-[11px] leading-4 text-stone-400" title={p.name}>統計用：{p.name}</p>
                <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 px-1 pt-1 text-[11px]">
                  <label className="cursor-pointer text-brand-700 transition-colors hover:text-brand-600">
                    {uploading === p.code ? '上傳中…' : p.imageUrl ? '換圖片' : '上傳圖片'}
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={!!uploading}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(p.code, f); e.target.value = '' }} />
                  </label>
                  {p.imageUrl && <button type="button" onClick={() => setImage(p.code, '')} className="text-stone-400 transition-colors hover:text-stone-600">拿掉圖片</button>}
                  <button type="button" onClick={() => onChange(value.filter((x) => x.code !== p.code))} className="text-stone-400 transition-colors hover:text-red-600">移除產品</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {missingCatalogImages.length > 0 && (
        <button type="button" onClick={fillCatalogImages} disabled={filling}
          className="min-h-9 rounded-full bg-white px-4 text-xs font-semibold text-brand-700 ring-1 ring-brand-500/30 transition-all hover:bg-brand-50 active:scale-95 disabled:opacity-40">
          {filling ? '帶入中…' : `帶入產品目錄的圖片（${missingCatalogImages.length} 個還沒有圖）`}
        </button>
      )}
      {fillNote && <p className="text-xs text-stone-500">{fillNote}</p>}
      {error && <p className="rounded-2xl bg-red-50 px-4 py-2 text-xs text-red-600">{error}</p>}
      {value.length < MAX_PRODUCTS && (
        <input className="input-soft w-full" value={q} placeholder="搜尋產品名稱或貨號，或直接輸入自訂名稱" aria-label="搜尋產品" onChange={(e) => setQ(e.target.value)} />
      )}
      {q.trim() && (
        <ul className="max-h-64 divide-y divide-stone-900/[0.06] overflow-y-auto rounded-2xl bg-white ring-1 ring-stone-900/[0.06]">
          {searching && <li className="px-4 py-2.5 text-xs text-stone-400">搜尋中…</li>}
          {!searching && results.length === 0 && <li className="px-4 py-2.5 text-xs text-stone-400">目錄裡找不到符合的產品</li>}
          {/* 目錄是逐一貨號，問卷常用的是產品線或系列名稱：可直接用輸入的文字當選項 */}
          {!searching && !value.some((p) => p.name === q.trim()) && (
            <li>
              <button type="button" onClick={() => { onChange([...value, { code: `custom:${q.trim()}`, name: q.trim().slice(0, 100), brand: '', imageUrl: '' }]); setQ('') }}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-xs transition-colors hover:bg-brand-50/50">
                <span className="text-stone-700">用「{q.trim()}」當選項</span>
                <span className="shrink-0 text-stone-400">自訂名稱，圖片另外上傳</span>
              </button>
            </li>
          )}
          {results.map((r) => (
            <li key={r.skuCode}>
              <button type="button" disabled={chosen.has(r.skuCode)}
                onClick={() => { onChange([...value, { code: r.skuCode, name: r.officialName || r.name, brand: r.manufacturer ?? '', imageUrl: r.imageUrl ?? '' }]); setQ('') }}
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-xs transition-colors hover:bg-brand-50/50 disabled:opacity-40">
                {r.imageUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={r.imageUrl} alt="" className="size-9 shrink-0 rounded-lg bg-white object-contain ring-1 ring-stone-900/[0.06]" />
                  : <span className="size-9 shrink-0 rounded-lg bg-stone-100" aria-hidden="true" />}
                <span className="min-w-0 flex-1 text-stone-700">{r.officialName || r.name}<span className="ml-2 text-stone-400">{r.manufacturer}</span></span>
                <span className="shrink-0 tabular-nums text-stone-400">{chosen.has(r.skuCode) ? '已加入' : r.imageUrl ? r.skuCode : `${r.skuCode}・無圖`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-stone-400">訪客會看到品牌、圖片與名稱的卡片，可複選；名稱可以改成訪客好懂的說法（留空就用產品資料庫的名稱），統計仍以產品資料庫的名稱與貨號為準；結果依產品統計。可從目錄挑，也可以自己打名稱（例如產品線或系列）。圖片 JPG、PNG、WebP，4 MB 以內。已選 {value.length}/{MAX_PRODUCTS}。</p>
    </div>
  )
}

export function EventFormPanel({ eventId, kind, canEdit }: { eventId: string; kind: FormKind; canEdit: boolean }) {
  const label = FORM_KIND_LABEL[kind]
  const [form, setForm] = useState<EventForm | null>(null)
  const [responses, setResponses] = useState<FormResponse[]>([])
  const [summary, setSummary] = useState<QuestionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft(kind))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [qr, setQr] = useState('')
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const [claiming, setClaiming] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/forms?kind=${kind}`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      setForm(json.form ?? null); setResponses(json.responses ?? []); setSummary(json.summary ?? [])
      if (json.form) setDraft({ title: json.form.title, intro: json.form.intro, gift: json.form.gift, identity: json.form.identity, questions: json.form.questions, open: json.form.open })
    } else setMsg({ ok: false, text: json.error ?? '載入失敗' })
    setLoading(false)
  }, [eventId, kind])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!form) { setUrl(''); setQr(''); return }
    const link = `${window.location.origin}/f/${form.id}`
    setUrl(link)
    QRCode.toDataURL(link, { width: 480, margin: 1 }).then(setQr).catch(() => {})
  }, [form])

  async function save(next: Draft = draft) {
    setSaving(true); setMsg(null)
    try {
      const res = await fetch(`/api/events/${eventId}/forms`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...next, questions: next.questions.map((q) => ({ ...q, options: q.options.filter((o) => o.trim()) })) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '儲存失敗')
      setMsg({ ok: true, text: json.form.open ? '已儲存，目前開放填寫' : '已儲存（目前未開放）' })
      setEditing(false)
      await load()
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? '儲存失敗' })
    } finally { setSaving(false) }
  }

  async function claim(r: FormResponse, claimed: boolean) {
    setClaiming(r.id)
    try {
      const res = await fetch(`/api/events/${eventId}/forms`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, responseId: r.id, claimed }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '更新失敗')
      setResponses((prev) => prev.map((x) => (x.id === r.id ? json.response : x)))
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? '更新失敗' })
    } finally { setClaiming('') }
  }

  const setQ = (i: number, patch: Partial<FormQuestion>) => setDraft((d) => ({ ...d, questions: d.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }))
  const move = (i: number, dir: -1 | 1) => setDraft((d) => {
    const qs = [...d.questions]; const j = i + dir
    if (j < 0 || j >= qs.length) return d
    ;[qs[i], qs[j]] = [qs[j], qs[i]]
    return { ...d, questions: qs }
  })

  if (loading) return <div className="card-soft py-16 text-center text-sm text-stone-400">載入中…</div>

  const claimedCount = responses.filter((r) => r.giftClaimedAt).length
  const showIdentity = form ? form.identity !== 'none' : false

  return (
    <div className="space-y-5">
      {/* 狀態列＋設定按鈕 */}
      <div className="card-soft p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-stone-900">{label}</h3>
            <p className="mt-1 text-sm text-stone-500">
              {!form ? `還沒建立。${kind === 'survey' ? '訂好題目與贈品後開放，訪客現場掃 QR code 填寫，填完出示畫面領贈品。' : '訂好題目後開放，把連結或 QR code 發給參加者。'}`
                : `${form.open ? '目前開放填寫' : '目前未開放'}・${form.questions.length} 題・已收 ${responses.length} 份${kind === 'survey' ? `・贈品已領 ${claimedCount}` : ''}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {form && canEdit && (
              <button onClick={() => save({ ...draft, open: !form.open })} disabled={saving} className={btn2}>
                {form.open ? '關閉填寫' : '開放填寫'}
              </button>
            )}
            {canEdit && (
              <button onClick={() => setEditing((v) => !v)} aria-expanded={editing} className={form ? btn2 : btn1}>
                {editing ? '收起題目設定' : form ? '題目設定' : `建立${label}`}
              </button>
            )}
          </div>
        </div>
        {msg && <p className={`mt-3 rounded-2xl px-4 py-2.5 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{msg.text}</p>}

        {form && url && (
          <div className="mt-4 flex flex-col items-center gap-4 rounded-2xl bg-cream-50 p-4 sm:flex-row sm:items-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr && <img src={qr} alt={`${label} QR code`} className="size-36 rounded-xl bg-white p-2 ring-1 ring-stone-900/5" />}
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">填寫連結</p>
              <p className="mt-1 break-all text-xs text-stone-600">{url}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className={btn2}>{copied ? '已複製' : '複製連結'}</button>
                {qr && <a href={qr} download={`${label}QR.png`} className={`${btn2} inline-flex items-center`}>下載 QR 圖檔</a>}
                <a href={url} target="_blank" rel="noreferrer" className={`${btn2} inline-flex items-center`}>預覽</a>
              </div>
              {!form.open && <p className="mt-2 text-xs text-amber-700">目前未開放，訪客打開會看到「沒有開放填寫」。</p>}
            </div>
          </div>
        )}
      </div>

      {/* 題目設定（收在按鈕裡） */}
      {editing && (
        <div className="card-soft space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-stone-700">標題
              <input className="input-soft mt-1 w-full" value={draft.title} maxLength={100} placeholder={label} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            {kind === 'survey' ? (
              <label className="block text-sm font-medium text-stone-700">贈品
                <input className="input-soft mt-1 w-full" value={draft.gift} maxLength={200} placeholder="例：崧達環保杯一個" onChange={(e) => setDraft({ ...draft, gift: e.target.value })} />
              </label>
            ) : (
              <label className="block text-sm font-medium text-stone-700">填答者基本資料
                <select className="select-soft mt-1 w-full" value={draft.identity} onChange={(e) => setDraft({ ...draft, identity: e.target.value as FormIdentity })}>
                  <option value="none">不收（匿名）</option>
                  <option value="optional">可填可不填</option>
                  <option value="required">姓名、技所、地區、電話、職稱必填</option>
                </select>
              </label>
            )}
          </div>
          <label className="block text-sm font-medium text-stone-700">開頭說明
            <textarea className="input-soft mt-1 w-full" rows={2} value={draft.intro} maxLength={1000} onChange={(e) => setDraft({ ...draft, intro: e.target.value })} />
          </label>
          {kind === 'survey' && <p className="text-xs text-stone-400">活動問卷固定先填基本資料：姓名、技所／診所名稱、所在地區、電話、職稱（牙技師／牙醫師／其他）。這五項不用自己出題；同一支電話只收一份，贈品一人一份。</p>}

          <div className="space-y-3">
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">題目（{draft.questions.length}/{MAX_QUESTIONS}）</p>
            {draft.questions.map((q, i) => (
              <div key={q.id} className="rounded-2xl bg-cream-50 p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <span className="pt-2.5 text-sm tabular-nums text-stone-400">{i + 1}.</span>
                  <input className="input-soft min-w-0 flex-1" value={q.label} maxLength={200} placeholder="題目" aria-label={`第 ${i + 1} 題題目`} onChange={(e) => setQ(i, { label: e.target.value })} />
                  <select className="select-soft w-32" value={q.type} aria-label="題型" onChange={(e) => {
                    const type = e.target.value as FormQuestion['type']
                    setQ(i, { type, options: type === 'single' || type === 'multi' ? (q.options.length >= 2 && q.type !== 'products' ? q.options : ['', '']) : [], products: type === 'products' ? (q.products ?? []) : undefined })
                  }}>
                    {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABEL[t]}</option>)}
                  </select>
                </div>
                {q.type === 'products' && <ProductPicker eventId={eventId} value={q.products ?? []} onChange={(products) => setQ(i, { products, options: products.map((p) => p.name) })} />}
                {(q.type === 'single' || q.type === 'multi') && (
                  <div className="mt-3 space-y-2 pl-6">
                    {q.options.map((o, j) => (
                      <div key={j} className="flex gap-2">
                        <input className="input-soft min-w-0 flex-1" value={o} maxLength={100} placeholder={`選項 ${j + 1}`} aria-label={`第 ${i + 1} 題選項 ${j + 1}`}
                          onChange={(e) => setQ(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })} />
                        {q.options.length > 2 && <button type="button" onClick={() => setQ(i, { options: q.options.filter((_, k) => k !== j) })} className="rounded-full px-3 text-xs text-stone-400 transition-all hover:bg-white hover:text-red-600 active:scale-95">移除</button>}
                      </div>
                    ))}
                    {q.options.length < MAX_OPTIONS && <button type="button" onClick={() => setQ(i, { options: [...q.options, ''] })} className="rounded-full px-3 py-1.5 text-xs font-medium text-brand-700 transition-all hover:bg-white active:scale-95">＋ 新增選項</button>}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3 pl-6 text-xs text-stone-500">
                  <label className="inline-flex items-center gap-1.5"><input type="checkbox" className="accent-brand-500" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} />必填</label>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded-full px-2 py-1 transition-all hover:bg-white active:scale-95 disabled:opacity-30">上移</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === draft.questions.length - 1} className="rounded-full px-2 py-1 transition-all hover:bg-white active:scale-95 disabled:opacity-30">下移</button>
                  <button type="button" onClick={() => setDraft((d) => ({ ...d, questions: d.questions.filter((_, k) => k !== i) }))} className="rounded-full px-2 py-1 transition-all hover:bg-white hover:text-red-600 active:scale-95">刪除這題</button>
                </div>
              </div>
            ))}
            {draft.questions.length < MAX_QUESTIONS && (
              <button type="button" onClick={() => setDraft((d) => ({ ...d, questions: [...d.questions, newQuestion()] }))} className={btn2}>＋ 新增題目</button>
            )}
          </div>

          {responses.length > 0 && <p className="rounded-2xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700">已經有 {responses.length} 份回覆。刪除或更換題目後，舊回覆裡那一題的答案不會再顯示在彙總裡。</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => save()} disabled={saving} className={btn1}>{saving ? '儲存中…' : '儲存'}</button>
            <button onClick={() => { setEditing(false); if (form) setDraft({ title: form.title, intro: form.intro, gift: form.gift, identity: form.identity, questions: form.questions, open: form.open }) }} className={btn2}>取消</button>
          </div>
        </div>
      )}

      {/* 各題彙總 */}
      {form && responses.length > 0 && (
        <div className="card-soft p-5">
          <h3 className="font-semibold text-stone-900">各題結果</h3>
          <div className="mt-4 space-y-5">
            {summary.map((s, i) => (
              <div key={s.id}>
                <p className="text-sm font-medium text-stone-700">{i + 1}. {s.label}<span className="ml-2 text-xs font-normal text-stone-400">{s.answered} 人回答{s.type === 'rating' && s.answered ? `・平均 ${s.average} 分` : ''}</span></p>
                {s.counts && (
                  <div className="mt-2 space-y-1.5">
                    {Object.entries(s.counts).map(([k, n]) => {
                      const pct = s.answered ? Math.round((n / s.answered) * 100) : 0
                      return (
                        <div key={k} className="flex items-center gap-3 text-xs">
                          <span className="w-32 shrink-0 truncate text-stone-600" title={k}>{s.type === 'rating' ? `${k} 分` : k}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} /></div>
                          <span className="w-16 shrink-0 text-right tabular-nums text-stone-500">{n}（{pct}%）</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                {s.texts && s.texts.length > 0 && (
                  <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-stone-600">
                    {s.texts.map((t, k) => <li key={k} className="rounded-xl bg-cream-50 px-3 py-1.5">{t}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 回覆名單 */}
      {form && (
        <div className="card-soft overflow-hidden">
          <div className="flex items-center justify-between border-b border-stone-100 px-5 py-4">
            <h3 className="font-semibold text-stone-900">回覆名單</h3>
            <span className="text-sm text-stone-400">{responses.length} 份</span>
          </div>
          {responses.length === 0 ? (
            <div className="py-12 text-center text-sm text-stone-400">還沒有人填寫</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-cream-50 text-xs text-stone-500">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">填寫時間</th>
                    {showIdentity && <><th className="px-4 py-3 text-left font-medium">姓名</th><th className="px-4 py-3 text-left font-medium">技所／診所</th><th className="px-4 py-3 text-left font-medium">電話</th></>}
                    {form.questions.map((q) => <th key={q.id} className="max-w-[12rem] truncate px-4 py-3 text-left font-medium" title={q.label}>{q.label}</th>)}
                    {kind === 'survey' && <th className="px-4 py-3 text-left font-medium">贈品</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-900/[0.06]">
                  {responses.map((r) => (
                    <tr key={r.id} className="align-top transition-colors hover:bg-brand-50/50">
                      <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-stone-400">{fmt(r.createdAt)}<br />{r.id.slice(0, 6).toUpperCase()}</td>
                      {showIdentity && <><td className="px-4 py-3 text-stone-800">{r.name || '—'}{r.jobTitle && <p className="text-[11px] text-stone-400">{r.jobTitle}</p>}</td><td className="px-4 py-3 text-stone-600">{r.institution || '—'}{(r.city || r.district) && <p className="text-[11px] text-stone-400">{r.city}{r.district}</p>}</td><td className="whitespace-nowrap px-4 py-3 text-stone-600">{r.phone || '—'}</td></>}
                      {form.questions.map((q) => {
                        const v = r.answers?.[q.id]
                        return <td key={q.id} className="max-w-[16rem] px-4 py-3 text-stone-600">{v == null || v === '' ? '—' : Array.isArray(v) ? v.join('、') : String(v)}</td>
                      })}
                      {kind === 'survey' && (
                        <td className="whitespace-nowrap px-4 py-3">
                          {r.giftClaimedAt ? (
                            <div className="text-xs">
                              <span className="rounded-full bg-stone-100 px-2.5 py-1 font-medium text-stone-600">已領</span>
                              <p className="mt-1 text-stone-400">{fmt(r.giftClaimedAt)}・{r.giftClaimedBy}</p>
                              {canEdit && <button onClick={() => claim(r, false)} disabled={claiming === r.id} className="mt-1 rounded-full px-2 py-0.5 text-stone-400 transition-all hover:bg-stone-100 hover:text-stone-600 active:scale-95">取消</button>}
                            </div>
                          ) : canEdit ? (
                            <button onClick={() => claim(r, true)} disabled={claiming === r.id}
                              className="min-h-9 rounded-full bg-brand-500 px-4 text-xs font-semibold text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40">
                              {claiming === r.id ? '處理中…' : '已領'}
                            </button>
                          ) : <span className="text-xs text-stone-400">未領</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
