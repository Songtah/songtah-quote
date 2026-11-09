'use client'

import { useCallback, useEffect, useState } from 'react'

type Source = { id: string; platform: string; url: string; mode: 'auto' | 'manual' }
type Target = {
  id: string; name: string; aliases: string[]; kind: 'competitor' | 'self'; status: 'active' | 'paused'
  city: string; channelUrl: string; note: string; sources: Source[]; lastCaptureAt?: string
  captureCount: number; unjudgedCount: number; pendingFindings: number; confirmedFindings: number; heldLicenses: number; heldActive: number
}
type Meta = { licenseIndexBuiltAt: string; rulesVerifiedAt: string; rulesReviewed: boolean; ruleCount: number; judgeModel: string; estUsdPerPage: number; judgeReady: boolean; blobReady: boolean }
type Finding = {
  id: string; targetId: string; url: string; ruleId: string; ruleTitle: string; ruleLaw: string; severity: string; source: 'hard' | 'ai'
  product: string; quote: string; reason: string; confidence: string; status: string; createdAt: string; reviewNote: string; caseNo: string; agency: string
}
type Report = { agency: string; channelUrl: string; hotline: string; text: string; evidence: { url: string; capturedAt: string; sha256: string; blobUrl: string; archiveUrl: string }[] }

const BTN = 'rounded-full px-4 py-2 text-xs font-semibold transition-all active:scale-95 disabled:opacity-40'
const BTN_PRIMARY = `${BTN} bg-brand-500 text-white hover:bg-brand-600`
const BTN_GHOST = `${BTN} bg-stone-100 text-stone-600 hover:bg-stone-200`
const STATUS_STYLE: Record<string, string> = {
  '待審': 'bg-amber-50 text-amber-700', '不成立': 'bg-stone-100 text-stone-500', '成立': 'bg-red-50 text-red-600',
  '已產出檢舉書': 'bg-brand-50 text-brand-700', '已送出': 'bg-emerald-50 text-emerald-700', '已結案': 'bg-stone-100 text-stone-500',
}
const twTime = (iso?: string) => iso ? new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }).slice(0, -3) : '尚未擷取'

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `操作失敗（${res.status}）`)
  return json
}

export function ComplianceContent() {
  const [targets, setTargets] = useState<Target[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [openId, setOpenId] = useState('')
  const [findings, setFindings] = useState<Finding[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', aliases: '', city: '', urls: '' })
  const [bulk, setBulk] = useState('')
  const [manualUrl, setManualUrl] = useState('')

  const load = useCallback(async () => {
    try {
      const j = await call('/api/admin/compliance/targets')
      setTargets(j.targets); setMeta(j.meta); setError('')
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const loadFindings = useCallback(async (targetId: string) => {
    const j = await call(`/api/admin/compliance/findings?targetId=${targetId}`)
    setFindings(j.findings)
  }, [])

  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key); setError(''); setNotice('')
    try { const msg = await fn(); if (msg) setNotice(msg); await load() }
    catch (e: any) { setError(e.message) }
    finally { setBusy('') }
  }

  const toggle = (t: Target) => {
    setReport(null); setManualUrl('')
    if (openId === t.id) { setOpenId(''); return }
    setOpenId(t.id); setFindings([])
    loadFindings(t.id).catch((e) => setError(e.message))
  }

  const addOne = () => run('add', async () => {
    const sources = form.urls.split(/\s+/).map((u) => u.trim()).filter(Boolean).map((url) => ({ url }))
    await call('/api/admin/compliance/targets', { method: 'POST', body: JSON.stringify({
      name: form.name, city: form.city, aliases: form.aliases.split(/[,，、\s]+/).filter(Boolean), sources,
    }) })
    setForm({ name: '', aliases: '', city: '', urls: '' }); setShowAdd(false)
    return '已新增監測對象'
  })

  // 批次匯入：每行「公司名稱｜別名1、別名2｜縣市｜網址1 網址2」，後三欄可省略
  const addBulk = () => run('bulk', async () => {
    const items = bulk.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [name = '', aliases = '', city = '', urls = ''] = line.split(/[|｜]/).map((s) => s.trim())
      return { name, city, aliases: aliases.split(/[,，、]+/).filter(Boolean), sources: urls.split(/\s+/).filter(Boolean).map((url) => ({ url })) }
    })
    const j = await call('/api/admin/compliance/targets', { method: 'POST', body: JSON.stringify({ items }) })
    setBulk(''); setShowAdd(false)
    return `已匯入 ${j.created} 家，略過 ${j.skipped} 家（同名或資料不全）`
  })

  const capture = (t: Target) => run(`cap:${t.id}`, async () => {
    const j = await call('/api/admin/compliance/capture', { method: 'POST', body: JSON.stringify({ targetId: t.id }) })
    const r = j.result
    if (openId === t.id) await loadFindings(t.id)
    return `${t.name}：抓取 ${r.pagesFetched} 頁，新存證 ${r.pagesStored} 頁，內容未變 ${r.pagesUnchanged} 頁，資料比對新發現 ${r.newFindings} 筆`
      + (r.blocked.length ? `；抓不到：${r.blocked.join('、')}` : '') + (r.notes.length ? `；${r.notes.join('；')}` : '')
  })

  const captureUrl = (t: Target) => run(`url:${t.id}`, async () => {
    const j = await call('/api/admin/compliance/capture', { method: 'POST', body: JSON.stringify({ targetId: t.id, url: manualUrl }) })
    if (!j.ok) throw new Error(j.reason ?? '擷取失敗')
    setManualUrl(''); await loadFindings(t.id)
    return `已存證${j.capture?.archiveUrl ? '，並取得第三方存檔' : '（第三方存檔未取得）'}`
  })

  const judge = (t: Target) => {
    const pages = Math.min(8, t.unjudgedCount)
    const usd = (pages * (meta?.estUsdPerPage ?? 0)).toFixed(2)
    if (!window.confirm(`將以 ${meta?.judgeModel} 判讀 ${pages} 頁，預估費用約 US$${usd}。結果只會標「疑似」，仍需逐筆審核。要繼續嗎？`)) return
    return run(`judge:${t.id}`, async () => {
      const j = await call('/api/admin/compliance/judge', { method: 'POST', body: JSON.stringify({ targetId: t.id }) })
      const r = j.result
      if (openId === t.id) await loadFindings(t.id)
      return `${t.name}：判讀 ${r.judged} 頁，新增疑似 ${r.newFindings} 筆，因依據對不上原文而丟棄 ${r.dropped} 筆${r.skipped ? `，尚有 ${r.skipped} 頁未判讀` : ''}${r.errors.length ? `；失敗 ${r.errors.length} 頁` : ''}`
    })
  }

  const review = (f: Finding, patch: Partial<Finding>) => run(`f:${f.id}`, async () => {
    await call('/api/admin/compliance/findings', { method: 'PATCH', body: JSON.stringify({ id: f.id, ...patch }) })
    await loadFindings(f.targetId)
  })

  const makeReport = (t: Target) => run(`rep:${t.id}`, async () => {
    const j = await call('/api/admin/compliance/report', { method: 'POST', body: JSON.stringify({ targetId: t.id }) })
    setReport(j.report); await loadFindings(t.id)
    return `已依 ${j.count} 筆成立的發現產出檢舉書草稿`
  })

  const patchTarget = (t: Target, patch: Record<string, unknown>, msg?: string) => run(`t:${t.id}`, async () => {
    await call('/api/admin/compliance/targets', { method: 'PATCH', body: JSON.stringify({ id: t.id, ...patch }) })
    return msg
  })

  if (loading) return <div className="card-soft py-16 text-center text-stone-400">載入中…</div>

  return (
    <div className="space-y-4">
      <div className="card-soft p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 text-sm text-stone-600">
            <p className="font-semibold text-stone-900">運作方式</p>
            <p className="mt-1">系統只蒐集不需登入的公開網頁，保存原始檔與雜湊值，並與食藥署醫療器材許可證資料比對。所有結果都是「疑似」，須由你逐筆審核。檢舉書由系統寫好，送出由你本人操作，系統不會代送。</p>
            {meta && (
              <p className="mt-2 text-xs text-stone-500">
                規則 {meta.ruleCount} 條，條文取自全國法規資料庫（{meta.rulesVerifiedAt} 查證）
                {!meta.rulesReviewed && '，尚未經律師審閱'}。許可證資料 {meta.licenseIndexBuiltAt} 更新，只含牙科類許可證，不含登錄制品項。
              </p>
            )}
          </div>
          <button onClick={() => setShowAdd((v) => !v)} className={BTN_PRIMARY}>{showAdd ? '收合' : '新增監測對象'}</button>
        </div>
        {meta && !meta.blobReady && <p className="mt-3 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">尚未設定檔案儲存空間，擷取時無法保存原始檔。</p>}
        {error && <p className="mt-3 rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
        {notice && <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-2.5 text-sm text-stone-600">{notice}</p>}

        {showAdd && (
          <div className="mt-4 grid gap-4 border-t border-stone-100 pt-4 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-stone-900">單筆新增</p>
              <input id="cm-name" className="input-soft w-full" placeholder="公司登記名稱" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input id="cm-aliases" className="input-soft w-full" placeholder="商標或簡稱，以頓號分隔（選填）" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
              <input id="cm-city" className="input-soft w-full" placeholder="登記所在縣市，例：臺北市（選填，決定受理機關）" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              <textarea id="cm-urls" className="input-soft w-full" rows={3} placeholder="來源網址，一行一個：官網、粉專、IG、賣場" value={form.urls} onChange={(e) => setForm({ ...form, urls: e.target.value })} />
              <button onClick={addOne} disabled={busy === 'add' || form.name.trim().length < 2} className={BTN_PRIMARY}>新增</button>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-stone-900">批次匯入</p>
              <textarea id="cm-bulk" className="input-soft w-full font-mono text-xs" rows={8}
                placeholder={'每行一家：公司名稱｜別名、別名｜縣市｜網址 網址\n後三欄可省略'} value={bulk} onChange={(e) => setBulk(e.target.value)} />
              <button onClick={addBulk} disabled={busy === 'bulk' || !bulk.trim()} className={BTN_PRIMARY}>匯入</button>
            </div>
          </div>
        )}
      </div>

      {targets.length === 0 && <div className="card-soft py-12 text-center text-sm text-stone-400">尚未建立監測對象。按右上角「新增監測對象」開始。</div>}

      {targets.map((t) => {
        const open = openId === t.id
        const autoSources = t.sources.filter((s) => s.mode === 'auto')
        return (
          <div key={t.id} className="card-soft p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <button onClick={() => toggle(t)} className="min-w-0 flex-1 text-left transition-all active:scale-[0.99]">
                <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-stone-900">
                  {t.name}
                  {t.kind === 'self' && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">自家</span>}
                  {t.status === 'paused' && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">已停用</span>}
                  {t.pendingFindings > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">待審 {t.pendingFindings}</span>}
                  {t.confirmedFindings > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">成立 {t.confirmedFindings}</span>}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  {t.aliases.length > 0 && `${t.aliases.join('、')}・`}{t.city || '所在地未確認'}・來源 {t.sources.length} 個・存證 {t.captureCount} 頁・最後擷取 {twTime(t.lastCaptureAt)}
                </p>
                <p className="mt-0.5 text-xs text-stone-500">
                  以此名稱持有牙科類許可證 {t.heldLicenses} 張（有效 {t.heldActive} 張）{t.heldLicenses === 0 && '。查無不代表違法，可能以其他名義持證或屬登錄制品項'}
                </p>
              </button>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => capture(t)} disabled={!!busy || autoSources.length === 0 || t.status === 'paused'} className={BTN_PRIMARY}>
                  {busy === `cap:${t.id}` ? '擷取中…' : '擷取並存證'}
                </button>
                <button onClick={() => judge(t)} disabled={!!busy || t.unjudgedCount === 0 || !meta?.judgeReady} className={BTN_GHOST}>
                  {busy === `judge:${t.id}` ? '判讀中…' : `判讀${t.unjudgedCount ? `（${t.unjudgedCount} 頁未判讀）` : ''}`}
                </button>
              </div>
            </div>

            {open && (
              <div className="mt-4 space-y-4 border-t border-stone-100 pt-4">
                <div>
                  <p className="text-sm font-semibold text-stone-900">來源</p>
                  <ul className="mt-1 space-y-1 text-xs text-stone-600">
                    {t.sources.length === 0 && <li className="text-stone-400">尚未設定來源網址</li>}
                    {t.sources.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-600">{s.platform}</span>
                        <a href={s.url} target="_blank" rel="noreferrer noopener" className="break-all text-brand-600 hover:underline">{s.url}</a>
                        <span className="text-stone-400">{s.mode === 'auto' ? '自動擷取' : '需登入的平台，請貼單篇網址'}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input id={`cm-url-${t.id}`} className="input-soft min-w-0 flex-1" placeholder="貼上單篇網址存證（貼文、活動頁、商品頁）" value={manualUrl} onChange={(e) => setManualUrl(e.target.value)} />
                    <button onClick={() => captureUrl(t)} disabled={!!busy || !/^https?:\/\//.test(manualUrl.trim())} className={BTN_GHOST}>{busy === `url:${t.id}` ? '存證中…' : '存證這一頁'}</button>
                    <button onClick={() => { const u = window.prompt('新增來源網址'); if (u) patchTarget(t, { sources: [...t.sources, { url: u.trim() }] }, '已新增來源') }} className={BTN_GHOST}>加來源</button>
                    <button onClick={() => { const c = window.prompt('登記所在縣市（例：臺北市）', t.city); if (c !== null) patchTarget(t, { city: c }, '已更新所在地') }} className={BTN_GHOST}>改所在地</button>
                    <button onClick={() => { const u = window.prompt('受理機關的線上陳情或檢舉頁網址（確認後再填）', t.channelUrl); if (u !== null) patchTarget(t, { channelUrl: u }, '已更新檢舉頁網址') }} className={BTN_GHOST}>填檢舉頁網址</button>
                    <button onClick={() => patchTarget(t, { status: t.status === 'active' ? 'paused' : 'active' }, t.status === 'active' ? '已停用' : '已恢復監測')} className={BTN_GHOST}>{t.status === 'active' ? '停用' : '恢復'}</button>
                  </div>
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-stone-900">發現（{findings.length}）</p>
                    <button onClick={() => makeReport(t)} disabled={!!busy || !findings.some((f) => f.status === '成立' || f.status === '已產出檢舉書')} className={BTN_PRIMARY}>
                      {busy === `rep:${t.id}` ? '產出中…' : '產出檢舉書'}
                    </button>
                  </div>
                  {findings.length === 0 && <p className="mt-2 text-sm text-stone-400">目前沒有發現。先按「擷取並存證」，再按「判讀」。</p>}
                  <div className="mt-2 space-y-3">
                    {findings.map((f) => (
                      <div key={f.id} className="rounded-2xl bg-stone-50 p-4 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[f.status] ?? 'bg-stone-100 text-stone-600'}`}>{f.status}</span>
                          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-stone-600">{f.source === 'hard' ? '資料比對' : '疑似（模型判讀）'}・把握 {f.confidence}</span>
                          <span className="font-semibold text-stone-900">{f.ruleTitle}</span>
                        </div>
                        <p className="mt-1 text-xs text-stone-500">{f.ruleLaw}{f.product && `・${f.product}`}</p>
                        <p className="mt-2 rounded-xl bg-white px-3 py-2 text-stone-700">「{f.quote}」</p>
                        <p className="mt-2 text-stone-600">{f.reason}</p>
                        <a href={f.url} target="_blank" rel="noreferrer noopener" className="mt-1 block break-all text-xs text-brand-600 hover:underline">{f.url}</a>
                        {f.caseNo && <p className="mt-1 text-xs text-stone-500">受理機關：{f.agency || '未填'}・案號：{f.caseNo}</p>}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {f.status === '待審' && <>
                            <button onClick={() => review(f, { status: '成立' })} disabled={!!busy} className={BTN_PRIMARY}>成立</button>
                            <button onClick={() => review(f, { status: '不成立' })} disabled={!!busy} className={BTN_GHOST}>不成立</button>
                          </>}
                          {(f.status === '成立' || f.status === '不成立') && <button onClick={() => review(f, { status: '待審' })} disabled={!!busy} className={BTN_GHOST}>改回待審</button>}
                          {f.status === '已產出檢舉書' && <button onClick={() => { const no = window.prompt('送出後取得的案號'); if (no) review(f, { status: '已送出', caseNo: no }) }} disabled={!!busy} className={BTN_GHOST}>已送出，填案號</button>}
                          {f.status === '已送出' && <button onClick={() => { const note = window.prompt('主管機關回覆結果'); if (note !== null) review(f, { status: '已結案', reviewNote: note }) }} disabled={!!busy} className={BTN_GHOST}>收到回覆，結案</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {report && (
                  <div className="rounded-2xl bg-cream-50 p-4">
                    <p className="text-sm font-semibold text-stone-900">檢舉書草稿</p>
                    <p className="mt-1 text-xs text-stone-600">
                      建議受理機關：{report.agency}。也可洽{report.hotline}。
                      {report.channelUrl
                        ? <> 檢舉頁：<a href={report.channelUrl} target="_blank" rel="noreferrer noopener" className="break-all text-brand-600 hover:underline">{report.channelUrl}</a></>
                        : ' 尚未填該機關的線上檢舉頁網址，請確認後用「填檢舉頁網址」記下。'}
                    </p>
                    <textarea id={`cm-report-${t.id}`} readOnly className="input-soft mt-2 w-full font-mono text-xs" rows={18} value={report.text} />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button onClick={() => { navigator.clipboard.writeText(report.text); setNotice('已複製檢舉書內容') }} className={BTN_PRIMARY}>複製內容</button>
                      {report.evidence.map((e, i) => e.blobUrl && (
                        <a key={e.sha256} href={e.blobUrl} target="_blank" rel="noreferrer noopener" className={BTN_GHOST}>下載證據 {i + 1} 原始檔</a>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-stone-500">送出前請自行開啟網址截圖存證。系統保存的是原始網頁檔與雜湊值，沒有畫面截圖。</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
