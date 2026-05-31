'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ── helpers ────────────────────────────────────────────────────

function todayLocal(): string {
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return tw.toISOString().slice(0, 10)
}

// ── 解析業務日報文字 ───────────────────────────────────────────

interface ParsedVisit {
  customerName: string
  content: string
}

interface ParsedReport {
  date: string
  title: string
  visits: ParsedVisit[]
}

interface CustomerCandidate {
  id:       string
  name:     string
  city:     string
  district: string
}

interface MatchedVisit {
  customerName:      string
  content:           string
  candidates:        CustomerCandidate[]
  selectedId:        string   // '' = 不連結；否則為 Notion customer page ID
  searching:         boolean
  suggestedReaction: string   // AI 建議的客戶反應標籤（'' = 未判斷或無法判斷）
  reactionLoading:   boolean
  customerReaction:  string   // 使用者選定的反應（預設從 AI 建議填入，可手動覆蓋）
}

function parseDailyReportText(raw: string): ParsedReport {
  const lines  = raw.split('\n').map((l) => l.trim())
  let date     = ''
  let title    = ''
  let inBody   = false
  const visits: ParsedVisit[] = []
  let cur: { customerName: string; contentLines: string[] } | null = null

  const numRe = /^(\d+)[.、．]\s*(.+)/

  for (const line of lines) {
    if (!line) {
      if (inBody && cur) cur.contentLines.push('')
      continue
    }
    if (line.startsWith('職稱：') || line.startsWith('職稱:')) {
      title = line.replace(/^職稱[：:]/, '').trim()
      continue
    }
    if (line.startsWith('日期：') || line.startsWith('日期:')) {
      const m = line.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
      if (m) date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
      continue
    }
    if (/^[—\-─=]{3,}/.test(line)) { inBody = true; continue }
    if (!inBody) continue

    const nm = line.match(numRe)
    if (nm) {
      if (cur) {
        while (cur.contentLines.length && !cur.contentLines[cur.contentLines.length - 1]) cur.contentLines.pop()
        visits.push({ customerName: cur.customerName, content: cur.contentLines.join('\n') })
      }
      cur = { customerName: nm[2].trim(), contentLines: [] }
    } else if (cur) {
      cur.contentLines.push(line)
    }
  }
  if (cur) {
    while (cur.contentLines.length && !cur.contentLines[cur.contentLines.length - 1]) cur.contentLines.pop()
    visits.push({ customerName: cur.customerName, content: cur.contentLines.join('\n') })
  }

  return { date, title, visits }
}

// ── Main Component ─────────────────────────────────────────────

export default function DailyReportPanel({ isAdmin = false }: { isAdmin?: boolean }) {
  // Tab
  const [tab, setTab] = useState<'push' | 'import'>('push')

  // Salesperson list (從帳號管理拉，全部業務帳號；停用的排後面並標示)
  const [spNames,      setSpNames]      = useState<string[]>([])
  const [inactiveNames, setInactiveNames] = useState<Set<string>>(new Set())
  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const sales   = data.filter((u: any) => u.accountType === '業務')
          const active  = sales.filter((u: any) => u.status !== '停用').map((u: any) => u.name as string).filter(Boolean)
          const inactive = sales.filter((u: any) => u.status === '停用').map((u: any) => u.name as string).filter(Boolean)
          setSpNames([...active, ...inactive])
          setInactiveNames(new Set(inactive))
        }
      })
      .catch(() => {})
  }, [])

  // 客戶反應選項（供 AI 建議使用）
  const [reactionOptions, setReactionOptions] = useState<string[]>([])
  useEffect(() => {
    fetch('/api/visits/options')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data?.customerReactions)) setReactionOptions(data.customerReactions) })
      .catch(() => {})
  }, [])

  // ── 推播 tab ────────────────────────────────────────────────
  const [period,      setPeriod]      = useState<'AM' | 'PM' | 'FULL'>('FULL')
  const [date,        setDate]        = useState(todayLocal)
  const [salesperson, setSalesperson] = useState('')
  const [title,       setTitle]       = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('dailyReportTitle') ?? '' : ''
  )
  const [text,    setText]    = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [result,  setResult]  = useState('')

  const handleTitleChange = (v: string) => {
    setTitle(v)
    try { localStorage.setItem('dailyReportTitle', v) } catch {}
  }

  // 當 API 回傳新業務名單，合併進去
  const mergeSpNames = (names: string[]) => {
    setSpNames((prev) => {
      const seen = new Set(prev)
      const merged = [...prev]
      for (const n of names) { if (!seen.has(n)) { seen.add(n); merged.push(n) } }
      return merged
    })
  }

  const loadPreview = useCallback(async () => {
    setLoading(true); setResult('')
    try {
      const params = new URLSearchParams({ period, date })
      if (salesperson) params.set('salesperson', salesperson)
      if (title)       params.set('title', title)
      const res  = await fetch(`/api/daily-report?${params}`)
      const data = await res.json()
      if (data.error) { setText(data.error); return }
      setText(data.text ?? '')
      if (Array.isArray(data.salespersonNames)) mergeSpNames(data.salespersonNames)
    } catch { setText('預覽失敗，請重試') }
    finally  { setLoading(false) }
  }, [period, date, salesperson, title])

  const sendReport = async () => {
    setSending(true); setResult('')
    try {
      const res = await fetch('/api/daily-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          date,
          salesperson: salesperson || undefined,
          title:       title || undefined,
          text:        text  || undefined,
        }),
      })
      const data = await res.json()
      setResult(data.message ?? data.error ?? '完成')
    } catch { setResult('推播失敗，請確認 LINE 設定') }
    finally  { setSending(false) }
  }

  // ── 匯入 tab ────────────────────────────────────────────────
  const [rawText,      setRawText]      = useState('')
  const [matchedVisits, setMatchedVisits] = useState<MatchedVisit[]>([])
  const [impSp,        setImpSp]        = useState('')
  const [impDate,      setImpDate]      = useState(todayLocal)
  const [importing,    setImporting]    = useState(false)
  const [impResult,    setImpResult]    = useState('')

  const updateSelectedId = (index: number, id: string) => {
    setMatchedVisits((prev) => prev.map((mv, i) => i === index ? { ...mv, selectedId: id } : mv))
  }

  const removeVisit = (index: number) => {
    setMatchedVisits((prev) => prev.filter((_, i) => i !== index))
  }

  const suggestReaction = (index: number, content: string) => {
    if (!content.trim() || reactionOptions.length === 0) return
    setMatchedVisits((prev) =>
      prev.map((mv, i) => i === index ? { ...mv, reactionLoading: true } : mv)
    )
    fetch('/api/ai/suggest-reaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, options: reactionOptions }),
    })
      .then((r) => r.json())
      .then((data) => {
        const suggestion: string = data.suggestion ?? ''
        setMatchedVisits((prev) =>
          prev.map((mv, i) =>
            i === index
              ? { ...mv, suggestedReaction: suggestion, customerReaction: suggestion || mv.customerReaction, reactionLoading: false }
              : mv
          )
        )
      })
      .catch(() => {
        setMatchedVisits((prev) =>
          prev.map((mv, i) => i === index ? { ...mv, reactionLoading: false } : mv)
        )
      })
  }

  const handleParse = () => {
    if (!rawText.trim()) return
    const p = parseDailyReportText(rawText)
    setImpResult('')
    if (p.date) setImpDate(p.date)
    if (p.title) {
      const match = spNames.find((n) => p.title.includes(n) || n.includes(p.title))
      if (match) setImpSp(match)
    }

    // 初始化帶「搜尋中」狀態的清單
    const initial: MatchedVisit[] = p.visits.map((v) => ({
      customerName:      v.customerName,
      content:           v.content,
      candidates:        [],
      selectedId:        '',
      searching:         true,
      suggestedReaction: '',
      reactionLoading:   false,
      customerReaction:  '',
    }))
    setMatchedVisits(initial)

    // 逐筆搜尋客戶資料庫 + AI 判斷客戶反應（並行）
    p.visits.forEach((v, i) => {
      // 客戶比對
      fetch(`/api/customers/search?q=${encodeURIComponent(v.customerName)}`)
        .then((r) => r.json())
        .then((results: CustomerCandidate[]) => {
          const cands = (Array.isArray(results) ? results : []).slice(0, 5)
          const exactMatch = cands.find((c) => c.name === v.customerName)
          const autoId = exactMatch?.id ?? (cands.length === 1 ? cands[0].id : '')
          setMatchedVisits((prev) =>
            prev.map((mv, idx) =>
              idx === i ? { ...mv, candidates: cands, selectedId: autoId, searching: false } : mv
            )
          )
        })
        .catch(() => {
          setMatchedVisits((prev) =>
            prev.map((mv, idx) => idx === i ? { ...mv, searching: false } : mv)
          )
        })

    })
  }

  const handleImport = async () => {
    if (matchedVisits.length === 0) return
    setImporting(true); setImpResult('')
    try {
      const res = await fetch('/api/visits/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visits: matchedVisits.map((v) => {
            const linked = v.selectedId ? v.candidates.find((c) => c.id === v.selectedId) : null
            return {
              customerName:     linked?.name || v.customerName,
              content:          v.content,
              date:             impDate,
              salesperson:      impSp,
              customerId:       v.selectedId || undefined,
              city:             linked?.city     || undefined,
              district:         linked?.district || undefined,
              customerReaction: v.customerReaction || undefined,
            }
          }),
        }),
      })
      const data = await res.json()
      if (data.error) { setImpResult(`❌ ${data.error}`); return }
      setImpResult(`✅ 已建立 ${data.created} 筆客情紀錄${data.errors?.length ? `，${data.errors.length} 筆失敗` : ''}`)
      if (data.created > 0) { setRawText(''); setMatchedVisits([]) }
    } catch { setImpResult('❌ 匯入失敗，請重試') }
    finally  { setImporting(false) }
  }

  const ic = 'rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition'

  return (
    <div className="max-w-2xl space-y-6">

      {/* Tab switcher */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1 w-fit">
        {([
          { id: 'push',   label: '📤 LINE 推播' },
          { id: 'import', label: '📥 匯入客情紀錄' },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              tab === t.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 推播 Tab ── */}
      {tab === 'push' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">

          {/* Period */}
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">日報設定</h3>
            <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
              {(['AM', 'PM', 'FULL'] as const).map((p) => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${period === p ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
                  {p === 'AM' ? '上午' : p === 'PM' ? '下午' : '全日'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 職稱 */}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className="text-xs font-medium text-gray-500">職稱（顯示於日報開頭）</label>
              <input type="text" value={title} onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="e.g. 北區業務" className={ic} />
            </div>

            {/* Date */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-500">日期</label>
              <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} className={ic} />
            </div>

            {/* Salesperson */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-500">業務</label>
              <select value={salesperson} onChange={(e) => setSalesperson(e.target.value)} className={ic}>
                <option value="">全部業務</option>
                {spNames.map((n) => (
                  <option key={n} value={n}>
                    {inactiveNames.has(n) ? `${n}（已停用）` : n}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Editable textarea */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-500">
                日報內容
                {text && <span className="ml-1.5 text-blue-400 font-normal">（可直接編輯）</span>}
              </label>
              {text && (
                <button onClick={() => setText('')} className="text-xs text-gray-300 hover:text-gray-500">清除</button>
              )}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={14}
              placeholder={`點擊「預覽」載入日報內容，可在此直接修改後再推播…`}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 placeholder:text-gray-300 transition"
            />
            <p className="text-xs text-gray-400 text-right">{text ? `${text.length} 字元` : '尚無內容'}</p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={loadPreview} disabled={loading}
              className="button-secondary px-4 py-2 text-sm rounded-xl disabled:opacity-50">
              {loading ? '載入中…' : '🔍 預覽'}
            </button>
            {isAdmin ? (
              <button onClick={sendReport} disabled={sending || !text}
                className="button-primary px-4 py-2 text-sm rounded-xl disabled:opacity-50 flex items-center gap-1.5">
                {sending ? '傳送中…' : '📲 推播至 LINE'}
              </button>
            ) : (
              <p className="text-xs text-gray-400">需要行政帳號才能推播</p>
            )}
          </div>

          {result && (
            <p className={`text-sm px-4 py-2.5 rounded-xl ${result.includes('失敗') || result.includes('尚未') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {result}
            </p>
          )}
        </div>
      )}

      {/* ── 匯入 Tab ── */}
      {tab === 'import' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">

          <div>
            <h3 className="font-semibold text-gray-800 mb-1">匯入業務日報</h3>
            <p className="text-sm text-gray-400">將業務手寫的日報文字貼入，系統自動拆解為獨立的客情紀錄（每個編號一筆）。</p>
          </div>

          {/* 範例說明 */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-600 space-y-1">
            <p className="font-semibold mb-1">支援格式</p>
            <pre className="font-mono leading-relaxed whitespace-pre-wrap">{`每日報表
職稱：北區業務
日期：2026/05/29（五）
——————————————
1.長庚報價
回覆王技師價格說明…
2.冠橋牙技所
例行關心，討論新產品…`}</pre>
          </div>

          {/* Paste area */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-500">貼入日報文字</label>
            <textarea
              value={rawText}
              onChange={(e) => { setRawText(e.target.value); setMatchedVisits([]); setImpResult('') }}
              rows={12}
              placeholder="在此貼入業務日報…"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-blue-400 placeholder:text-gray-300 transition"
            />
          </div>

          <button onClick={handleParse} disabled={!rawText.trim()}
            className="button-secondary w-full py-2.5 text-sm rounded-xl disabled:opacity-40">
            🔍 解析日報
          </button>

          {/* 解析結果 + 客戶比對 */}
          {matchedVisits.length > 0 && (
            <div className="space-y-4 border-t border-gray-100 pt-4">
              <h4 className="font-semibold text-gray-800">
                解析結果：{matchedVisits.length} 筆 — 請確認客戶對應
              </h4>

              {/* 指定業務 + 日期 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-500">業務姓名</label>
                  <select value={impSp} onChange={(e) => setImpSp(e.target.value)} className={ic}>
                    <option value="">（未指定）</option>
                    {spNames.map((n) => (
                      <option key={n} value={n}>
                        {inactiveNames.has(n) ? `${n}（已停用）` : n}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-gray-500">記錄日期</label>
                  <input type="date" value={impDate} max={todayLocal()} onChange={(e) => setImpDate(e.target.value)} className={ic} />
                </div>
              </div>

              {/* 比對確認清單 */}
              <div className="space-y-3">
                {matchedVisits.map((mv, i) => (
                  <div key={i} className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 space-y-2">
                    {/* 客戶名稱（可編輯）+ 刪除按鈕 */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 shrink-0">{i + 1}.</span>
                      <input
                        type="text"
                        value={mv.customerName}
                        onChange={(e) => {
                          const name = e.target.value
                          setMatchedVisits((prev) =>
                            prev.map((m, idx) =>
                              idx === i ? { ...m, customerName: name, selectedId: '', candidates: [] } : m
                            )
                          )
                        }}
                        onBlur={(e) => {
                          // 名稱變更後重新搜尋
                          const name = e.target.value.trim()
                          if (!name) return
                          setMatchedVisits((prev) =>
                            prev.map((m, idx) => idx === i ? { ...m, searching: true } : m)
                          )
                          fetch(`/api/customers/search?q=${encodeURIComponent(name)}`)
                            .then((r) => r.json())
                            .then((results: CustomerCandidate[]) => {
                              const cands = (Array.isArray(results) ? results : []).slice(0, 5)
                              const exactMatch = cands.find((c) => c.name === name)
                              const autoId = exactMatch?.id ?? (cands.length === 1 ? cands[0].id : '')
                              setMatchedVisits((prev) =>
                                prev.map((m, idx) =>
                                  idx === i ? { ...m, candidates: cands, selectedId: autoId, searching: false } : m
                                )
                              )
                            })
                            .catch(() => {
                              setMatchedVisits((prev) =>
                                prev.map((m, idx) => idx === i ? { ...m, searching: false } : m)
                              )
                            })
                        }}
                        placeholder="客戶名稱"
                        className="flex-1 text-sm font-semibold text-gray-800 bg-transparent border-b border-dashed border-gray-300 focus:border-blue-400 focus:outline-none py-0.5"
                      />
                      <button
                        type="button"
                        onClick={() => removeVisit(i)}
                        title="移除此筆"
                        className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-gray-300 hover:bg-red-100 hover:text-red-500 transition-colors text-base leading-none"
                      >
                        ✕
                      </button>
                    </div>
                    {mv.content && (
                      <p className="text-gray-400 text-xs whitespace-pre-wrap line-clamp-3 leading-relaxed pl-4">{mv.content}</p>
                    )}

                    {/* 比對選項 */}
                    <div className="pt-1">
                      {mv.searching ? (
                        <span className="text-xs text-gray-400 animate-pulse">比對客戶資料庫中…</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 items-center">
                          <span className="text-[10px] text-gray-400 shrink-0 mr-0.5">連結：</span>

                          {/* 不連結 */}
                          <button
                            onClick={() => updateSelectedId(i, '')}
                            className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                              mv.selectedId === ''
                                ? 'bg-gray-700 text-white border-gray-700'
                                : 'border-gray-300 text-gray-500 hover:border-gray-500'
                            }`}
                          >
                            不連結
                          </button>

                          {/* 候選客戶 */}
                          {mv.candidates.map((c) => (
                            <button
                              key={c.id}
                              onClick={() => updateSelectedId(i, c.id)}
                              className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                                mv.selectedId === c.id
                                  ? 'bg-blue-500 text-white border-blue-500'
                                  : 'border-gray-200 text-gray-600 hover:border-blue-300 hover:text-blue-600'
                              }`}
                            >
                              {c.name}{c.city ? ` · ${c.city}` : ''}
                            </button>
                          ))}

                          {mv.candidates.length === 0 && (
                            <span className="text-xs text-gray-400 italic">找不到相符客戶</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* 連結統計 */}
              {matchedVisits.some((mv) => !mv.searching) && (
                <p className="text-xs text-gray-400 text-right">
                  已連結 {matchedVisits.filter((mv) => mv.selectedId).length} /
                  {matchedVisits.length} 筆至客戶資料庫
                </p>
              )}

              <button
                onClick={handleImport}
                disabled={importing || matchedVisits.some((mv) => mv.searching || mv.reactionLoading) || matchedVisits.length === 0}
                className="button-primary w-full py-3 text-sm rounded-xl disabled:opacity-50 font-medium"
              >
                {importing
                  ? '建立中…'
                  : matchedVisits.some((mv) => mv.searching)
                  ? '比對中，請稍候…'
                  : `✅ 確認建立 ${matchedVisits.length} 筆客情紀錄`}
              </button>

              {impResult && (
                <p className={`text-sm px-4 py-2.5 rounded-xl ${impResult.startsWith('❌') ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {impResult}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
