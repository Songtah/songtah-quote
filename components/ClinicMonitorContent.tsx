'use client'

import { useState, useMemo, useEffect } from 'react'
import type {
  MonitorResult, NewOpening, ClosureDetail,
  SuggestedMatch, MatchedCustomer, MonitorStats,
} from '@/app/api/admin/medical-monitor/route'

// ── Shared UI ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: {
  label: string; value: number | string; sub?: string; accent?: string
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-col gap-1">
      <span className="text-xs text-gray-400 font-medium">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${accent ?? 'text-gray-900'}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  )
}

function TypeChip({ kind }: { kind: string }) {
  const MAP: Record<string, string> = {
    '牙醫一般診所': 'bg-blue-50 text-blue-700',
    '牙醫診所':     'bg-blue-50 text-blue-700',
    '牙醫專科診所': 'bg-indigo-50 text-indigo-700',
    '牙體技術所':   'bg-violet-50 text-violet-700',
    '醫院':         'bg-orange-50 text-orange-700',
  }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${MAP[kind] ?? 'bg-gray-100 text-gray-600'}`}>
      {kind}
    </span>
  )
}

function CollapsibleSection({ title, count, color, children, defaultOpen = true }: {
  title: string; count: number; color: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-left"
      >
        <span className="flex-1 flex items-center gap-3">
          <span className="font-semibold text-gray-800 text-sm">{title}</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>{count} 筆</span>
        </span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="bg-white">{children}</div>}
    </div>
  )
}

// ── Detail Modal ───────────────────────────────────────────────────────────────

type DetailModalData =
  | { kind: 'matched';   item: MatchedCustomer }
  | { kind: 'suggested'; item: SuggestedMatch }
  | { kind: 'closure';   item: ClosureDetail }

function DetailModal({ data, onClose }: { data: DetailModalData; onClose: () => void }) {
  const formatTermDate = (td: string) => {
    if (!td || td.length < 8) return '—'
    return `${td.slice(0,4)}/${td.slice(4,6)}/${td.slice(6,8)}`
  }

  const isTerminated = (td?: string) => {
    if (!td || td.length < 8) return false
    const d = new Date(+td.slice(0,4), +td.slice(4,6)-1, +td.slice(6,8))
    return d < new Date()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-gray-400 mb-1">
              {data.kind === 'matched'   ? '✅ 已對應客戶'   :
               data.kind === 'suggested' ? '🔍 建議補代碼'   :
                                           '⚠️ 可能歇業'}
            </p>
            <h2 className="font-bold text-gray-900 text-lg leading-tight">
              {data.item.customerName}
            </h2>
            <p className="text-sm text-gray-400 mt-0.5">
              {data.item.customerCity}{data.item.customerDistrict && ` ${data.item.customerDistrict}`}
              {data.item.customerType && ` · ${data.item.customerType}`}
              {data.item.customerStatus && ` · ${data.item.customerStatus}`}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* 條件 1：已對應 */}
          {data.kind === 'matched' && (() => {
            const { item } = data
            const terminated = isTerminated(item.snapshotTermDate)
            return (
              <>
                <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                  <p className="text-xs font-semibold text-gray-400 mb-2">機構代碼資訊</p>
                  <Row label="機構代碼" value={<code className="font-mono text-xs bg-white border border-gray-200 px-1.5 py-0.5 rounded">{item.institutionCode}</code>} />
                  <Row label="快照名稱" value={item.snapshotName} />
                  <Row label="類型"     value={<TypeChip kind={item.snapshotKind} />} />
                  <Row label="地址"     value={item.snapshotAddress} />
                  <Row label="NHI 特約終止日"
                    value={
                      <span className={terminated ? 'text-red-600 font-semibold' : 'text-gray-700'}>
                        {formatTermDate(item.snapshotTermDate)}
                        {terminated && ' ⚠️ 已終止'}
                      </span>
                    }
                  />
                </div>
                {terminated && (
                  <div className="text-xs bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-amber-700">
                    ⚠️ NHI 特約已終止，建議確認診所是否仍在開業
                  </div>
                )}
              </>
            )
          })()}

          {/* 條件 2：建議補代碼 */}
          {data.kind === 'suggested' && (
            <>
              <p className="text-xs text-gray-400">以下是依名稱比對到的候選機構，請確認後在客戶頁面手動填入機構代碼</p>
              <div className="space-y-2">
                {data.item.suggestions.map(s => (
                  <div key={s.code} className="rounded-xl border border-gray-200 p-3 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-gray-900">{s.name}</span>
                      <TypeChip kind={s.kind} />
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                        s.score >= 1.0 ? 'bg-emerald-100 text-emerald-700' :
                        s.score >= 0.85 ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {s.score >= 1.0 ? '精確' : s.score >= 0.85 ? '高度相符' : '相符'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 space-y-0.5">
                      <p><span className="font-mono bg-gray-100 rounded px-1 text-gray-600">{s.code}</span>　{s.city}{s.district}</p>
                      <p>{s.address}</p>
                      {s.termDate && (
                        <p className={isTerminated(s.termDate) ? 'text-red-500' : ''}>
                          NHI 特約終止日：{formatTermDate(s.termDate)}
                          {isTerminated(s.termDate) && ' ⚠️ 已終止'}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 條件 3：可能歇業 */}
          {data.kind === 'closure' && (() => {
            const { item } = data
            return (
              <>
                <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                  <p className="text-xs font-semibold text-gray-400 mb-2">異常原因</p>
                  <div className={`text-sm font-semibold px-3 py-2 rounded-lg ${
                    item.reason === 'nhi_terminated'
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {item.reason === 'nhi_terminated' ? '⚠️ NHI 特約已終止（代碼仍在快照中）' : '❌ 代碼查無（快照中找不到此代碼）'}
                  </div>
                  <Row label="機構代碼" value={<code className="font-mono text-xs bg-white border border-gray-200 px-1.5 py-0.5 rounded">{item.institutionCode}</code>} />
                  {item.reason === 'nhi_terminated' && (
                    <>
                      <Row label="快照名稱" value={item.snapshotName ?? '—'} />
                      <Row label="類型"     value={item.snapshotKind ? <TypeChip kind={item.snapshotKind} /> : '—'} />
                      <Row label="地址"     value={item.snapshotAddress ?? '—'} />
                      <Row label="特約終止日" value={<span className="text-red-600 font-semibold">{formatTermDate(item.snapshotTermDate ?? '')}</span>} />
                    </>
                  )}
                </div>
                <p className="text-xs text-gray-400">建議在客戶頁面確認機構狀態，並更新為「停業」或「歇業」</p>
              </>
            )
          })()}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex justify-end">
          <a
            href={`/customers/${data.item.customerId}`}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-xl text-sm bg-gray-900 text-white font-medium hover:bg-gray-700"
          >
            前往客戶頁面 →
          </a>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-xs text-gray-400 shrink-0 w-24">{label}</span>
      <span className="text-sm text-gray-700 flex-1">{value}</span>
    </div>
  )
}

// ── Import Preview Modal (for 新開業) ──────────────────────────────────────────

function ImportPreviewModal({ selected, onConfirm, onClose }: {
  selected: NewOpening[]; onConfirm: () => void; onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-gray-900">匯入預覽</h2>
            <p className="text-sm text-gray-400 mt-0.5">以下 {selected.length} 筆資料將新增至客戶資料庫</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-2">
          {selected.map((inst, i) => (
            <div key={inst.code} className="flex gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
              <span className="text-xs text-gray-400 shrink-0 w-5 text-right">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-gray-900">{inst.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 font-mono">{inst.code}</span>
                  <TypeChip kind={inst.kind} />
                </div>
                <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-x-2">
                  {inst.city && <span>{inst.city}{inst.district}</span>}
                  {inst.address && <span className="truncate max-w-[300px]">{inst.address}</span>}
                </div>
              </div>
              <div className="shrink-0 text-xs text-emerald-600 font-medium">開業</div>
            </div>
          ))}
        </div>
        <div className="p-5 border-t border-gray-100 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm border border-gray-200 text-gray-600 hover:bg-gray-50">取消</button>
          <button onClick={onConfirm} className="px-5 py-2 rounded-xl text-sm bg-gray-900 text-white font-medium hover:bg-gray-700">
            ✅ 確認新增 {selected.length} 筆
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 新開業 Tab ─────────────────────────────────────────────────────────────────

type NewOpeningFilter = 'all' | 'new' | 'existing'

function NewOpeningsTab({ clinics, labs, hospitals, selectedIds, onToggle, onToggleAll, onImport, importing }: {
  clinics: NewOpening[]; labs: NewOpening[]; hospitals: NewOpening[]
  selectedIds: Set<string>; onToggle: (code: string) => void
  onToggleAll: (items: NewOpening[]) => void; onImport: () => void; importing: boolean
}) {
  const [filter, setFilter] = useState<NewOpeningFilter>('all')

  const allItems          = [...clinics, ...labs, ...hospitals]
  const newThisMonthCount = allItems.filter(i => i.isNewThisMonth).length
  const existingCount     = allItems.length - newThisMonthCount

  const filterFn = (items: NewOpening[]) => {
    if (filter === 'new')      return items.filter(i => i.isNewThisMonth)
    if (filter === 'existing') return items.filter(i => !i.isNewThisMonth)
    return items
  }

  const fClinics   = filterFn(clinics)
  const fLabs      = filterFn(labs)
  const fHospitals = filterFn(hospitals)
  const fAll       = [...fClinics, ...fLabs, ...fHospitals]

  if (allItems.length === 0) return (
    <div className="py-16 text-center text-gray-400 text-sm">
      <div className="text-3xl mb-3">🎉</div>
      <p>沒有找到尚未加入客戶資料庫的牙科單位</p>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1 w-fit">
        {([
          { id: 'all',      label: '全部',      count: allItems.length },
          { id: 'new',      label: '本月新增',   count: newThisMonthCount },
          { id: 'existing', label: '既有未開發', count: existingCount },
        ] as const).map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5 ${filter === f.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {f.label}
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
              filter === f.id
                ? f.id === 'new' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-700'
                : 'bg-white text-gray-500'
            }`}>{f.count}</span>
          </button>
        ))}
      </div>

      {fAll.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-gray-500">已選 <strong>{selectedIds.size}</strong> 筆</span>
          <button onClick={() => onToggleAll(fAll)} className="text-xs text-blue-600 hover:underline">
            {fAll.every(i => selectedIds.has(i.code)) ? '取消全選' : '全選此頁'}
          </button>
          <div className="flex-1" />
          <button onClick={onImport} disabled={selectedIds.size === 0 || importing}
            className="px-4 py-2 rounded-xl text-sm bg-gray-900 text-white font-medium hover:bg-gray-700 disabled:opacity-40">
            {importing ? '匯入中…' : `📥 預覽並匯入（${selectedIds.size}）`}
          </button>
        </div>
      )}

      {fClinics.length > 0 && (
        <CollapsibleSection title="牙醫診所" count={fClinics.length} color="bg-blue-50 text-blue-700">
          <div className="divide-y divide-gray-50">
            {fClinics.map(inst => (
              <NewOpeningRow key={inst.code} inst={inst} selected={selectedIds.has(inst.code)} onToggle={() => onToggle(inst.code)} />
            ))}
          </div>
        </CollapsibleSection>
      )}
      {fLabs.length > 0 && (
        <CollapsibleSection title="牙體技術所" count={fLabs.length} color="bg-violet-50 text-violet-700">
          <div className="divide-y divide-gray-50">
            {fLabs.map(inst => (
              <NewOpeningRow key={inst.code} inst={inst} selected={selectedIds.has(inst.code)} onToggle={() => onToggle(inst.code)} />
            ))}
          </div>
        </CollapsibleSection>
      )}
      {fHospitals.length > 0 && (
        <CollapsibleSection title="有牙科的醫院" count={fHospitals.length} color="bg-orange-50 text-orange-700" defaultOpen={false}>
          <div className="divide-y divide-gray-50">
            {fHospitals.map(inst => (
              <NewOpeningRow key={inst.code} inst={inst} selected={selectedIds.has(inst.code)} onToggle={() => onToggle(inst.code)} />
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  )
}

function NewOpeningRow({ inst, selected, onToggle }: {
  inst: NewOpening; selected: boolean; onToggle: () => void
}) {
  return (
    <div onClick={onToggle}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-gray-50 last:border-0 ${selected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
      <div className={`w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${selected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'}`}>
        {selected && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round"/></svg>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">{inst.name}</span>
          <span className="text-[10px] font-mono text-gray-400">{inst.code}</span>
          <TypeChip kind={inst.kind} />
          {inst.isNewThisMonth && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">本月新增</span>
          )}
        </div>
        <div className="text-xs text-gray-400 flex flex-wrap gap-x-2 mt-0.5">
          {inst.city && <span>{inst.city}{inst.district}</span>}
          {inst.address && <span className="truncate max-w-[40vw]">{inst.address}</span>}
        </div>
      </div>
      <span className="shrink-0 text-xs font-medium text-emerald-600">開業</span>
    </div>
  )
}

// ── 條件 1：已對應客戶 Tab ─────────────────────────────────────────────────────

function MatchedCustomersTab({ items, onOpen }: {
  items: MatchedCustomer[]
  onOpen: (item: MatchedCustomer) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = search.trim()
    ? items.filter(i => i.customerName.includes(search) || i.institutionCode.includes(search) || i.customerCity.includes(search))
    : items

  if (items.length === 0) return (
    <div className="py-12 text-center text-gray-400 text-sm">
      <div className="text-3xl mb-3">📋</div>
      <p>尚無代碼對應到快照的客戶</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="搜尋客戶名稱 / 代碼 / 縣市…"
          className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <span className="text-xs text-gray-400 shrink-0">{filtered.length} / {items.length} 筆</span>
      </div>
      <div className="border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-50">
        {filtered.slice(0, 300).map(item => (
          <button key={item.customerId} onClick={() => onOpen(item)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{item.customerName}</span>
                <span className="text-[10px] font-mono text-gray-400">{item.institutionCode}</span>
                <TypeChip kind={item.snapshotKind} />
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {item.customerCity}{item.customerDistrict && ` ${item.customerDistrict}`}
                {item.snapshotAddress && ` · ${item.snapshotAddress}`}
              </div>
            </div>
            <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
        {filtered.length > 300 && (
          <div className="px-4 py-3 text-xs text-gray-400 text-center">顯示前 300 筆，請搜尋縮小範圍</div>
        )}
      </div>
    </div>
  )
}

// ── 條件 2：建議補代碼 Tab ─────────────────────────────────────────────────────

function SuggestedMatchesTab({ items, onOpen }: {
  items: SuggestedMatch[]
  onOpen: (item: SuggestedMatch) => void
}) {
  if (items.length === 0) return (
    <div className="py-12 text-center text-gray-400 text-sm">
      <div className="text-3xl mb-3">✅</div>
      <p>所有符合條件的客戶都已有機構代碼，或找不到名稱相符的機構</p>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
        💡 以下客戶目前沒有機構代碼，但依名稱在醫事快照中找到相符機構。點擊查看建議後，請至客戶頁面手動填入代碼。
      </div>
      <div className="border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-50">
        {items.map(item => (
          <button key={item.customerId} onClick={() => onOpen(item)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{item.customerName}</span>
                {item.customerType && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{item.customerType}</span>}
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold">
                  {item.suggestions.length} 個候選
                </span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {item.customerCity}{item.customerDistrict && ` ${item.customerDistrict}`}
                {' · 最佳：'}
                <span className="text-gray-600">{item.suggestions[0]?.name}</span>
                <span className="font-mono ml-1 text-gray-400">{item.suggestions[0]?.code}</span>
              </div>
            </div>
            <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── 條件 3：可能歇業 Tab ────────────────────────────────────────────────────────

function ClosureDetailsTab({ clinics, labs, hospitals, onOpen }: {
  clinics: ClosureDetail[]; labs: ClosureDetail[]; hospitals: ClosureDetail[]
  onOpen: (item: ClosureDetail) => void
}) {
  const total = clinics.length + labs.length + hospitals.length
  if (total === 0) return (
    <div className="py-12 text-center text-gray-400 text-sm">
      <div className="text-3xl mb-3">✅</div>
      <p>所有有機構代碼的客戶均在醫事資料中找到，且特約有效</p>
    </div>
  )

  const ClosureRow = ({ item }: { item: ClosureDetail }) => (
    <button onClick={() => onOpen(item)}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">{item.customerName}</span>
          <span className="text-[10px] font-mono text-gray-400">{item.institutionCode}</span>
          {item.customerType && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{item.customerType}</span>}
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
            item.reason === 'nhi_terminated' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
          }`}>
            {item.reason === 'nhi_terminated' ? '特約終止' : '代碼查無'}
          </span>
        </div>
        <div className="text-xs text-gray-400 mt-0.5">
          {item.customerCity}{item.customerDistrict && ` ${item.customerDistrict}`}
          {item.customerStatus && ` · ${item.customerStatus}`}
        </div>
      </div>
      <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
        ⚠️ 以下客戶的機構代碼有異常。「代碼查無」表示快照中找不到此代碼；「特約終止」表示 NHI 特約已過期，診所可能已停業。
      </div>
      {clinics.length > 0 && (
        <CollapsibleSection title="牙醫診所" count={clinics.length} color="bg-orange-50 text-orange-700">
          {clinics.map(item => <ClosureRow key={item.customerId} item={item} />)}
        </CollapsibleSection>
      )}
      {labs.length > 0 && (
        <CollapsibleSection title="牙體技術所" count={labs.length} color="bg-orange-50 text-orange-700">
          {labs.map(item => <ClosureRow key={item.customerId} item={item} />)}
        </CollapsibleSection>
      )}
      {hospitals.length > 0 && (
        <CollapsibleSection title="醫院 / 其他" count={hospitals.length} color="bg-orange-50 text-orange-700" defaultOpen={false}>
          {hospitals.map(item => <ClosureRow key={item.customerId} item={item} />)}
        </CollapsibleSection>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

const CACHE_KEY     = 'clinic-monitor-result-v2'
const CACHE_TAB_KEY = 'clinic-monitor-tab-v1'

type MainTab = 'new' | 'matched' | 'suggested' | 'closure'

export function ClinicMonitorContent({ isAdmin }: { isAdmin?: boolean }) {
  const [tab, setTab]               = useState<MainTab>('new')
  const [result, setResult]         = useState<MonitorResult | null>(null)
  const [cachedAt, setCachedAt]     = useState<string | null>(null)  // ISO 字串
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState('')
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState('')

  // 新開業 匯入
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set())
  const [showPreview, setShowPreview]     = useState(false)
  const [importing, setImporting]         = useState(false)
  const [importResult, setImportResult]   = useState('')

  // 詳細資訊 modal
  const [detailModal, setDetailModal] = useState<DetailModalData | null>(null)

  // ── 從 localStorage 還原上次比對結果 ─────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (!raw) return
      const { data, timestamp } = JSON.parse(raw) as { data: MonitorResult; timestamp: string }
      setResult(data)
      setCachedAt(timestamp)
    } catch {}

    try {
      const savedTab = localStorage.getItem(CACHE_TAB_KEY) as MainTab | null
      if (savedTab) setTab(savedTab)
    } catch {}
  }, [])

  // 記住目前 tab
  useEffect(() => {
    try { localStorage.setItem(CACHE_TAB_KEY, tab) } catch {}
  }, [tab])

  // ── Load ─────────────────────────────────────────────────────────────────────
  async function loadComparison() {
    setLoading(true); setError('')
    setSelectedIds(new Set()); setImportResult('')
    try {
      const res = await fetch('/api/admin/medical-monitor')
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? '比對失敗'); return }
      const now = new Date().toISOString()
      setResult(data)
      setCachedAt(now)
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: now })) } catch {}
    } catch (e: any) {
      setError(e.message ?? '比對失敗，請重試')
    } finally {
      setLoading(false)
    }
  }

  async function triggerDataUpdate() {
    setTriggering(true); setTriggerMsg('')
    try {
      const res = await fetch('/api/clinic-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false }),
      })
      const data = await res.json()
      if (!res.ok) setTriggerMsg(`❌ ${data.error}`)
      else setTriggerMsg('✅ 醫事資料更新已觸發，約 25 分鐘後完成，完成後請再執行比對')
    } catch (e: any) {
      setTriggerMsg(`❌ ${e.message}`)
    } finally {
      setTriggering(false)
    }
  }

  // ── Selection ─────────────────────────────────────────────────────────────────
  function toggleId(code: string) {
    setSelectedIds(prev => { const s = new Set(prev); s.has(code) ? s.delete(code) : s.add(code); return s })
  }
  function toggleAll(items: NewOpening[]) {
    const allSelected = items.every(i => selectedIds.has(i.code))
    setSelectedIds(allSelected ? new Set() : new Set(items.map(i => i.code)))
  }
  const selectedInstitutions = useMemo(() => {
    if (!result) return []
    return [...result.newOpenings.clinics, ...result.newOpenings.labs, ...result.newOpenings.hospitals]
      .filter(i => selectedIds.has(i.code))
  }, [result, selectedIds])

  // ── Import ────────────────────────────────────────────────────────────────────
  async function handleImport() {
    setImporting(true); setImportResult('')
    try {
      const res = await fetch('/api/admin/medical-monitor/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institutions: selectedInstitutions }),
      })
      const data = await res.json()
      if (!res.ok || data.error) { setImportResult(`❌ ${data.error ?? '匯入失敗'}`); return }
      const failDetails = (data.errors ?? []).map((e: any) => e.name).join('、')
      if (data.created === 0) {
        setImportResult(`❌ 全部建立失敗${failDetails ? `（${failDetails}）` : ''}`)
      } else {
        setImportResult(`✅ 已新增 ${data.created} 筆至客戶資料庫` + (data.errors?.length ? `，${data.errors.length} 筆失敗（${failDetails}）` : ''))
        setSelectedIds(new Set()); setShowPreview(false)
      }
    } catch (e: any) {
      setImportResult(`❌ ${e.message}`)
    } finally {
      setImporting(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const stats = result?.stats

  const tabDefs = result ? [
    { id: 'new',      label: '🆕 業務機會',  count: (result.newOpenings.clinics.length + result.newOpenings.labs.length + result.newOpenings.hospitals.length) },
    { id: 'matched',  label: '✅ 已對應客戶', count: result.matchedCustomers.length },
    { id: 'suggested',label: '🔍 建議補代碼', count: result.suggestedMatches.length },
    { id: 'closure',  label: '⚠️ 可能歇業',  count: (result.closureDetails.clinics.length + result.closureDetails.labs.length + result.closureDetails.hospitals.length) },
  ] as const : []

  return (
    <div className="space-y-5">

      {/* Control bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={loadComparison} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors">
          {loading
            ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
          }
          {loading ? '比對中…' : '🔍 執行比對'}
        </button>
        <button onClick={triggerDataUpdate} disabled={triggering}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-300 text-gray-600 text-sm hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          {triggering
            ? <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          }
          更新醫事資料
        </button>
        {cachedAt && (
          <span className="text-xs text-gray-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block shrink-0" title="結果已快取，重新整理不會消失" />
            上次比對：{new Date(cachedAt).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            <button
              onClick={() => {
                try { localStorage.removeItem(CACHE_KEY); localStorage.removeItem(CACHE_TAB_KEY) } catch {}
                setResult(null); setCachedAt(null)
              }}
              className="ml-1 text-gray-300 hover:text-gray-500 transition-colors"
              title="清除快取"
            >✕</button>
          </span>
        )}
        {result && (
          <span className="text-xs text-gray-300">
            快照：{result.snapshotMonth}（{new Date(result.snapshotFetched).toLocaleDateString('zh-TW')} 擷取）
          </span>
        )}
      </div>

      {triggerMsg && (
        <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap">
          {triggerMsg}
          <a href="https://github.com/Songtah/songtah-quote/actions/workflows/clinic-monitor.yml"
            target="_blank" rel="noreferrer"
            className="text-xs text-gray-400 underline hover:text-gray-600 ml-1">查看進度</a>
        </div>
      )}
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>}

      {result && !result.hasSnapshot && (
        <div className="panel px-6 py-16 text-center">
          <div className="text-3xl mb-3">📡</div>
          <p className="text-sm text-gray-600 font-medium">尚無醫事資料快照</p>
          <p className="text-sm text-gray-400 mt-1">請點擊「更新醫事資料」後等待約 25 分鐘，完成後再執行比對</p>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <>
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">全台醫事單位規模</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="牙醫診所"   value={stats.totalClinics}  sub="NHI 特約" />
              {stats.totalLabs > 0
                ? <StatCard label="牙體技術所" value={stats.totalLabs} sub="MOHW BAS" />
                : (
                  <div className="bg-white rounded-2xl border border-amber-200 p-4 flex flex-col gap-1">
                    <span className="text-xs text-gray-400 font-medium">牙體技術所</span>
                    <span className="text-lg font-bold text-amber-500">資料未取得</span>
                    <span className="text-xs text-amber-500">BAS 上次抓取失敗，請點「更新醫事資料」重新執行</span>
                  </div>
                )
              }
              <StatCard label="崧達客戶（有代碼）" value={stats.customerClinics + stats.customerLabs + stats.customerHospitals} />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">比對結果摘要</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="本月新開業"    value={stats.newThisMonthClinics + stats.newThisMonthLabs + stats.newThisMonthHospitals} sub={`診所 ${stats.newThisMonthClinics} ／牙技所 ${stats.newThisMonthLabs}`} accent="text-emerald-600" />
              <StatCard label="既有未開發"    value={(stats.newOpeningClinics + stats.newOpeningLabs + stats.newOpeningHospitals) - (stats.newThisMonthClinics + stats.newThisMonthLabs + stats.newThisMonthHospitals)} sub="在醫事DB但從未成為客戶" accent="text-amber-600" />
              <StatCard label="建議補代碼"    value={stats.suggestedMatchCount} sub="無代碼但名稱可比對" accent="text-blue-600" />
              <StatCard label="可能歇業"      value={stats.closureClinics + stats.closureLabs + stats.closureHospitals} sub={`查無 ${stats.closureClinics + stats.closureLabs + stats.closureHospitals - stats.terminatedClinics - stats.terminatedLabs - stats.terminatedHospitals} ／特約終止 ${stats.terminatedClinics + stats.terminatedLabs + stats.terminatedHospitals}`} accent="text-orange-500" />
            </div>
          </div>
        </>
      )}

      {/* Tabs */}
      {result?.hasSnapshot && (
        <>
          <div className="flex flex-wrap bg-gray-100 rounded-xl p-1 gap-1 w-fit">
            {tabDefs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id as MainTab)}
                className={`px-3 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-1.5 ${tab === t.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                {t.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${tab === t.id ? 'bg-gray-100 text-gray-700' : 'bg-white text-gray-500'}`}>{t.count}</span>
              </button>
            ))}
          </div>

          {importResult && (
            <div className={`text-sm px-4 py-3 rounded-xl border ${importResult.startsWith('❌') ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
              {importResult}
            </div>
          )}

          {tab === 'new' && (
            <NewOpeningsTab
              clinics={result.newOpenings.clinics}
              labs={result.newOpenings.labs}
              hospitals={result.newOpenings.hospitals}
              selectedIds={selectedIds}
              onToggle={toggleId}
              onToggleAll={toggleAll}
              onImport={() => selectedIds.size > 0 && setShowPreview(true)}
              importing={importing}
            />
          )}

          {tab === 'matched' && (
            <MatchedCustomersTab
              items={result.matchedCustomers}
              onOpen={item => setDetailModal({ kind: 'matched', item })}
            />
          )}

          {tab === 'suggested' && (
            <SuggestedMatchesTab
              items={result.suggestedMatches}
              onOpen={item => setDetailModal({ kind: 'suggested', item })}
            />
          )}

          {tab === 'closure' && (
            <ClosureDetailsTab
              clinics={result.closureDetails.clinics}
              labs={result.closureDetails.labs}
              hospitals={result.closureDetails.hospitals}
              onOpen={item => setDetailModal({ kind: 'closure', item })}
            />
          )}
        </>
      )}

      {/* Modals */}
      {showPreview && selectedInstitutions.length > 0 && (
        <ImportPreviewModal
          selected={selectedInstitutions}
          onConfirm={handleImport}
          onClose={() => setShowPreview(false)}
        />
      )}
      {detailModal && (
        <DetailModal data={detailModal} onClose={() => setDetailModal(null)} />
      )}
    </div>
  )
}
