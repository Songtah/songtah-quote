'use client'

/**
 * EventImportContent —— 歷史活動參與紀錄匯入
 *
 * 流程：貼上／上傳 → 確認欄位對應 → 預覽（不寫入）→ 確認匯入（建活動 → 分批寫紀錄 → 自動配對）。
 * 解析規則在 lib/event-import.ts，寫入與配對在 /api/events/import。
 */
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  parseDelimited, detectColumns, toImportRow, eventKey,
  EVENT_TYPES, IMPORT_MAX_ROWS, type ImportField, type ImportRow,
} from '@/lib/event-import'

const FIELD_LABEL: Record<ImportField, string> = {
  eventName: '活動名稱', eventDate: '活動日期', eventType: '活動類型', institution: '機構名稱',
  contact: '姓名', phone: '電話', email: '信箱', city: '縣市', status: '出席狀態', attendees: '人數',
}
const FIELD_ORDER: ImportField[] = ['institution', 'contact', 'phone', 'city', 'eventName', 'eventDate', 'status', 'email', 'eventType', 'attendees']

type Preview = {
  rows: number
  counts: { toImport: number; duplicate: number; matched: number; created: number; unmatched: number; cancelled: number }
  events: { name: string; date: string; type: string; existingId: string; rows: number; duplicates: number }[]
  newCustomers: { name: string; area: string; assignTo: string }[]
  details: { index: number; eventName: string; institution: string; contact: string; result: string; note: string }[]
}

type Phase = 'input' | 'preview' | 'importing' | 'done'

async function post(body: unknown) {
  const res = await fetch('/api/events/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `處理失敗（${res.status}）`)
  return json
}

/** Excel 在 Windows 另存的 CSV 多半是 Big5；先試 UTF-8，失敗再用 Big5 */
async function readTextFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) }
  catch { return new TextDecoder('big5').decode(buf) }
}

export function EventImportContent() {
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState('')
  const [cols, setCols] = useState<Partial<Record<ImportField, number>> | null>(null)
  const [defaults, setDefaults] = useState({ eventName: '', eventDate: '', eventType: '培訓', status: '已到場' })
  const [phase, setPhase] = useState<Phase>('input')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [detailFilter, setDetailFilter] = useState('')
  const [progress, setProgress] = useState('')
  const [summary, setSummary] = useState<{ events: number; imported: number; skipped: number; matched: number; created: number; unmatched: number } | null>(null)

  const table = useMemo(() => (raw.trim() ? parseDelimited(raw) : []), [raw])
  const headers = table[0] ?? []
  const body = table.slice(1)
  const effectiveCols = useMemo(() => cols ?? detectColumns(headers), [cols, headers])

  const parsed = useMemo(() => {
    const rows: ImportRow[] = []
    const errors: { line: number; error: string }[] = []
    body.forEach((cells, i) => {
      const r = toImportRow(cells, effectiveCols, defaults)
      if (r.row) rows.push(r.row)
      else errors.push({ line: i + 2, error: r.error ?? '無效' })
    })
    return { rows, errors }
  }, [body, effectiveCols, defaults])

  const needsEventDefaults = effectiveCols.eventName === undefined || effectiveCols.eventDate === undefined

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (/\.xlsx?$/i.test(file.name)) {
      setError('Excel 檔請直接在 Excel 全選複製後貼到下方，或另存成 CSV 再上傳。')
      return
    }
    setError('')
    setFileName(file.name)
    setRaw(await readTextFile(file))
    setCols(null)
  }

  function setCol(field: ImportField, value: string) {
    setCols({ ...effectiveCols, [field]: value === '' ? undefined : Number(value) })
  }

  async function runPreview() {
    setBusy(true); setError('')
    try {
      setPreview(await post({ action: 'preview', rows: parsed.rows }))
      setPhase('preview')
    } catch (e: any) {
      setError(e?.message ?? '預覽失敗')
    } finally {
      setBusy(false)
    }
  }

  async function runImport() {
    if (!preview) return
    setBusy(true); setError(''); setPhase('importing')
    try {
      setProgress('建立活動中…')
      const evRes = await post({ action: 'create-events', events: preview.events.map((e) => ({ name: e.name, date: e.date, type: e.type })) })
      const eventIds: Record<string, string> = evRes.ids

      const createdIds: string[] = []
      let skipped = 0
      const CHUNK = 40
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        setProgress(`寫入紀錄 ${Math.min(i + CHUNK, parsed.rows.length)} / ${parsed.rows.length}…`)
        const r = await post({ action: 'import-rows', rows: parsed.rows.slice(i, i + CHUNK), eventIds })
        createdIds.push(...r.createdIds)
        skipped += r.skipped
      }

      let matched = 0, created = 0, unmatched = 0
      if (createdIds.length) {
        for (let round = 1; round <= 40; round++) {
          setProgress(`配對客戶中（第 ${round} 輪，已新建 ${created} 家）…`)
          const p = await post({ action: 'process', ids: createdIds })
          matched += p.customerMatched; created += p.customerCreated; unmatched += p.unmatched
          if (!p.deferred) break
        }
      }
      setSummary({ events: evRes.created, imported: createdIds.length, skipped, matched, created, unmatched })
      setPhase('done')
    } catch (e: any) {
      setError(`${e?.message ?? '匯入失敗'}。已寫入的紀錄會保留，重新執行匯入會自動略過重複的，不會重複建立。`)
      setPhase('preview')
    } finally {
      setBusy(false); setProgress('')
    }
  }

  function reset() {
    setRaw(''); setFileName(''); setCols(null); setPreview(null); setSummary(null); setPhase('input'); setError('')
  }

  const shownDetails = (preview?.details ?? []).filter((d) => !detailFilter || d.result.startsWith(detailFilter))

  return (
    <div className="space-y-5">
      <Link href="/events" className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm text-stone-500 transition-all hover:bg-white hover:text-brand-600 active:scale-95">
        ← 返回活動列表
      </Link>

      {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}

      {phase === 'input' && (
        <>
          <div className="card-soft p-5 sm:p-6">
            <h2 className="text-lg font-bold text-stone-800">1. 貼上名單</h2>
            <p className="mt-1 text-sm leading-6 text-stone-500">
              在 Excel 選取含表頭的整個範圍，複製後貼到下方；或上傳 CSV。第一列必須是表頭（例如：課程名稱、日期、診所名稱、姓名、電話、縣市、出席）。
              多場課程可以放在同一份，也可以一場一份。
            </p>
            <textarea
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setFileName(''); setCols(null) }}
              rows={8}
              placeholder={'課程名稱\t日期\t診所名稱\t姓名\t電話\t縣市\t出席\n全口重建工作坊\t2025/3/15\t崧達牙醫診所\t王小明\t0912-345-678\t台中市\t出席'}
              className="input-soft mt-4 w-full font-mono text-xs"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="button-secondary inline-flex min-h-11 cursor-pointer items-center px-5 transition-all active:scale-95">
                上傳 CSV
                <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={onFile} className="hidden" />
              </label>
              {fileName && <span className="text-sm text-stone-500">{fileName}</span>}
              {body.length > 0 && <span className="text-sm text-stone-500">讀到 {body.length} 列資料</span>}
            </div>
          </div>

          {headers.length > 0 && (
            <div className="card-soft p-5 sm:p-6">
              <h2 className="text-lg font-bold text-stone-800">2. 確認欄位對應</h2>
              <p className="mt-1 text-sm text-stone-500">系統已依表頭自動對應，不對的可以手動改。機構名稱為必要欄位。</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {FIELD_ORDER.map((f) => (
                  <label key={f} className="block">
                    <span className="text-xs font-semibold text-stone-600">{FIELD_LABEL[f]}{f === 'institution' ? ' *' : ''}</span>
                    <select value={effectiveCols[f] ?? ''} onChange={(e) => setCol(f, e.target.value)} className="select-soft mt-1 w-full text-sm">
                      <option value="">（無此欄）</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || `第 ${i + 1} 欄`}</option>)}
                    </select>
                  </label>
                ))}
              </div>

              <div className="mt-5 rounded-2xl bg-cream-50 p-4">
                <p className="text-sm font-semibold text-stone-700">
                  {needsEventDefaults ? '這份名單沒有活動名稱或日期欄，請指定這份名單屬於哪一場：' : '欄位空白時的預設值：'}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block">
                    <span className="text-xs font-semibold text-stone-600">活動名稱{effectiveCols.eventName === undefined ? ' *' : ''}</span>
                    <input value={defaults.eventName} onChange={(e) => setDefaults({ ...defaults, eventName: e.target.value })} className="input-soft mt-1 w-full text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-stone-600">活動日期{effectiveCols.eventDate === undefined ? ' *' : ''}</span>
                    <input type="date" value={defaults.eventDate} onChange={(e) => setDefaults({ ...defaults, eventDate: e.target.value })} className="input-soft mt-1 w-full text-sm" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-stone-600">活動類型</span>
                    <select value={defaults.eventType} onChange={(e) => setDefaults({ ...defaults, eventType: e.target.value })} className="select-soft mt-1 w-full text-sm">
                      {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-xs font-semibold text-stone-600">出席狀態空白時視為</span>
                    <select value={defaults.status} onChange={(e) => setDefaults({ ...defaults, status: e.target.value })} className="select-soft mt-1 w-full text-sm">
                      <option value="已到場">已到場（有出席）</option>
                      <option value="已報名">已報名（不確定是否出席）</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto">
                <p className="mb-2 text-sm text-stone-600">
                  有效 <b className="text-stone-800">{parsed.rows.length}</b> 列
                  {parsed.errors.length > 0 && <>，無效 <b className="text-red-600">{parsed.errors.length}</b> 列（不會匯入）</>}
                  {parsed.rows.length > IMPORT_MAX_ROWS && <span className="text-red-600">；單次最多 {IMPORT_MAX_ROWS} 列，請分批</span>}
                </p>
                {parsed.errors.length > 0 && (
                  <p className="mb-3 text-xs leading-5 text-red-500">
                    {parsed.errors.slice(0, 8).map((e) => `第 ${e.line} 列：${e.error}`).join('；')}
                    {parsed.errors.length > 8 && ` …等 ${parsed.errors.length} 列`}
                  </p>
                )}
                {parsed.rows.length > 0 && (
                  <table className="w-full text-xs">
                    <thead className="bg-cream-50 text-stone-500">
                      <tr>{['活動', '日期', '機構', '姓名', '電話', '縣市', '狀態'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-stone-900/[0.06]">
                      {parsed.rows.slice(0, 5).map((r, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2">{r.eventName}</td><td className="px-3 py-2 whitespace-nowrap">{r.eventDate}</td>
                          <td className="px-3 py-2">{r.institution}</td><td className="px-3 py-2">{r.contact}</td>
                          <td className="px-3 py-2">{r.phone}</td><td className="px-3 py-2">{r.city}</td><td className="px-3 py-2">{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <button
                onClick={runPreview}
                disabled={busy || parsed.rows.length === 0 || parsed.rows.length > IMPORT_MAX_ROWS || effectiveCols.institution === undefined}
                className="button-primary mt-5 min-h-11 px-6 disabled:opacity-40">
                {busy ? '比對中（約 1–2 分鐘）…' : '3. 預覽匯入結果（不會寫入）'}
              </button>
            </div>
          )}
        </>
      )}

      {(phase === 'preview' || phase === 'importing') && preview && (
        <div className="card-soft p-5 sm:p-6">
          <h2 className="text-lg font-bold text-stone-800">預覽：確認後才會寫入</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: '將匯入紀錄', value: preview.counts.toImport, cls: 'text-stone-800' },
              { label: '重複略過', value: preview.counts.duplicate, cls: 'text-stone-500' },
              { label: '新建活動', value: preview.events.filter((e) => !e.existingId).length, cls: 'text-brand-700' },
              { label: '新建客戶（家）', value: preview.newCustomers.length, cls: 'text-emerald-700' },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl bg-stone-50 p-3 text-center">
                <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="mt-0.5 text-xs text-stone-500">{s.label}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            客戶配對：既有客戶 <b>{preview.counts.matched}</b> 筆、配到新建客戶 <b>{preview.counts.created}</b> 筆、
            不配對 <b>{preview.counts.unmatched}</b> 筆{preview.counts.cancelled > 0 && `；另有 ${preview.counts.cancelled} 筆未出席／取消（只留紀錄，不配對）`}。
            不配對的原因會寫在活動頁的「配對說明」。
          </p>

          <h3 className="mt-5 text-sm font-semibold text-stone-700">活動（{preview.events.length} 場）</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-cream-50 text-stone-500">
                <tr>{['日期', '活動名稱', '類型', '處理', '匯入筆數', '重複'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-stone-900/[0.06]">
                {preview.events.map((e) => (
                  <tr key={eventKey(e.name, e.date)}>
                    <td className="px-3 py-2 whitespace-nowrap">{e.date}</td><td className="px-3 py-2">{e.name}</td><td className="px-3 py-2">{e.type}</td>
                    <td className="px-3 py-2">{e.existingId ? <span className="text-stone-500">沿用既有活動</span> : <span className="font-semibold text-brand-700">新建（已結束）</span>}</td>
                    <td className="px-3 py-2">{e.rows}</td><td className="px-3 py-2 text-stone-400">{e.duplicates || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.newCustomers.length > 0 && (
            <>
              <h3 className="mt-5 text-sm font-semibold text-stone-700">將依衛福部開業名單新建的客戶（{preview.newCustomers.length} 家）</h3>
              <p className="mt-1 text-xs text-stone-500">客戶庫查不到、但在衛福部開業名單中唯一相符的機構，比照醫事監控匯入建檔並依轄區指派。</p>
              <ul className="mt-2 grid gap-1.5 text-xs text-stone-600 sm:grid-cols-2">
                {preview.newCustomers.slice(0, 60).map((c) => (
                  <li key={c.name + c.area} className="rounded-xl bg-stone-50 px-3 py-2">
                    {c.name}・{c.area}・<span className={c.assignTo ? 'font-semibold text-emerald-700' : 'text-stone-400'}>{c.assignTo ? `指派 ${c.assignTo}` : '待認領'}</span>
                  </li>
                ))}
              </ul>
              {preview.newCustomers.length > 60 && <p className="mt-1 text-xs text-stone-400">…等 {preview.newCustomers.length} 家</p>}
            </>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-stone-700">逐筆結果</h3>
            <select value={detailFilter} onChange={(e) => setDetailFilter(e.target.value)} className="select-soft text-xs">
              <option value="">全部</option>
              <option value="配對既有客戶">配對既有客戶</option>
              <option value="新建客戶">新建客戶</option>
              <option value="不配對">不配對</option>
              <option value="重複略過">重複略過</option>
            </select>
          </div>
          <div className="mt-2 max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-cream-50 text-stone-500">
                <tr>{['機構', '姓名', '活動', '結果', '說明'].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-stone-900/[0.06]">
                {shownDetails.slice(0, 300).map((d) => (
                  <tr key={d.index}>
                    <td className="px-3 py-2">{d.institution}</td><td className="px-3 py-2">{d.contact}</td>
                    <td className="px-3 py-2">{d.eventName}</td><td className="px-3 py-2 whitespace-nowrap">{d.result}</td>
                    <td className="px-3 py-2 text-stone-500">{d.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button onClick={() => setPhase('input')} disabled={busy} className="button-secondary min-h-11 px-5 disabled:opacity-40">返回修改</button>
            <button onClick={runImport} disabled={busy || preview.counts.toImport === 0} className="button-primary min-h-11 px-6 disabled:opacity-40">
              {busy ? progress || '匯入中…' : `確認匯入 ${preview.counts.toImport} 筆`}
            </button>
            {busy && <span className="text-sm text-stone-500">請勿關閉頁面</span>}
          </div>
        </div>
      )}

      {phase === 'done' && summary && (
        <div className="card-soft p-6">
          <h2 className="text-lg font-bold text-emerald-800">匯入完成</h2>
          <p className="mt-2 text-sm leading-7 text-stone-600">
            新建活動 <b>{summary.events}</b> 場、匯入紀錄 <b>{summary.imported}</b> 筆
            {summary.skipped > 0 && `（${summary.skipped} 筆重複略過）`}。<br />
            客戶配對：既有客戶 <b>{summary.matched}</b> 筆、新建客戶 <b>{summary.created}</b> 家、不配對 <b>{summary.unmatched}</b> 筆。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/events" className="button-primary inline-flex min-h-11 items-center px-5">查看活動列表</Link>
            <button onClick={reset} className="button-secondary min-h-11 px-5">再匯入一份</button>
          </div>
        </div>
      )}
    </div>
  )
}
