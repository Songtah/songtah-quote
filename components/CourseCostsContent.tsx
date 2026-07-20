'use client'

import { useEffect, useState } from 'react'
import type { CourseCost } from '@/lib/system-notion'

const STATUS_OPTIONS = ['規劃中', '已確認', '已結算']
const STATUS_STYLE: Record<string, string> = {
  '規劃中': 'bg-gray-100 text-gray-600',
  '已確認': 'bg-blue-100 text-blue-700',
  '已結算': 'bg-green-100 text-green-700',
}

const fmt = (n: number) => n ? n.toLocaleString('zh-TW') : '—'
const fmtPct = (n: number) => n ? `${n.toFixed(1)}%` : '—'

type FormState = {
  name: string
  venueFee: string; speakerFee: string; materialFee: string
  marketingFee: string; cateringFee: string; transportFee: string; otherFee: string
  feePerPerson: string; headcount: string
  status: string; note: string; eventId: string
}
const EMPTY: FormState = {
  name: '', venueFee: '', speakerFee: '', materialFee: '',
  marketingFee: '', cateringFee: '', transportFee: '', otherFee: '',
  feePerPerson: '', headcount: '', status: '規劃中', note: '', eventId: '',
}

function toNum(s: string) { return parseFloat(s) || 0 }

export function CourseCostsContent() {
  const [items, setItems] = useState<CourseCost[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [filterStatus, setFilterStatus] = useState('全部')
  const [eventOptions, setEventOptions] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    fetch('/api/course-costs').then(r => r.json())
      .then(d => { setItems(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
    fetch('/api/events?limit=100').then(r => r.json())
      .then(d => { if (Array.isArray(d?.items)) setEventOptions(d.items.map((e: any) => ({ id: e.id, name: e.name }))) })
      .catch(() => {})
  }, [])

  function openCreate() { setForm(EMPTY); setEditId(null); setShowForm(true) }
  function openEdit(item: CourseCost) {
    setForm({
      name: item.name, note: item.note, status: item.status, eventId: item.eventId ?? '',
      venueFee: item.venueFee ? String(item.venueFee) : '',
      speakerFee: item.speakerFee ? String(item.speakerFee) : '',
      materialFee: item.materialFee ? String(item.materialFee) : '',
      marketingFee: item.marketingFee ? String(item.marketingFee) : '',
      cateringFee: item.cateringFee ? String(item.cateringFee) : '',
      transportFee: item.transportFee ? String(item.transportFee) : '',
      otherFee: item.otherFee ? String(item.otherFee) : '',
      feePerPerson: item.feePerPerson ? String(item.feePerPerson) : '',
      headcount: item.headcount ? String(item.headcount) : '',
    })
    setEditId(item.id); setShowForm(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name) return
    setSaving(true)
    const payload = {
      name: form.name, status: form.status, note: form.note, eventId: form.eventId || undefined,
      venueFee: toNum(form.venueFee), speakerFee: toNum(form.speakerFee),
      materialFee: toNum(form.materialFee), marketingFee: toNum(form.marketingFee),
      cateringFee: toNum(form.cateringFee), transportFee: toNum(form.transportFee),
      otherFee: toNum(form.otherFee),
      feePerPerson: toNum(form.feePerPerson), headcount: toNum(form.headcount),
    }
    if (editId) {
      await fetch(`/api/course-costs/${editId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setItems(prev => prev.map(i => i.id === editId ? {
        ...i, ...payload,
        totalCost: payload.venueFee + payload.speakerFee + payload.materialFee + payload.marketingFee + payload.cateringFee + payload.transportFee + payload.otherFee,
        totalRevenue: payload.feePerPerson * payload.headcount,
        netProfit: payload.feePerPerson * payload.headcount - (payload.venueFee + payload.speakerFee + payload.materialFee + payload.marketingFee + payload.cateringFee + payload.transportFee + payload.otherFee),
        marginPct: payload.feePerPerson * payload.headcount > 0
          ? Math.round((payload.feePerPerson * payload.headcount - (payload.venueFee + payload.speakerFee + payload.materialFee + payload.marketingFee + payload.cateringFee + payload.transportFee + payload.otherFee)) / (payload.feePerPerson * payload.headcount) * 10000) / 100
          : 0,
      } : i))
    } else {
      const res = await fetch('/api/course-costs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) { const created = await res.json(); setItems(prev => [created, ...prev]) }
    }
    setSaving(false); setShowForm(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('確定要刪除這筆成本紀錄？')) return
    await fetch(`/api/course-costs/${id}`, { method: 'DELETE' })
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const filtered = filterStatus === '全部' ? items : items.filter(i => i.status === filterStatus)
  const totalNetProfit = filtered.reduce((s, i) => s + (i.netProfit || 0), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 flex-wrap">
          {['全部', ...STATUS_OPTIONS].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${filterStatus === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {s}
            </button>
          ))}
        </div>
        <button onClick={openCreate} className="button-primary">+ 新增成本試算</button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '試算筆數', value: filtered.length, fmt: (v: number) => String(v), color: 'text-gray-900' },
          { label: '總成本合計', value: filtered.reduce((s,i) => s + (i.totalCost||0), 0), fmt: (v: number) => `$${v.toLocaleString()}`, color: 'text-red-600' },
          { label: '總收入合計', value: filtered.reduce((s,i) => s + (i.totalRevenue||0), 0), fmt: (v: number) => `$${v.toLocaleString()}`, color: 'text-blue-600' },
          { label: '淨利合計', value: totalNetProfit, fmt: (v: number) => `$${v.toLocaleString()}`, color: totalNetProfit >= 0 ? 'text-green-600' : 'text-red-600' },
        ].map(c => (
          <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
            <p className={`text-2xl font-bold ${c.color}`}>{c.fmt(c.value)}</p>
            <p className="text-xs text-gray-500 mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-16 text-center text-gray-400">載入中…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center text-gray-400">
          尚無資料，點擊「新增成本試算」開始建立
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">課程名稱</th>
                  <th className="px-4 py-3 text-right font-medium">總成本</th>
                  <th className="px-4 py-3 text-right font-medium">總收入</th>
                  <th className="px-4 py-3 text-right font-medium">淨利</th>
                  <th className="px-4 py-3 text-right font-medium">利潤率</th>
                  <th className="px-4 py-3 text-center font-medium">狀態</th>
                  <th className="px-4 py-3 text-left font-medium">備註</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{item.totalCost ? `$${item.totalCost.toLocaleString()}` : '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{item.totalRevenue ? `$${item.totalRevenue.toLocaleString()}` : '—'}</td>
                    <td className={`px-4 py-3 text-right font-medium ${(item.netProfit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {item.netProfit ? `$${item.netProfit.toLocaleString()}` : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${(item.marginPct || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {fmtPct(item.marginPct)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[item.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{item.note || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => openEdit(item)} className="text-xs text-blue-600 hover:underline">編輯</button>
                        <button onClick={() => handleDelete(item.id)} className="text-xs text-red-500 hover:underline">刪除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <form onSubmit={handleSave} className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{editId ? '編輯成本試算' : '新增成本試算'}</h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            <div>
              <label className="label">課程名稱 *</label>
              <input className="input w-full" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例：Modifier 種子講師訓練" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">狀態</label>
                <select className="input w-full" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUS_OPTIONS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-1">支出費用</p>
            <div className="grid grid-cols-2 gap-3">
              {([['場地費', 'venueFee'], ['講師費', 'speakerFee'], ['教材費', 'materialFee'], ['行銷費', 'marketingFee'], ['餐飲費', 'cateringFee'], ['交通費', 'transportFee'], ['其他費用', 'otherFee']] as [string, keyof FormState][]).map(([label, key]) => (
                <div key={key}>
                  <label className="label">{label}</label>
                  <input type="number" className="input w-full" min="0" value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder="0" />
                </div>
              ))}
            </div>

            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide pt-1">收入估算</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">報名費 / 人</label>
                <input type="number" className="input w-full" min="0" value={form.feePerPerson} onChange={e => setForm(f => ({ ...f, feePerPerson: e.target.value }))} placeholder="0" />
              </div>
              <div><label className="label">預計人數</label>
                <input type="number" className="input w-full" min="0" value={form.headcount} onChange={e => setForm(f => ({ ...f, headcount: e.target.value }))} placeholder="0" />
              </div>
            </div>

            {/* Live preview */}
            {(form.venueFee || form.speakerFee || form.materialFee || form.feePerPerson || form.headcount) && (() => {
              const cost = toNum(form.venueFee) + toNum(form.speakerFee) + toNum(form.materialFee) + toNum(form.marketingFee) + toNum(form.cateringFee) + toNum(form.transportFee) + toNum(form.otherFee)
              const rev = toNum(form.feePerPerson) * toNum(form.headcount)
              const net = rev - cost
              const pct = rev > 0 ? (net / rev * 100).toFixed(1) : null
              return (
                <div className="rounded-lg bg-gray-50 p-3 text-sm grid grid-cols-3 gap-2 text-center">
                  <div><p className="text-xs text-gray-400">總成本</p><p className="font-semibold text-red-600">${cost.toLocaleString()}</p></div>
                  <div><p className="text-xs text-gray-400">總收入</p><p className="font-semibold text-blue-600">${rev.toLocaleString()}</p></div>
                  <div><p className="text-xs text-gray-400">淨利</p><p className={`font-semibold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>${net.toLocaleString()}{pct && ` (${pct}%)`}</p></div>
                </div>
              )
            })()}

            <div><label className="label">關聯活動（選填）</label>
              <select className="input w-full" value={form.eventId} onChange={e => setForm(f => ({ ...f, eventId: e.target.value }))}>
                <option value="">— 不關聯 —</option>
                {eventOptions.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">關聯後，活動詳情頁會顯示這筆成本試算</p>
            </div>

            <div><label className="label">備註</label>
              <textarea className="input w-full" rows={2} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="button-secondary">取消</button>
              <button type="submit" disabled={saving} className="button-primary">{saving ? '儲存中…' : editId ? '儲存' : '建立'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
