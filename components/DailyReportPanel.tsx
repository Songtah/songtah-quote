'use client'

import { useEffect, useState } from 'react'
import { LineImportContent } from '@/components/LineImportContent'

// ── helpers ────────────────────────────────────────────────────

function todayLocal(): string {
  // 業務日：凌晨 03:00 前仍算前一天（回報窗 17:00～隔日 03:00）
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000 - 3 * 60 * 60 * 1000)
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
  const lines = raw.split('\n').map((l) => l.trim())
  let date    = ''
  let title   = ''
  let inBody  = false
  const visits: ParsedVisit[] = []
  let cur: { customerName: string; contentLines: string[] } | null = null

  // 支援多種編號格式：1. / 1、 / 1） / 1) / 1: / (1) / ①
  const numRe  = /^(?:\(\d+\)|\d+[.、．）)：:])\s*(.+)/
  // 支援多種分隔線字元（LINE 常見的 ━━━ ＿＿ 也都算）
  const sepRe  = /^[—\-─=━═＝_＿*＊~～]{3,}/
  // 日期：YYYY/MM/DD、YYYY-MM-DD、YYYY.MM.DD、MM/DD、MM-DD（無年份）
  const dateRe4 = /(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/
  const dateRe2 = /(\d{1,2})[\/.\-](\d{1,2})/

  function tryParseDate(text: string): string {
    const m4 = text.match(dateRe4)
    if (m4) return `${m4[1]}-${m4[2].padStart(2, '0')}-${m4[3].padStart(2, '0')}`
    const m2 = text.match(dateRe2)
    if (m2) {
      const year = new Date().getFullYear()
      return `${year}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`
    }
    return ''
  }

  for (const line of lines) {
    if (!line) {
      if (inBody && cur) cur.contentLines.push('')
      continue
    }

    // ── Header 欄位（分隔線前後都可出現）──
    if (line.startsWith('職稱：') || line.startsWith('職稱:')) {
      title = line.replace(/^職稱[：:]/, '').trim()
      continue
    }
    if (line.startsWith('日期：') || line.startsWith('日期:')) {
      if (!date) date = tryParseDate(line)
      continue
    }
    // 分隔線
    if (sepRe.test(line)) {
      inBody = true
      continue
    }

    // ── 嘗試在任意位置找日期（不需在「日期：」之後）──
    if (!date) {
      const d = tryParseDate(line)
      // 只有看起來真的是日期（有年份或格式完整）才採用
      if (d && dateRe4.test(line)) date = d
    }

    // ── 編號行：匯入標題前也接受，第一個編號自動開啟 body ──
    const nm = line.match(numRe)
    if (nm) {
      if (!inBody) inBody = true
      if (cur) {
        while (cur.contentLines.length && !cur.contentLines[cur.contentLines.length - 1]) cur.contentLines.pop()
        visits.push({ customerName: cur.customerName, content: cur.contentLines.join('\n') })
      }
      cur = { customerName: nm[1].trim(), contentLines: [] }
      continue
    }

    // ── 內文行 ──
    if (inBody && cur) {
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

export default function DailyReportPanel() {
  // Tab
  const [tab, setTab] = useState<'paste' | 'line'>('paste')

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

  // ── 貼上文字匯入 tab ────────────────────────────────────────────────
  const [rawText,      setRawText]      = useState('')
  const [matchedVisits, setMatchedVisits] = useState<MatchedVisit[]>([])
  const [impSp,        setImpSp]        = useState('')
  const [impDate,      setImpDate]      = useState('')
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

    if (p.visits.length === 0) {
      setImpResult('⚠️ 找不到編號項目（格式：1. 客戶名稱），請確認日報格式後重試')
      setMatchedVisits([])
      return
    }

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

    // 逐筆搜尋客戶資料庫
    p.visits.forEach((v, i) => {
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
      if (!res.ok || data.error) {
        setImpResult(`❌ ${data.error ?? '匯入失敗'}`)
        return
      }
      const failDetails = (data.errors ?? [])
        .map((e: any) => `${e.customerName}：${e.error}`)
        .join('、')
      if (data.created === 0) {
        setImpResult(`❌ 全部建立失敗${failDetails ? `（${failDetails}）` : '，請重試'}`)
        return
      }
      setImpResult(
        `✅ 已建立 ${data.created} 筆客情紀錄` +
        (data.errors?.length ? `，${data.errors.length} 筆失敗（${failDetails}）` : '')
      )
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
          { id: 'paste', label: '📝 貼上日報文字' },
          { id: 'line',  label: '📥 LINE 聊天記錄' },
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

      {/* ── LINE 聊天記錄匯入 Tab ── */}
      {tab === 'line' && <LineImportContent />}

      {/* ── 貼上文字匯入 Tab ── */}
      {tab === 'paste' && (
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

          {/* 業務 + 日期（解析前就要填） */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-500">
                業務姓名
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <select
                value={impSp}
                onChange={(e) => setImpSp(e.target.value)}
                className={`${ic} ${!impSp ? 'border-amber-300 ring-1 ring-amber-200' : ''}`}
              >
                <option value="">請選擇業務…</option>
                {spNames.map((n) => (
                  <option key={n} value={n}>
                    {inactiveNames.has(n) ? `${n}（已停用）` : n}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-gray-500">
                記錄日期
                <span className="text-red-500 ml-0.5">*</span>
              </label>
              <input
                type="date"
                value={impDate}
                max={todayLocal()}
                onChange={(e) => setImpDate(e.target.value)}
                className={`${ic} ${!impDate ? 'border-amber-300 ring-1 ring-amber-200' : ''}`}
              />
            </div>
          </div>

          {(!impSp || !impDate) && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              ⚠️ 請先選擇業務姓名與記錄日期，才能解析日報
            </p>
          )}

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

          <button
            onClick={handleParse}
            disabled={!rawText.trim() || !impSp || !impDate}
            title={!impSp ? '請先選擇業務' : !impDate ? '請先填寫日期' : ''}
            className="button-secondary w-full py-2.5 text-sm rounded-xl disabled:opacity-40">
            🔍 解析日報
          </button>

          {/* 解析結果 + 客戶比對 */}
          {matchedVisits.length > 0 && (
            <div className="space-y-4 border-t border-gray-100 pt-4">
              <h4 className="font-semibold text-gray-800">
                解析結果：{matchedVisits.length} 筆 — 請確認客戶對應
              </h4>

              {/* 已選：業務 + 日期（唯讀摘要，可點擊欄位修改） */}
              <div className="flex items-center gap-3 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                <span>👤 {impSp}</span>
                <span className="text-gray-300">｜</span>
                <span>📅 {impDate}</span>
                <span className="ml-auto text-gray-400 italic">如需修改請往上更改</span>
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
                disabled={importing || !impDate || matchedVisits.some((mv) => mv.searching || mv.reactionLoading) || matchedVisits.length === 0}
                className="button-primary w-full py-3 text-sm rounded-xl disabled:opacity-50 font-medium"
              >
                {importing
                  ? '建立中…'
                  : matchedVisits.some((mv) => mv.searching)
                  ? '比對中，請稍候…'
                  : !impDate
                  ? '請先填寫記錄日期'
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
