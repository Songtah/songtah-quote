'use client'
/**
 * CampaignsContent — 追蹤名單(/bd?tab=campaigns)
 *
 * 老闆貼上某商品的潛在購買清單 → 比對客戶主檔 → 業務逐一聯絡並一鍵更新狀態。
 * 成交由夜間 cron 掃訂單自動判定(含目標 SKU 即結案);拜訪紀錄建立時自動推「已聯絡」。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

const STATUSES = ['未聯絡', '已聯絡', '有興趣', '已報價', '成交', '放棄'] as const
const STATUS_COLOR: Record<string, { chip: string; bar: string }> = {
  未聯絡: { chip: 'bg-stone-100 text-stone-500', bar: 'bg-stone-300' },
  已聯絡: { chip: 'bg-sky-50 text-sky-600', bar: 'bg-sky-400' },
  有興趣: { chip: 'bg-amber-50 text-amber-600', bar: 'bg-amber-400' },
  已報價: { chip: 'bg-orange-50 text-orange-600', bar: 'bg-orange-400' },
  成交:   { chip: 'bg-brand-50 text-emerald-600', bar: 'bg-brand-500' },
  放棄:   { chip: 'bg-rose-50 text-rose-400', bar: 'bg-rose-300' },
}

type CampaignRow = {
  id: string; name: string; product: string; targetSkus: string[]
  deadline: string; status: string; note: string; creator: string; createdAt: string
  memberCount: number; byStatus: Record<string, number>
}
type Member = {
  id: string; customerId: string; name: string; status: string; salesperson: string
  note: string; dealOrderNo: string
  phone: string; address: string; city: string; district: string; type: string
}
type MatchResult = {
  matched: { input: string; customerId: string; name: string; salesperson: string }[]
  duplicated: string[]; ambiguous: { input: string; candidates: string[] }[]; unmatched: string[]
}

function telHref(phone: string): string | null {
  const cleaned = (phone || '').replace(/[^0-9+#*,;]/g, '')
  return cleaned.replace(/[^0-9]/g, '').length >= 6 ? cleaned : null
}

export default function CampaignsContent({ canManageAll = false }: { canManageAll?: boolean }) {
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null)
  const [error, setError] = useState('')
  const [detailId, setDetailId] = useState<string>('')   // 開啟中的名單
  const [showCreate, setShowCreate] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch('/api/bd/campaigns')
      if (!res.ok) throw new Error((await res.json()).error ?? '讀取失敗')
      setCampaigns((await res.json()).items ?? [])
    } catch (e: any) { setError(e?.message ?? '讀取追蹤名單失敗') }
  }, [])

  useEffect(() => { load() }, [load])

  if (error) {
    return (
      <div className="card-soft p-8 text-center">
        <p className="text-sm text-rose-500">{error}</p>
        <button onClick={load} className="mt-4 px-5 py-2 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">重試</button>
      </div>
    )
  }
  if (!campaigns) {
    return (
      <div className="card-soft p-10 text-center">
        <div className="inline-block w-6 h-6 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
        <p className="mt-3 text-sm text-stone-400">載入追蹤名單…</p>
      </div>
    )
  }

  if (detailId) {
    return <CampaignDetail campaignId={detailId} canManageAll={canManageAll} onBack={() => { setDetailId(''); load() }} />
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-sm text-stone-500">建立商品追蹤名單、交給業務聯絡；成交狀態由訂單自動判定。</p>
        {canManageAll && (
          <button onClick={() => setShowCreate(true)}
            className="w-full sm:w-auto min-h-11 px-5 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all">
            ＋ 建立名單
          </button>
        )}
      </div>

      {campaigns.length === 0 && (
        <div className="card-soft p-10 text-center text-sm text-stone-400">
          {canManageAll ? '還沒有任何追蹤名單——建立名單並加入客戶即可開始。' : '目前沒有指派給你的追蹤名單。'}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {campaigns.map((c) => {
          const done = (c.byStatus['成交'] ?? 0)
          const contacted = c.memberCount - (c.byStatus['未聯絡'] ?? 0)
          return (
            <button key={c.id} onClick={() => setDetailId(c.id)} className="card-soft card-soft-hover p-5 text-left transition-all">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold text-stone-800">{c.name}</h3>
                  <p className="mt-0.5 text-xs text-stone-400">🎯 {c.product}{c.deadline && ` ・截止 ${c.deadline}`}</p>
                </div>
                <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full ${c.status === '進行中' ? 'bg-brand-50 text-emerald-600' : 'bg-stone-100 text-stone-400'}`}>{c.status || '進行中'}</span>
              </div>
              {/* 疊層進度條 */}
              <div className="mt-4 h-2.5 rounded-full bg-stone-100 overflow-hidden flex">
                {STATUSES.filter((s) => s !== '未聯絡').map((s) => {
                  const n = c.byStatus[s] ?? 0
                  if (!n || !c.memberCount) return null
                  return <span key={s} className={`h-full ${STATUS_COLOR[s].bar}`} style={{ width: `${(n / c.memberCount) * 100}%` }} />
                })}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-stone-400">共 {c.memberCount} 家・已聯絡 {contacted}</span>
                <span className="font-semibold text-emerald-600">成交 {done}{c.memberCount ? `(${Math.round((done / c.memberCount) * 100)}%)` : ''}</span>
              </div>
            </button>
          )
        })}
      </div>

      {showCreate && <CreateModal onClose={(created) => { setShowCreate(false); if (created) load() }} />}
    </div>
  )
}

// ── 建立名單(含貼上清單比對預覽)──────────────────────────────────────────
function CreateModal({ onClose }: { onClose: (created: boolean) => void }) {
  const [name, setName] = useState('')
  const [product, setProduct] = useState('')
  const [skus, setSkus] = useState('')
  const [deadline, setDeadline] = useState('')
  const [listText, setListText] = useState('')
  const [preview, setPreview] = useState<MatchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const lines = useMemo(() => listText.split('\n').map((l) => l.trim()).filter(Boolean), [listText])

  async function createAndImport() {
    if (!name.trim() || !product.trim()) { setErr('名單名稱與目標商品必填'); return }
    setBusy(true); setErr('')
    try {
      const res = await fetch('/api/bd/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), product: product.trim(),
          targetSkus: skus.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
          deadline: deadline || undefined,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '建立失敗')
      const { campaign } = await res.json()
      if (lines.length) {
        const imp = await fetch(`/api/bd/campaigns/${campaign.id}/members`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines, dryRun: false }),
        })
        if (!imp.ok) throw new Error((await imp.json()).error ?? '匯入失敗')
      }
      onClose(true)
    } catch (e: any) { setErr(e?.message ?? '建立失敗'); setBusy(false) }
  }

  async function runPreview() {
    if (!lines.length) { setErr('請先貼上客戶清單'); return }
    setBusy(true); setErr(''); setPreview(null)
    try {
      // dryRun 比對需要一個名單 id 才能去重——建立前先用暫存路徑:直接以任一 id 呼叫不行,
      // 故預覽走「未建立名單」版本:掛在 create 流程前,用 dryRun 專用 id '_preview'。
      const res = await fetch('/api/bd/campaigns/_preview/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, dryRun: true }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '比對失敗')
      setPreview(await res.json())
    } catch (e: any) { setErr(e?.message ?? '比對失敗') } finally { setBusy(false) }
  }

  const input = 'w-full px-4 py-2.5 rounded-2xl bg-stone-50 outline outline-1 outline-stone-900/[0.08] focus:bg-white focus:outline-brand-400 text-sm'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 overflow-y-auto">
      <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={() => onClose(false)} />
      <div className="relative w-full max-w-2xl bg-[#fdfdfb] rounded-3xl shadow-2xl ring-1 ring-stone-900/[0.06] overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-stone-900/[0.06] flex items-center justify-between">
          <h3 className="text-lg font-bold">建立追蹤名單</h3>
          <button onClick={() => onClose(false)} className="w-9 h-9 flex items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 transition-all text-lg">✕</button>
        </div>
        <div className="p-4 sm:p-6 space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">名單名稱 *</label>
              <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="例:HT+ 鋯塊 Q3 推廣名單" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">目標商品 *</label>
              <input className={input} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="例:HT+ 氧化鋯塊" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">目標 SKU(選填,成交自動判定用)</label>
              <input className={input} value={skus} onChange={(e) => setSkus(e.target.value)} placeholder="例:BS-HT+95H14, BS-HT+95H12" />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-500 mb-1.5">截止日(選填)</label>
              <input type="date" className={input} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5">貼上客戶清單(每行一個,客戶名稱或機構代碼;可先留空之後再加)</label>
            <textarea className={input} rows={6} value={listText} onChange={(e) => setListText(e.target.value)} placeholder={'築嶼牙醫診所\n3701029435\n倫敦美學牙醫診所'} />
            <p className="mt-1 text-[11px] text-stone-400">{lines.length} 行</p>
          </div>

          {preview && (
            <div className="rounded-2xl bg-white ring-1 ring-stone-900/[0.06] p-4 text-sm space-y-1.5">
              <p>✅ 比對成功 <span className="font-bold text-emerald-600">{preview.matched.length}</span> 家(將自動帶入負責業務)</p>
              {preview.duplicated.length > 0 && <p className="text-stone-400">↩︎ 已在名單內跳過 {preview.duplicated.length} 家</p>}
              {preview.ambiguous.length > 0 && (
                <p className="text-amber-600">⚠ 同名多筆 {preview.ambiguous.length} 筆(暫不匯入):{preview.ambiguous.map((a) => a.input).join('、')}</p>
              )}
              {preview.unmatched.length > 0 && (
                <p className="text-rose-500">✗ 比對不到 {preview.unmatched.length} 筆:{preview.unmatched.slice(0, 8).join('、')}{preview.unmatched.length > 8 ? '…' : ''}</p>
              )}
            </div>
          )}
          {err && <p className="text-sm text-rose-500">{err}</p>}
        </div>
        <div className="sticky bottom-0 bg-[#fdfdfb]/95 backdrop-blur px-4 sm:px-6 py-4 border-t border-stone-900/[0.06] flex flex-col-reverse sm:flex-row gap-2 sm:justify-between">
          <button onClick={runPreview} disabled={busy || !lines.length}
            className="px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all disabled:opacity-40">
            {busy && !preview ? '比對中…' : '比對預覽'}
          </button>
          <button onClick={createAndImport} disabled={busy}
            className="px-6 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all disabled:opacity-50">
            {busy ? '處理中…' : lines.length ? `建立並匯入 ${lines.length} 行` : '建立空名單'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 名單詳情(成員清單+一鍵改狀態)────────────────────────────────────────
function CampaignDetail({ campaignId, canManageAll, onBack }: { campaignId: string; canManageAll: boolean; onBack: () => void }) {
  const [campaign, setCampaign] = useState<CampaignRow | null>(null)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [spFilter, setSpFilter] = useState('')
  const [busyId, setBusyId] = useState('')
  const [showImport, setShowImport] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch(`/api/bd/campaigns/${campaignId}`)
      if (!res.ok) throw new Error((await res.json()).error ?? '讀取失敗')
      const d = await res.json()
      setCampaign(d.campaign); setMembers(d.members ?? [])
    } catch (e: any) { setError(e?.message ?? '讀取名單失敗') }
  }, [campaignId])

  useEffect(() => { load() }, [load])

  async function setStatus(memberId: string, status: string) {
    setBusyId(memberId)
    try {
      const res = await fetch(`/api/bd/campaigns/${campaignId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, status }),
      })
      if (res.ok) setMembers((prev) => prev?.map((m) => m.id === memberId ? { ...m, status } : m) ?? null)
    } finally { setBusyId('') }
  }

  function exportCsv() {
    if (!members?.length || !campaign) return
    const headers = ['客戶名稱', '狀態', '負責業務', '類型', '縣市', '行政區', '地址', '電話', '成交單號']
    const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`
    const rows = members.map((m) => [m.name, m.status, m.salesperson, m.type, m.city, m.district, m.address, m.phone, m.dealOrderNo].map(esc).join(','))
    const blob = new Blob(['﻿' + headers.join(',') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${campaign.name}_成員.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  const salespersons = useMemo(() => Array.from(new Set((members ?? []).map((m) => m.salesperson).filter(Boolean))).sort(), [members])
  const shown = useMemo(() => (members ?? []).filter((m) =>
    (!statusFilter || m.status === statusFilter) && (!spFilter || m.salesperson === spFilter)
  ), [members, statusFilter, spFilter])

  if (error) return <div className="card-soft p-8 text-center text-sm text-rose-500">{error}</div>
  if (!campaign || !members) {
    return (
      <div className="card-soft p-10 text-center">
        <div className="inline-block w-6 h-6 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
        <p className="mt-3 text-sm text-stone-400">載入成員…</p>
      </div>
    )
  }

  const counts: Record<string, number> = {}
  for (const m of members) counts[m.status] = (counts[m.status] ?? 0) + 1

  return (
    <div className="space-y-5">
      {/* 標頭 */}
      <div className="card-soft p-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <button onClick={onBack} className="text-xs text-stone-400 hover:text-brand-600 transition-colors">← 回名單列表</button>
            <h2 className="mt-1 text-xl font-bold text-stone-800">{campaign.name}</h2>
            <p className="mt-1 text-sm text-stone-500">
              🎯 {campaign.product}
              {campaign.targetSkus.length > 0 && <span className="text-stone-400">(SKU:{campaign.targetSkus.join(', ')}——訂單含此 SKU 每晚自動標成交)</span>}
              {campaign.deadline && ` ・截止 ${campaign.deadline}`}
            </p>
          </div>
          {canManageAll && (
            <div className="flex gap-2">
              <button onClick={() => setShowImport(true)} className="px-4 py-2 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all">＋ 加成員</button>
              <button onClick={exportCsv} className="px-4 py-2 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all">⤓ 匯出 CSV</button>
            </div>
          )}
        </div>
        {/* 狀態統計 chips(可點=篩選) */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button onClick={() => setStatusFilter('')} className={`px-3 py-1.5 rounded-full text-xs transition-all ${!statusFilter ? 'bg-stone-800 text-white' : 'bg-white ring-1 ring-stone-900/[0.08] text-stone-500 hover:bg-stone-50'}`}>全部 {members.length}</button>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
              className={`px-3 py-1.5 rounded-full text-xs transition-all ${statusFilter === s ? 'ring-2 ring-brand-400 ' : 'ring-1 ring-stone-900/[0.06] hover:opacity-80 '}${STATUS_COLOR[s].chip}`}>
              {s} {counts[s] ?? 0}
            </button>
          ))}
          {canManageAll && salespersons.length > 0 && (
            <select className="ml-auto text-xs px-3 py-1.5 rounded-full bg-white ring-1 ring-stone-900/[0.08] text-stone-600" value={spFilter} onChange={(e) => setSpFilter(e.target.value)}>
              <option value="">全部業務</option>
              {salespersons.map((sp) => <option key={sp} value={sp}>{sp}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* 成員清單 */}
      <div className="card-soft overflow-hidden divide-y divide-stone-900/[0.05]">
        {shown.length === 0 && <p className="px-6 py-10 text-center text-sm text-stone-400">{members.length === 0 ? (canManageAll ? '尚無成員——請加入客戶名單' : '目前沒有指派給你的客戶') : '此篩選下沒有成員'}</p>}
        {shown.map((m) => {
          const tel = telHref(m.phone)
          return (
            <div key={m.id} className="px-5 py-3.5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={`/customers/${m.customerId}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-stone-800 hover:text-brand-700">{m.name}</a>
                    {m.type && <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-500">{m.type}</span>}
                    {m.salesperson && <span className="text-xs text-stone-400">{m.salesperson}</span>}
                    {m.dealOrderNo && <span className="text-xs px-2 py-0.5 rounded-full bg-brand-50 text-emerald-600">單號 {m.dealOrderNo}</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-stone-400 truncate">{[m.city, m.district, m.address].filter(Boolean).join('・')}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {tel && <a href={`tel:${tel}`} className="px-3 py-1.5 rounded-full text-xs font-medium bg-brand-50 text-emerald-600 hover:bg-brand-50 active:scale-95 transition-all whitespace-nowrap">📞 {m.phone}</a>}
                  <div className={`flex gap-1 ${busyId === m.id ? 'opacity-40 pointer-events-none' : ''}`}>
                    {STATUSES.map((s) => (
                      <button key={s} onClick={() => setStatus(m.id, s)} title={s}
                        className={`px-2 py-1 rounded-full text-[11px] transition-all active:scale-95 ${m.status === s ? STATUS_COLOR[s].chip + ' ring-2 ring-brand-400 font-bold' : 'bg-white ring-1 ring-stone-900/[0.06] text-stone-400 hover:' + STATUS_COLOR[s].chip.split(' ')[0]}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {showImport && <ImportModal campaignId={campaignId} onClose={(imported) => { setShowImport(false); if (imported) load() }} />}
    </div>
  )
}

// ── 加成員(既有名單追加:貼上清單 / 智慧產生)──────────────────────────────
type Candidate = { customerId: string; name: string; salesperson: string; area: string; reason: string }

function ImportModal({ campaignId, onClose }: { campaignId: string; onClose: (imported: boolean) => void }) {
  const [tab, setTab] = useState<'paste' | 'smart'>('paste')
  const [listText, setListText] = useState('')
  const [preview, setPreview] = useState<MatchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const lines = useMemo(() => listText.split('\n').map((l) => l.trim()).filter(Boolean), [listText])

  // 智慧產生狀態
  const [source, setSource] = useState<'cross-sell' | 'visit-interest' | 'competitor'>('cross-sell')
  const [scope, setScope] = useState<'series' | 'category' | 'brand'>('series')
  const [keyword, setKeyword] = useState('')
  const [competitor, setCompetitor] = useState('')
  const [competitorOptions, setCompetitorOptions] = useState<string[]>([])
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [capped, setCapped] = useState(false)

  // 競品選項(切到競品來源時載入一次)
  useEffect(() => {
    if (source === 'competitor' && competitorOptions.length === 0) {
      fetch('/api/visits/options').then((r) => r.json()).then((d) => setCompetitorOptions(d.competitorOptions ?? [])).catch(() => {})
    }
  }, [source, competitorOptions.length])

  async function run(dryRun: boolean) {
    if (!lines.length) { setErr('請先貼上清單'); return }
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/bd/campaigns/${campaignId}/members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines, dryRun }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '失敗')
      const d = await res.json()
      if (dryRun) setPreview(d)
      else onClose(true)
    } catch (e: any) { setErr(e?.message ?? '失敗') } finally { setBusy(false) }
  }

  async function generate() {
    setBusy(true); setErr(''); setCandidates(null)
    try {
      const res = await fetch(`/api/bd/campaigns/${campaignId}/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, scope, keyword: keyword || undefined, competitor: competitor || undefined }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? '產生失敗')
      setCandidates(d.candidates ?? [])
      setCapped(!!d.capped)
      setChecked(new Set((d.candidates ?? []).map((c: Candidate) => c.customerId)))
    } catch (e: any) { setErr(e?.message ?? '產生失敗') } finally { setBusy(false) }
  }

  async function importChecked() {
    const sel = (candidates ?? []).filter((c) => checked.has(c.customerId))
    if (!sel.length) { setErr('請至少勾選一家'); return }
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/bd/campaigns/${campaignId}/members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: sel.map((c) => ({ customerId: c.customerId, name: c.name, salesperson: c.salesperson })) }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '匯入失敗')
      onClose(true)
    } catch (e: any) { setErr(e?.message ?? '匯入失敗'); setBusy(false) }
  }

  const srcChip = (active: boolean) => `px-3.5 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 ${active ? 'bg-brand-500 text-white' : 'bg-white ring-1 ring-stone-900/[0.08] text-stone-600 hover:bg-stone-50'}`

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 py-10 overflow-y-auto">
      <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm" onClick={() => onClose(false)} />
      <div className="relative w-full max-w-2xl bg-[#fdfdfb] rounded-3xl shadow-2xl ring-1 ring-stone-900/[0.06] overflow-hidden">
        <div className="px-6 py-4 border-b border-stone-900/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold">加入成員</h3>
            <div className="inline-flex rounded-full bg-stone-100 p-0.5">
              <button onClick={() => setTab('paste')} className={`px-3.5 py-1 rounded-full text-xs font-medium transition-all ${tab === 'paste' ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500'}`}>貼上清單</button>
              <button onClick={() => setTab('smart')} className={`px-3.5 py-1 rounded-full text-xs font-medium transition-all ${tab === 'smart' ? 'bg-brand-500 text-white shadow-sm' : 'text-stone-500'}`}>🤖 智慧產生</button>
            </div>
          </div>
          <button onClick={() => onClose(false)} className="w-9 h-9 flex items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 transition-all text-lg">✕</button>
        </div>

        {tab === 'paste' ? (
          <>
            <div className="p-6 space-y-3">
              <textarea className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 outline outline-1 outline-stone-900/[0.08] focus:bg-white focus:outline-brand-400 text-sm" rows={7}
                value={listText} onChange={(e) => setListText(e.target.value)} placeholder={'每行一個客戶名稱或機構代碼'} />
              <p className="text-[11px] text-stone-400">{lines.length} 行</p>
              {preview && (
                <div className="rounded-2xl bg-white ring-1 ring-stone-900/[0.06] p-4 text-sm space-y-1.5">
                  <p>✅ 可匯入 <span className="font-bold text-emerald-600">{preview.matched.length}</span> 家</p>
                  {preview.duplicated.length > 0 && <p className="text-stone-400">↩︎ 已在名單內 {preview.duplicated.length} 家</p>}
                  {preview.ambiguous.length > 0 && <p className="text-amber-600">⚠ 同名多筆:{preview.ambiguous.map((a) => a.input).join('、')}</p>}
                  {preview.unmatched.length > 0 && <p className="text-rose-500">✗ 比對不到:{preview.unmatched.slice(0, 8).join('、')}{preview.unmatched.length > 8 ? '…' : ''}</p>}
                </div>
              )}
              {err && <p className="text-sm text-rose-500">{err}</p>}
            </div>
            <div className="px-6 py-4 border-t border-stone-900/[0.06] flex justify-between">
              <button onClick={() => run(true)} disabled={busy || !lines.length} className="px-5 py-2.5 rounded-full text-sm font-medium border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 active:scale-95 transition-all disabled:opacity-40">{busy ? '處理中…' : '比對預覽'}</button>
              <button onClick={() => run(false)} disabled={busy || !lines.length} className="px-6 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all disabled:opacity-50">確認匯入</button>
            </div>
          </>
        ) : (
          <>
            <div className="p-6 space-y-4">
              {/* 來源 */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">名單來源</p>
                <div className="flex flex-wrap gap-2">
                  <button className={srcChip(source === 'cross-sell')} onClick={() => { setSource('cross-sell'); setCandidates(null) }}>🛒 交叉銷售(買過相關產品)</button>
                  <button className={srcChip(source === 'visit-interest')} onClick={() => { setSource('visit-interest'); setCandidates(null) }}>💬 拜訪表達過興趣</button>
                  <button className={srcChip(source === 'competitor')} onClick={() => { setSource('competitor'); setCandidates(null) }}>⚔️ 使用競品</button>
                </div>
              </div>
              {/* 參數 */}
              {source === 'cross-sell' && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">關聯範圍(依名單的目標 SKU 推算)</p>
                  <div className="flex gap-2">
                    {([['series', '同系列'], ['category', '同分類'], ['brand', '同品牌']] as const).map(([v, l]) => (
                      <button key={v} className={srcChip(scope === v)} onClick={() => { setScope(v); setCandidates(null) }}>{l}</button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-stone-400">例:目標 HT+ 鋯塊 → 找買過{scope === 'series' ? ' HT+ 其他規格' : scope === 'category' ? '其他氧化鋯塊' : '貝施美其他產品'}、但沒買過目標 SKU 的客戶</p>
                </div>
              )}
              {source === 'visit-interest' && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">關鍵字(留空=用名單的目標商品)</p>
                  <input className="w-full px-4 py-2.5 rounded-2xl bg-stone-50 outline outline-1 outline-stone-900/[0.08] focus:bg-white focus:outline-brand-400 text-sm"
                    value={keyword} onChange={(e) => { setKeyword(e.target.value); setCandidates(null) }} placeholder="比對拜訪紀錄的「有興趣的產品」與內容" />
                </div>
              )}
              {source === 'competitor' && (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400 mb-2">競品</p>
                  <select className="select-soft w-full text-sm" value={competitor} onChange={(e) => { setCompetitor(e.target.value); setCandidates(null) }}>
                    <option value="">— 選擇競品 —</option>
                    {competitorOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              )}

              <button onClick={generate} disabled={busy}
                className="px-6 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all disabled:opacity-50">
                {busy && !candidates ? '分析中…(掃描訂單/拜訪紀錄)' : '產生候選名單'}
              </button>

              {/* 候選清單 */}
              {candidates && (
                <div className="rounded-2xl bg-white ring-1 ring-stone-900/[0.06] overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-stone-900/[0.05] flex items-center justify-between text-sm">
                    <p>找到 <span className="font-bold text-brand-600">{candidates.length}</span> 家候選{capped && <span className="text-amber-500 text-xs">(已達 300 上限)</span>}・已勾 {checked.size}</p>
                    <div className="flex gap-2 text-xs">
                      <button className="text-brand-600" onClick={() => setChecked(new Set(candidates.map((c) => c.customerId)))}>全選</button>
                      <button className="text-stone-400" onClick={() => setChecked(new Set())}>全不選</button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-stone-900/[0.04]">
                    {candidates.length === 0 && <p className="px-4 py-6 text-center text-sm text-stone-400">沒有符合的候選(已排除名單內既有成員)</p>}
                    {candidates.map((c) => (
                      <label key={c.customerId} className="flex items-start gap-3 px-4 py-2.5 hover:bg-brand-50/40 cursor-pointer">
                        <input type="checkbox" className="mt-1 accent-[#b8956a]" checked={checked.has(c.customerId)}
                          onChange={() => setChecked((prev) => { const n = new Set(prev); n.has(c.customerId) ? n.delete(c.customerId) : n.add(c.customerId); return n })} />
                        <span className="min-w-0">
                          <span className="text-sm font-semibold text-stone-800">{c.name}</span>
                          <span className="ml-2 text-xs text-stone-400">{c.area}{c.salesperson && `・${c.salesperson}`}</span>
                          <span className="block text-xs text-stone-500 truncate">{c.reason}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {err && <p className="text-sm text-rose-500">{err}</p>}
            </div>
            <div className="px-6 py-4 border-t border-stone-900/[0.06] flex justify-end">
              <button onClick={importChecked} disabled={busy || !candidates || checked.size === 0}
                className="px-6 py-2.5 rounded-full text-sm font-semibold bg-brand-500 text-white hover:bg-brand-600 shadow-md shadow-brand-500/25 active:scale-95 transition-all disabled:opacity-40">
                {busy && candidates ? '匯入中…' : `匯入所選 ${checked.size} 家`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
