'use client'

/**
 * 商機偵測分頁——檢視客戶主檔「商機標籤」(金訊號排前),並可掃描新區域產生標籤。
 * 檢視唯讀(clinic_monitor);掃描寫入限中央管理(canScan)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

type OppCustomer = {
  id: string; name: string; city: string; district: string
  salesperson: string; phone: string; address: string
  tags: string[]; goldTags: string[]
}
type Stats = { tagCounts: Record<string, number>; goldCustomers: number; total: number; allTags: string[]; goldTags: string[] }

function telHref(p: string) { return 'tel:' + (p || '').replace(/[^\d+]/g, '') }
function mapHref(name: string, addr: string) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr || name) }

export default function OpportunityContent({ canScan = false }: { canScan?: boolean }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [items, setItems] = useState<OppCustomer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tag, setTag] = useState('')       // 篩選標籤(空=全部)
  const [goldOnly, setGoldOnly] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)

  const goldSet = useMemo(() => new Set(stats?.goldTags ?? ['院內技工室', '數位牙科', '3D列印']), [stats])

  const loadStats = useCallback(() => {
    fetch('/api/opportunity?mode=stats').then((r) => r.json()).then((d) => { if (!d.error) setStats(d) }).catch(() => {})
  }, [])
  const loadList = useCallback(() => {
    setLoading(true); setError('')
    const q = new URLSearchParams()
    if (tag) q.set('tag', tag)
    if (goldOnly) q.set('goldOnly', '1')
    fetch('/api/opportunity?' + q).then(async (r) => {
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '讀取失敗')
      setItems(d.items ?? [])
    }).catch((e) => setError(e.message)).finally(() => setLoading(false))
  }, [tag, goldOnly])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadList() }, [loadList])

  const exportCsv = () => {
    const header = ['機構名稱', '縣市', '行政區', '負責業務', '電話', '商機標籤', '金訊號']
    const rows = items.map((c) => [c.name, c.city, c.district, c.salesperson, c.phone, c.tags.join('、'), c.goldTags.join('、')])
    const csv = '﻿' + [header, ...rows].map((r) => r.map((x) => `"${(x || '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `商機名單${tag ? '_' + tag : ''}_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  }

  return (
    <div className="space-y-6">
      {/* 頂部:金訊號統計 + 掃描鈕 */}
      <div className="card-soft p-5">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="font-bold text-stone-800">🔍 商機偵測</h3>
          <span className="text-xs text-stone-400">
            {stats ? <>已標記 <b className="text-stone-600">{stats.total}</b> 家,其中 <b className="text-brand-700">{stats.goldCustomers}</b> 家含金訊號(設備直客)</> : '載入中…'}
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={exportCsv} disabled={!items.length}
                    className="px-4 py-2 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all disabled:opacity-40">
              匯出 CSV
            </button>
            {canScan && (
              <button onClick={() => setScanOpen(true)}
                      className="px-5 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all">
                掃描新區域
              </button>
            )}
          </div>
        </div>

        {/* 標籤篩選 chips */}
        {stats && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={() => { setTag(''); setGoldOnly(false) }}
                    className={`chip text-xs ${!tag && !goldOnly ? 'chip-active' : ''}`}>全部 {stats.total}</button>
            <button onClick={() => { setGoldOnly((v) => !v); setTag('') }}
                    className={`chip text-xs ${goldOnly ? 'chip-active' : ''}`}>🔥 僅金訊號 {stats.goldCustomers}</button>
            <span className="w-px h-4 bg-stone-200 mx-1" />
            {stats.allTags.map((t) => (
              <button key={t} onClick={() => { setTag(tag === t ? '' : t); setGoldOnly(false) }}
                      className={`chip text-xs ${tag === t ? 'chip-active' : ''} ${goldSet.has(t) ? 'font-semibold' : ''}`}>
                {goldSet.has(t) ? '🔥 ' : ''}{t} {stats.tagCounts[t] ?? 0}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="card-soft p-4 text-sm text-red-600">{error}</div>}
      {loading && <div className="card-soft p-8 text-center text-sm text-stone-400">載入中…</div>}

      {!loading && (
        <div className="card-soft overflow-hidden">
          <header className="px-5 py-3 flex items-baseline gap-2 border-b border-stone-900/[0.06] bg-brand-50/40">
            <span className="text-sm font-semibold text-stone-700">{tag || (goldOnly ? '金訊號名單' : '全部商機名單')}</span>
            <span className="ml-auto text-xs text-stone-400">{items.length} 家</span>
          </header>
          {items.length === 0 ? (
            <div className="p-8 text-center text-sm text-stone-400">
              尚無資料。{canScan ? '用「掃描新區域」對某區牙醫診所產生商機標籤。' : '請管理員掃描區域後產生。'}
            </div>
          ) : (
            <ul className="divide-y divide-stone-900/[0.04]">
              {items.map((c) => (
                <li key={c.id} className="px-5 py-3 flex items-start gap-3 hover:bg-brand-50/50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-stone-800">{c.name}</span>
                      <span className="text-[11px] text-stone-400">{c.city}{c.district}</span>
                      {c.salesperson && <span className="chip text-[10px]">{c.salesperson}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {c.tags.map((t) => (
                        <span key={t} className={`text-[11px] px-2 py-0.5 rounded-full ${goldSet.has(t) ? 'bg-brand-500 text-white font-semibold' : 'bg-stone-100 text-stone-500'}`}>
                          {goldSet.has(t) ? '🔥 ' : ''}{t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2 self-center">
                    {c.phone && (
                      <a href={telHref(c.phone)} className="px-3 py-1.5 rounded-full text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all">撥號</a>
                    )}
                    <a href={mapHref(c.name, c.address)} target="_blank" rel="noreferrer"
                       className="px-3 py-1.5 rounded-full text-xs font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">導航</a>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {scanOpen && <ScanModal onClose={() => setScanOpen(false)} onDone={() => { setScanOpen(false); loadStats(); loadList() }} />}
    </div>
  )
}

// ── 掃描新區域(dryRun 預覽 → 確認寫入)──────────────────────────────
function ScanModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [city, setCity] = useState('臺北市')
  const [district, setDistrict] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [ok, setOk] = useState('')

  const run = async (dryRun: boolean) => {
    if (!city || !district) { setErr('請填縣市與行政區'); return }
    setBusy(true); setErr(''); if (dryRun) { setPreview(null); setOk('') }
    try {
      const r = await fetch('/api/opportunity/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ city, district, dryRun }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || '掃描失敗')
      if (dryRun) setPreview(d)
      else setOk(`已寫入 ${d.written} 家的商機標籤(命中 ${d.tagged} 家,金訊號 ${d.goldCustomers}）`)
    } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#fcfbf8] rounded-3xl shadow-2xl ring-1 ring-stone-900/[0.06] w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <header className="px-6 py-4 border-b border-stone-900/[0.06] flex items-center justify-between">
          <h3 className="font-bold text-stone-800">掃描新區域產生商機標籤</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl leading-none active:scale-95 transition-all">×</button>
        </header>
        <div className="p-6 space-y-4">
          {ok ? (
            <>
              <p className="text-sm text-emerald-700 bg-emerald-50 rounded-2xl p-4">{ok}</p>
              <button onClick={onDone} className="w-full px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all">完成</button>
            </>
          ) : (
            <>
              <p className="text-xs text-stone-500 bg-stone-50 rounded-2xl p-3 leading-relaxed">
                對該區<b>牙醫診所</b>用 Google 反查官網並偵測商機關鍵字。<b>每家約 US$0.03</b>(Google Places,免費額度內)。先預覽再寫入;標籤只加不蓋。大區(數百家)需 1–2 分鐘。
              </p>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400">縣市</label>
                  <input className="input-soft mt-1 w-full" value={city} onChange={(e) => { setCity(e.target.value); setPreview(null) }} placeholder="臺北市" />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] font-bold uppercase tracking-widest text-stone-400">行政區</label>
                  <input className="input-soft mt-1 w-full" value={district} onChange={(e) => { setDistrict(e.target.value); setPreview(null) }} placeholder="信義區" />
                </div>
              </div>

              {busy && <p className="text-sm text-stone-400">處理中…(掃描中請勿關閉)</p>}
              {err && <p className="text-sm text-red-600">{err}</p>}

              {preview && (
                <div className="text-sm text-stone-600 bg-brand-50/50 rounded-2xl p-3 space-y-2">
                  <div>{preview.city}{preview.district} 共 {preview.total} 家 → Google 命中 {preview.placeHit}、有商機訊號 <b>{preview.tagged}</b> 家、🔥 金訊號 <b className="text-brand-700">{preview.goldCustomers}</b> 家(費用約 US${preview.estUsd})</div>
                  {preview.rows?.slice(0, 8).map((r: any) => (
                    <div key={r.id} className="text-xs text-stone-500">
                      {r.goldTags?.length ? '🔥 ' : '・'}<b className="text-stone-700">{r.name}</b> → {r.tags.join('、')}
                    </div>
                  ))}
                  {preview.rows?.length > 8 && <div className="text-xs text-stone-400">…等共 {preview.rows.length} 家有命中</div>}
                </div>
              )}

              <div className="flex gap-2">
                {!preview ? (
                  <button onClick={() => run(true)} disabled={busy}
                          className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all disabled:opacity-40">
                    預覽(不寫入)
                  </button>
                ) : (
                  <>
                    <button onClick={() => setPreview(null)} className="flex-1 px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">重選</button>
                    <button onClick={() => run(false)} disabled={busy || preview.tagged === 0}
                            className="flex-1 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 active:scale-95 transition-all disabled:opacity-40">
                      確認寫入 {preview.tagged} 家
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
