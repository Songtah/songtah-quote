'use client'

/**
 * 活動底下的「預算核銷」分頁：先編預算，再逐筆登記支出（附憑證）→ 送審 → 核准／退回 → 標記已付款。
 * 可做哪些動作由後端回傳的 roles 決定（lib/event-budget-model 的 expenseRoles 與狀態機）。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  BUDGET_CATEGORIES, EXPENSE_TRANSITIONS, EXPENSE_EDITABLE,
  type BudgetItem, type Expense, type BudgetSummary, type ExpenseAction, type ExpenseStatus,
} from '@/lib/event-budget-model'

type Roles = { editor: boolean; approver: boolean; payer: boolean }
const nt = (n: number) => `NT$ ${n.toLocaleString('zh-TW')}`
const fmt = (iso: string) => iso ? new Date(iso).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : ''
const btn2 = 'min-h-11 rounded-full border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 transition-all hover:border-stone-300 hover:bg-stone-50 active:scale-95 disabled:opacity-40'
const btn1 = 'min-h-11 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40'
const small = 'min-h-9 rounded-full border border-stone-200 bg-white px-3.5 text-xs font-medium text-stone-600 transition-all hover:border-stone-300 hover:bg-stone-50 active:scale-95 disabled:opacity-40'
const STATUS_STYLE: Record<ExpenseStatus, string> = {
  '草稿': 'bg-stone-100 text-stone-600', '待審核': 'bg-amber-50 text-amber-700', '已核准': 'bg-emerald-50 text-emerald-700',
  '已退回': 'bg-red-100 text-red-700', '已付款': 'bg-brand-50 text-brand-700',
}

type ItemDraft = { id?: string; category: string; name: string; amount: string; note: string }
type ExpenseDraft = { id?: string; category: string; description: string; amount: string; spentDate: string; payee: string; receiptUrl: string; note: string }
const blankItem = (): ItemDraft => ({ category: BUDGET_CATEGORIES[0], name: '', amount: '', note: '' })
const blankExpense = (): ExpenseDraft => ({ category: BUDGET_CATEGORIES[0], description: '', amount: '', spentDate: '', payee: '', receiptUrl: '', note: '' })

export function EventBudgetPanel({ eventId }: { eventId: string }) {
  const [items, setItems] = useState<BudgetItem[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [summary, setSummary] = useState<BudgetSummary | null>(null)
  const [roles, setRoles] = useState<Roles>({ editor: false, approver: false, payer: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [itemDraft, setItemDraft] = useState<ItemDraft | null>(null)
  const [expDraft, setExpDraft] = useState<ExpenseDraft | null>(null)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/budget`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) { setItems(json.items ?? []); setExpenses(json.expenses ?? []); setSummary(json.summary ?? null); setRoles(json.roles ?? { editor: false, approver: false, payer: false }) }
    else setError(json.error ?? '載入失敗')
    setLoading(false)
  }, [eventId])
  useEffect(() => { load() }, [load])

  async function call(method: string, body: any, query = ''): Promise<boolean> {
    setError('')
    try {
      const res = await fetch(`/api/events/${eventId}/budget${query}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '操作失敗')
      await load()
      return true
    } catch (e: any) { setError(e?.message ?? '操作失敗'); return false }
  }

  async function saveItem() {
    if (!itemDraft) return
    setBusy('item')
    const ok = await call(itemDraft.id ? 'PATCH' : 'POST', { type: 'item', ...itemDraft, amount: Number(itemDraft.amount) || 0 })
    setBusy(''); if (ok) setItemDraft(null)
  }
  async function saveExpense() {
    if (!expDraft) return
    setBusy('expense')
    const ok = await call(expDraft.id ? 'PATCH' : 'POST', { type: 'expense', ...expDraft, amount: Number(expDraft.amount) || 0 })
    setBusy(''); if (ok) setExpDraft(null)
  }
  async function act(e: Expense, action: ExpenseAction) {
    let note = ''
    if (action === 'reject') { note = window.prompt('退回原因（必填）') ?? ''; if (!note.trim()) return }
    if (action === 'pay' && !window.confirm(`確定標記「${e.description}」${nt(e.amount)} 已付款？`)) return
    setBusy(e.id)
    await call('PATCH', { type: 'expense', id: e.id, action, note })
    setBusy('')
  }
  async function uploadReceipt(file: File) {
    setUploading(true); setError('')
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch(`/api/events/${eventId}/budget/receipt`, { method: 'POST', body: fd })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? '上傳失敗')
      setExpDraft((d) => (d ? { ...d, receiptUrl: json.url } : d))
    } catch (e: any) { setError(e?.message ?? '上傳失敗') } finally { setUploading(false) }
  }

  if (loading) return <div className="card-soft py-16 text-center text-sm text-stone-400">載入中…</div>

  const s = summary ?? { budget: 0, spent: 0, pending: 0, draft: 0, remaining: 0, byCategory: [] }
  const over = s.budget > 0 && s.spent > s.budget

  return (
    <div className="space-y-5">
      {error && <p className="rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}

      {/* 總覽 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: '預算', value: nt(s.budget), cls: 'text-stone-800' },
          { label: '已核准支出', value: nt(s.spent), cls: over ? 'text-red-600' : 'text-stone-800' },
          { label: '待審核', value: nt(s.pending), cls: 'text-amber-700' },
          { label: over ? '超支' : '剩餘', value: nt(Math.abs(s.remaining)), cls: over ? 'text-red-600' : 'text-emerald-700' },
        ].map((x) => (
          <div key={x.label} className="card-soft p-4">
            <p className="text-xs text-stone-500">{x.label}</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${x.cls}`}>{x.value}</p>
          </div>
        ))}
      </div>
      <p className="-mt-2 text-xs text-stone-400">已核准支出＝已核准＋已付款。草稿與已退回的 {nt(s.draft)} 還沒算進來。</p>

      {/* 預算 */}
      <div className="card-soft overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-4">
          <h3 className="font-semibold text-stone-900">預算</h3>
          {roles.editor && !itemDraft && <button onClick={() => setItemDraft(blankItem())} className={small}>＋ 新增預算項目</button>}
        </div>
        {itemDraft && (
          <div className="grid gap-3 border-b border-stone-100 bg-cream-50 p-5 sm:grid-cols-4">
            <label className="block text-xs font-medium text-stone-600">類別
              <select className="select-soft mt-1 w-full" value={itemDraft.category} onChange={(e) => setItemDraft({ ...itemDraft, category: e.target.value })}>{BUDGET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <label className="block text-xs font-medium text-stone-600">項目
              <input className="input-soft mt-1 w-full" value={itemDraft.name} maxLength={100} placeholder="例：會議室租金" onChange={(e) => setItemDraft({ ...itemDraft, name: e.target.value })} />
            </label>
            <label className="block text-xs font-medium text-stone-600">預算金額
              <input className="input-soft mt-1 w-full" inputMode="numeric" value={itemDraft.amount} onChange={(e) => setItemDraft({ ...itemDraft, amount: e.target.value.replace(/[^\d]/g, '') })} />
            </label>
            <label className="block text-xs font-medium text-stone-600">備註
              <input className="input-soft mt-1 w-full" value={itemDraft.note} maxLength={300} onChange={(e) => setItemDraft({ ...itemDraft, note: e.target.value })} />
            </label>
            <div className="flex gap-2 sm:col-span-4">
              <button onClick={saveItem} disabled={busy === 'item'} className={btn1}>{busy === 'item' ? '儲存中…' : '儲存'}</button>
              <button onClick={() => setItemDraft(null)} className={btn2}>取消</button>
            </div>
          </div>
        )}
        {items.length === 0 ? (
          <div className="py-10 text-center text-sm text-stone-400">還沒編預算</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-cream-50 text-xs text-stone-500">
              <tr><th className="px-5 py-2.5 text-left font-medium">類別</th><th className="px-5 py-2.5 text-left font-medium">項目</th><th className="px-5 py-2.5 text-right font-medium">預算</th><th className="px-5 py-2.5 text-right font-medium" /></tr>
            </thead>
            <tbody className="divide-y divide-stone-900/[0.06]">
              {items.map((i) => (
                <tr key={i.id} className="transition-colors hover:bg-brand-50/50">
                  <td className="px-5 py-2.5 text-stone-600">{i.category}</td>
                  <td className="px-5 py-2.5 text-stone-800">{i.name || '—'}{i.note && <span className="ml-2 text-xs text-stone-400">{i.note}</span>}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-stone-800">{nt(i.amount)}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-right">
                    {roles.editor && <>
                      <button onClick={() => setItemDraft({ id: i.id, category: i.category, name: i.name, amount: String(i.amount), note: i.note })} className="rounded-full px-2.5 py-1 text-xs text-stone-500 transition-all hover:bg-white hover:text-brand-700 active:scale-95">修改</button>
                      <button onClick={() => { if (window.confirm(`刪除預算項目「${i.name || i.category}」？`)) call('DELETE', null, `?type=item&id=${i.id}`) }} className="rounded-full px-2.5 py-1 text-xs text-stone-400 transition-all hover:bg-white hover:text-red-600 active:scale-95">刪除</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {s.byCategory.length > 0 && (
          <div className="space-y-2 border-t border-stone-100 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-400">各類別預算對支出</p>
            {s.byCategory.map((c) => {
              const pct = c.budget > 0 ? Math.min(Math.round((c.spent / c.budget) * 100), 100) : c.spent > 0 ? 100 : 0
              const catOver = c.spent > c.budget
              return (
                <div key={c.category} className="flex items-center gap-3 text-xs">
                  <span className="w-20 shrink-0 text-stone-600">{c.category}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100"><div className={`h-full rounded-full ${catOver ? 'bg-red-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} /></div>
                  <span className={`w-48 shrink-0 text-right tabular-nums ${catOver ? 'text-red-600' : 'text-stone-500'}`}>{nt(c.spent)} / {nt(c.budget)}{c.pending > 0 ? `（待審 ${nt(c.pending)}）` : ''}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 支出 */}
      <div className="card-soft overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-5 py-4">
          <div>
            <h3 className="font-semibold text-stone-900">支出與請款</h3>
            <p className="mt-0.5 text-xs text-stone-400">登記 → 送審 → 核准 → 付款。只有草稿和已退回可以修改。</p>
          </div>
          {roles.editor && !expDraft && <button onClick={() => setExpDraft(blankExpense())} className={small}>＋ 登記支出</button>}
        </div>
        {expDraft && (
          <div className="grid gap-3 border-b border-stone-100 bg-cream-50 p-5 sm:grid-cols-3">
            <label className="block text-xs font-medium text-stone-600">類別
              <select className="select-soft mt-1 w-full" value={expDraft.category} onChange={(e) => setExpDraft({ ...expDraft, category: e.target.value })}>{BUDGET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <label className="block text-xs font-medium text-stone-600 sm:col-span-2">支出說明
              <input className="input-soft mt-1 w-full" value={expDraft.description} maxLength={200} placeholder="例：12/12 午餐便當 30 份" onChange={(e) => setExpDraft({ ...expDraft, description: e.target.value })} />
            </label>
            <label className="block text-xs font-medium text-stone-600">金額
              <input className="input-soft mt-1 w-full" inputMode="numeric" value={expDraft.amount} onChange={(e) => setExpDraft({ ...expDraft, amount: e.target.value.replace(/[^\d]/g, '') })} />
            </label>
            <label className="block text-xs font-medium text-stone-600">支出日期
              <input type="date" className="input-soft mt-1 w-full" value={expDraft.spentDate} onChange={(e) => setExpDraft({ ...expDraft, spentDate: e.target.value })} />
            </label>
            <label className="block text-xs font-medium text-stone-600">付款對象
              <input className="input-soft mt-1 w-full" value={expDraft.payee} maxLength={100} placeholder="廠商或代墊人" onChange={(e) => setExpDraft({ ...expDraft, payee: e.target.value })} />
            </label>
            <label className="block text-xs font-medium text-stone-600 sm:col-span-2">備註
              <input className="input-soft mt-1 w-full" value={expDraft.note} maxLength={500} onChange={(e) => setExpDraft({ ...expDraft, note: e.target.value })} />
            </label>
            <div className="text-xs font-medium text-stone-600">憑證（發票、收據）
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <label className={`${small} inline-flex cursor-pointer items-center`}>
                  {uploading ? '上傳中…' : expDraft.receiptUrl ? '重新上傳' : '上傳檔案'}
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" disabled={uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadReceipt(f); e.target.value = '' }} />
                </label>
                {expDraft.receiptUrl && <a href={expDraft.receiptUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">查看已上傳的憑證</a>}
              </div>
              <p className="mt-1 font-normal text-stone-400">JPG、PNG、WebP、PDF，4 MB 以內</p>
            </div>
            <div className="flex gap-2 sm:col-span-3">
              <button onClick={saveExpense} disabled={busy === 'expense' || uploading} className={btn1}>{busy === 'expense' ? '儲存中…' : '存成草稿'}</button>
              <button onClick={() => setExpDraft(null)} className={btn2}>取消</button>
            </div>
          </div>
        )}
        {expenses.length === 0 ? (
          <div className="py-10 text-center text-sm text-stone-400">還沒有支出紀錄</div>
        ) : (
          <ul className="divide-y divide-stone-900/[0.06]">
            {expenses.map((e) => {
              const actions = (Object.keys(EXPENSE_TRANSITIONS) as ExpenseAction[]).filter((a) => EXPENSE_TRANSITIONS[a].from.includes(e.status) && roles[EXPENSE_TRANSITIONS[a].actor])
              const editable = roles.editor && EXPENSE_EDITABLE.includes(e.status)
              return (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 transition-colors hover:bg-brand-50/50">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[e.status]}`}>{e.status}</span>
                      <span className="text-sm font-medium text-stone-800">{e.description}</span>
                      <span className="text-xs text-stone-400">{e.category}</span>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">
                      {[e.spentDate, e.payee && `付款對象 ${e.payee}`, e.createdBy && `登記 ${e.createdBy}`].filter(Boolean).join('・')}
                      {e.receiptUrl && <> ・<a href={e.receiptUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">憑證</a></>}
                    </p>
                    {e.note && <p className="mt-0.5 text-xs text-stone-400">{e.note}</p>}
                    {e.reviewedBy && <p className={`mt-0.5 text-xs ${e.status === '已退回' ? 'text-red-600' : 'text-stone-400'}`}>{e.status === '已退回' ? '退回' : '核准'}：{e.reviewedBy} {fmt(e.reviewedAt)}{e.reviewNote ? `・${e.reviewNote}` : ''}</p>}
                    {e.paidBy && <p className="mt-0.5 text-xs text-stone-400">付款：{e.paidBy} {fmt(e.paidAt)}</p>}
                    {!e.receiptUrl && e.status !== '草稿' && <p className="mt-0.5 text-xs text-amber-700">沒有附憑證</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="text-base font-semibold tabular-nums text-stone-800">{nt(e.amount)}</span>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {actions.map((a) => (
                        <button key={a} onClick={() => act(e, a)} disabled={busy === e.id}
                          className={a === 'approve' || a === 'pay' || a === 'submit' ? 'min-h-9 rounded-full bg-brand-500 px-3.5 text-xs font-semibold text-white transition-all hover:bg-brand-600 active:scale-95 disabled:opacity-40' : small}>
                          {EXPENSE_TRANSITIONS[a].label}
                        </button>
                      ))}
                      {editable && <button onClick={() => setExpDraft({ id: e.id, category: e.category, description: e.description, amount: String(e.amount), spentDate: e.spentDate, payee: e.payee, receiptUrl: e.receiptUrl, note: e.note })} className={small}>修改</button>}
                      {roles.editor && e.status === '草稿' && <button onClick={() => { if (window.confirm(`刪除草稿「${e.description}」？`)) call('DELETE', null, `?type=expense&id=${e.id}`) }} className={small}>刪除</button>}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {!roles.approver && expenses.some((e) => e.status === '待審核') && <p className="text-xs text-stone-400">待審核的支出由中央管理、總經理或財務核准。</p>}
    </div>
  )
}
