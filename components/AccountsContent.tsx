'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SystemUser, UserPermissions, ModuleKey } from '@/lib/system-notion'
import { MODULE_KEYS, MODULE_LABELS } from '@/lib/system-notion'

const ACCOUNT_TYPE_OPTIONS = ['中央管理', '業務', '行政', '技術']
const STATUS_OPTIONS = ['啟用', '停用']

function defaultPermissions(all = false): UserPermissions {
  const result = {} as UserPermissions
  for (const mod of MODULE_KEYS) result[mod] = { view: all, edit: false }
  return result
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {label}
    </span>
  )
}

function accountTypeBadge(type: string) {
  const map: Record<string, string> = {
    中央管理: 'bg-slate-900 text-white',
    業務: 'bg-emerald-100 text-emerald-800',
    行政: 'bg-blue-100 text-blue-800',
    技術: 'bg-purple-100 text-purple-800',
  }
  return map[type] ?? 'bg-gray-100 text-gray-600'
}

// ── Permission Grid ──────────────────────────────────────────

function PermissionGrid({
  permissions,
  onChange,
  disabled,
}: {
  permissions: UserPermissions
  onChange: (updated: UserPermissions) => void
  disabled?: boolean
}) {
  const toggle = (mod: ModuleKey, type: 'view' | 'edit') => {
    const next = { ...permissions, [mod]: { ...permissions[mod], [type]: !permissions[mod][type] } }
    // If disabling view, also disable edit
    if (type === 'view' && !next[mod].view) next[mod].edit = false
    // If enabling edit, also enable view
    if (type === 'edit' && next[mod].edit) next[mod].view = true
    onChange(next)
  }

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-xs text-gray-500">
            <th className="px-4 py-2 text-left font-medium">模組</th>
            <th className="px-4 py-2 text-center font-medium w-20">檢視</th>
            <th className="px-4 py-2 text-center font-medium w-20">編輯</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {MODULE_KEYS.map((mod) => (
            <tr key={mod} className="hover:bg-gray-50/50">
              <td className="px-4 py-2.5 font-medium text-gray-700">{MODULE_LABELS[mod]}</td>
              <td className="px-4 py-2.5 text-center">
                <input
                  type="checkbox"
                  checked={permissions[mod]?.view ?? false}
                  onChange={() => toggle(mod, 'view')}
                  disabled={disabled}
                  className="h-4 w-4 rounded accent-green-700 cursor-pointer disabled:cursor-default"
                />
              </td>
              <td className="px-4 py-2.5 text-center">
                <input
                  type="checkbox"
                  checked={permissions[mod]?.edit ?? false}
                  onChange={() => toggle(mod, 'edit')}
                  disabled={disabled}
                  className="h-4 w-4 rounded accent-green-700 cursor-pointer disabled:cursor-default"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Account Modal (create / edit) ────────────────────────────

function AccountModal({
  initialData,
  onClose,
  onSaved,
}: {
  initialData?: SystemUser
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!initialData
  const [form, setForm] = useState({
    name: initialData?.name ?? '',
    username: initialData?.username ?? '',
    password: '',
    accountType: initialData?.accountType ?? '業務',
    status: initialData?.status ?? '啟用',
    permissions: initialData?.permissions ?? defaultPermissions(),
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setError('請填寫帳號名稱'); return }
    if (!form.username.trim()) { setError('請填寫帳號代碼'); return }
    if (!isEdit && !form.password.trim()) { setError('請設定密碼'); return }

    setSubmitting(true)
    setError('')
    try {
      const payload: Record<string, any> = {
        name: form.name,
        username: form.username,
        accountType: form.accountType,
        status: form.status,
        permissions: form.permissions,
      }
      if (form.password) payload.password = form.password

      const res = isEdit
        ? await fetch(`/api/accounts/${initialData!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/accounts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })

      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? (isEdit ? '更新失敗' : '建立失敗'))
        return
      }
      onSaved()
    } catch {
      setError('網路錯誤，請重試')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">{isEdit ? '編輯帳號' : '新增帳號'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">帳號名稱 *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="顯示名稱"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">帳號代碼 * <span className="text-gray-400">（登入用）</span></label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="login ID"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                {isEdit ? '新密碼（留空不更改）' : '密碼 *'}
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={isEdit ? '留空則不修改' : '設定登入密碼'}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">帳號類型</label>
              <select
                value={form.accountType}
                onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 bg-white"
              >
                {ACCOUNT_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">狀態</label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 bg-white"
            >
              {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-2">頁面權限</label>
            <PermissionGrid
              permissions={form.permissions}
              onChange={(permissions) => setForm((f) => ({ ...f, permissions }))}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 bg-green-800 hover:bg-green-900 text-white py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-50"
            >
              {submitting ? (isEdit ? '儲存中…' : '建立中…') : (isEdit ? '儲存變更' : '建立帳號')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition"
            >
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────

export default function AccountsContent() {
  const [users, setUsers] = useState<SystemUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingUser, setEditingUser] = useState<SystemUser | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadUsers = useCallback(() => {
    setLoading(true)
    fetch('/api/accounts')
      .then((r) => r.json())
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  const handleDelete = async (id: string) => {
    setDeleting(true)
    try {
      await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
      setDeleteConfirmId(null)
      loadUsers()
    } finally {
      setDeleting(false)
    }
  }

  // Stats
  const counts = {
    admin: users.filter((u) => u.accountType === '中央管理').length,
    sales: users.filter((u) => u.accountType === '業務').length,
    ops: users.filter((u) => u.accountType === '行政').length,
    tech: users.filter((u) => u.accountType === '技術').length,
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: '中央管理', count: counts.admin },
          { label: '業務帳號', count: counts.sales },
          { label: '行政帳號', count: counts.ops },
          { label: '技術帳號', count: counts.tech },
        ].map(({ label, count }) => (
          <div key={label} className="rounded-[24px] border border-slate-200 bg-white p-5">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="mt-2 text-3xl font-black text-slate-900">{count}</div>
          </div>
        ))}
      </div>

      {/* Table header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">帳號清單</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-green-800 hover:bg-green-900 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
        >
          + 新增帳號
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">載入中…</div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400 border-2 border-dashed border-gray-200 rounded-2xl m-4">
            尚無帳號資料。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-400 text-xs border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 text-left">帳號名稱</th>
                  <th className="px-4 py-3 text-left">帳號代碼</th>
                  <th className="px-4 py-3 text-left">帳號類型</th>
                  <th className="px-4 py-3 text-left">狀態</th>
                  <th className="px-4 py-3 text-left">可檢視頁面</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map((u) => {
                  const viewableModules = MODULE_KEYS.filter((m) => u.permissions[m]?.view)
                  const editableModules = MODULE_KEYS.filter((m) => u.permissions[m]?.edit)

                  return (
                    <tr key={u.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-800">{u.name}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{u.username || '—'}</td>
                      <td className="px-4 py-3">
                        <Badge label={u.accountType || '—'} color={accountTypeBadge(u.accountType)} />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${u.status === '停用' ? 'text-red-500' : 'text-green-700'}`}>
                          {u.status || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {viewableModules.length === 0 ? (
                            <span className="text-xs text-gray-400">無</span>
                          ) : (
                            viewableModules.map((m) => (
                              <span
                                key={m}
                                className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                  editableModules.includes(m)
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-gray-100 text-gray-600'
                                }`}
                                title={editableModules.includes(m) ? '可檢視＋編輯' : '僅檢視'}
                              >
                                {MODULE_LABELS[m]}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {deleteConfirmId === u.id ? (
                          <div className="flex items-center gap-2 justify-end">
                            <span className="text-xs text-gray-500">確認刪除？</span>
                            <button
                              onClick={() => handleDelete(u.id)}
                              disabled={deleting}
                              className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                            >
                              {deleting ? '…' : '確認'}
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="text-xs text-gray-400 hover:text-gray-600"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 justify-end">
                            <button
                              onClick={() => { setEditingUser(u); setDeleteConfirmId(null) }}
                              className="text-xs text-gray-400 hover:text-blue-600 transition-colors"
                            >
                              編輯
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(u.id)}
                              className="text-xs text-gray-300 hover:text-red-500 transition-colors"
                            >
                              刪除
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreate && (
        <AccountModal
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); loadUsers() }}
        />
      )}
      {editingUser && (
        <AccountModal
          initialData={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={() => { setEditingUser(null); loadUsers() }}
        />
      )}
    </div>
  )
}
