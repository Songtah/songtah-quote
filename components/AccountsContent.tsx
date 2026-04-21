'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { SystemUser, UserPermissions, ModuleKey } from '@/lib/system-notion'
import { MODULE_KEYS, MODULE_LABELS } from '@/lib/system-notion'

const ACCOUNT_TYPE_OPTIONS = ['中央管理', '業務', '行政', '技術']
const STATUS_OPTIONS = ['未開始', '進行中', '完成']

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

function statusTextClass(status: string) {
  if (status === '完成' || status === '停用') return 'text-red-500'
  if (status === '未開始') return 'text-amber-600'
  return 'text-green-700'
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
    if (type === 'view' && !next[mod].view) next[mod].edit = false
    if (type === 'edit' && next[mod].edit) next[mod].view = true
    onChange(next)
  }

  return (
    <div className="rounded-xl border border-brand-200/40 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-cream-50 text-xs text-stone-500">
            <th className="px-4 py-2 text-left font-medium">模組</th>
            <th className="px-4 py-2 text-center font-medium w-20">檢視</th>
            <th className="px-4 py-2 text-center font-medium w-20">編輯</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-100/30">
          {MODULE_KEYS.map((mod) => (
            <tr key={mod} className="hover:bg-cream-50/50">
              <td className="px-4 py-2.5 font-medium text-stone-700">{MODULE_LABELS[mod]}</td>
              <td className="px-4 py-2.5 text-center">
                <input
                  type="checkbox"
                  checked={permissions[mod]?.view ?? false}
                  onChange={() => toggle(mod, 'view')}
                  disabled={disabled}
                  className="h-4 w-4 rounded accent-brand-500 cursor-pointer disabled:cursor-default"
                />
              </td>
              <td className="px-4 py-2.5 text-center">
                <input
                  type="checkbox"
                  checked={permissions[mod]?.edit ?? false}
                  onChange={() => toggle(mod, 'edit')}
                  disabled={disabled}
                  className="h-4 w-4 rounded accent-brand-500 cursor-pointer disabled:cursor-default"
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
  const [visible, setVisible] = useState(true)
  const [form, setForm] = useState({
    name: initialData?.name ?? '',
    username: initialData?.username ?? '',
    password: '',
    accountType: initialData?.accountType ?? '業務',
    status: initialData?.status ?? '未開始',
    permissions: initialData?.permissions ?? defaultPermissions(),
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const statusOptions = Array.from(new Set([form.status, ...STATUS_OPTIONS].filter(Boolean)))

  const handleClose = () => {
    setVisible(false)
    setTimeout(onClose, 220)
  }

  // Body scroll lock
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

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

  const inputCls = 'w-full border border-brand-200/60 bg-cream-50/50 rounded-xl px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-brand-400 transition'

  return (
    <AnimatePresence>
      {visible && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-stone-900/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
          />

          {/* Scroll container */}
          <motion.div
            className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 overflow-y-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Modal panel */}
            <motion.div
              className="relative w-full max-w-lg"
              initial={{ opacity: 0, y: 32, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <div className="panel overflow-hidden">
                {/* Header */}
                <div className="px-6 py-5 border-b border-brand-100/60 flex items-center justify-between">
                  <div>
                    <p className="eyebrow mb-1">帳號管理</p>
                    <h3 className="text-lg font-bold text-stone-800">
                      {isEdit ? '編輯帳號' : '新增帳號'}
                    </h3>
                  </div>
                  <button
                    onClick={handleClose}
                    className="w-8 h-8 flex items-center justify-center rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition text-lg leading-none"
                  >
                    ✕
                  </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="px-6 py-5 max-h-[72vh] overflow-y-auto space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">帳號名稱 *</label>
                      <input
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="顯示名稱"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">
                        帳號代碼 * <span className="text-stone-400">（登入用）</span>
                      </label>
                      <input
                        type="text"
                        value={form.username}
                        onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                        placeholder="login ID"
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">
                        {isEdit ? '新密碼（留空不更改）' : '密碼 *'}
                      </label>
                      <input
                        type="password"
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        placeholder={isEdit ? '留空則不修改' : '設定登入密碼'}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-stone-500 mb-1.5">帳號類型</label>
                      <select
                        value={form.accountType}
                        onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value }))}
                        className={inputCls}
                      >
                        {ACCOUNT_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-1.5">狀態</label>
                    <select
                      value={form.status}
                      onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                      className={inputCls}
                    >
                      {statusOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-500 mb-2">頁面權限</label>
                    <PermissionGrid
                      permissions={form.permissions}
                      onChange={(permissions) => setForm((f) => ({ ...f, permissions }))}
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>
                  )}

                  <div className="flex gap-3 pt-2 border-t border-brand-100/40">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="button-primary flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
                    >
                      {submitting ? (isEdit ? '儲存中…' : '建立中…') : (isEdit ? '儲存變更' : '建立帳號')}
                    </button>
                    <button
                      type="button"
                      onClick={handleClose}
                      className="button-secondary px-5 py-2.5 rounded-xl text-sm"
                    >
                      取消
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
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
          <div key={label} className="panel p-5">
            <div className="eyebrow mb-2">{label}</div>
            <div className="text-3xl font-black text-slate-900">{count}</div>
          </div>
        ))}
      </div>

      {/* Table header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-800">帳號清單</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="button-primary px-4 py-2 rounded-full text-sm font-medium"
        >
          + 新增帳號
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-brand-200/40 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-stone-400">載入中…</div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center text-sm text-stone-400 border-2 border-dashed border-brand-200/40 rounded-2xl m-4">
            尚無帳號資料。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cream-50 text-stone-400 text-xs border-b border-brand-100/40">
                <tr>
                  <th className="px-4 py-3 text-left">帳號名稱</th>
                  <th className="px-4 py-3 text-left">帳號代碼</th>
                  <th className="px-4 py-3 text-left">帳號類型</th>
                  <th className="px-4 py-3 text-left">狀態</th>
                  <th className="px-4 py-3 text-left">可檢視頁面</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100/30">
                {users.map((u) => {
                  const viewableModules = MODULE_KEYS.filter((m) => u.permissions[m]?.view)
                  const editableModules = MODULE_KEYS.filter((m) => u.permissions[m]?.edit)

                  return (
                    <tr key={u.id} className="hover:bg-cream-50/60 transition-colors">
                      <td className="px-4 py-3 font-medium text-stone-800">{u.name}</td>
                      <td className="px-4 py-3 text-stone-500 font-mono text-xs">{u.username || '—'}</td>
                      <td className="px-4 py-3">
                        <Badge label={u.accountType || '—'} color={accountTypeBadge(u.accountType)} />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${statusTextClass(u.status)}`}>
                          {u.status || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {viewableModules.length === 0 ? (
                            <span className="text-xs text-stone-400">無</span>
                          ) : (
                            viewableModules.map((m) => (
                              <span
                                key={m}
                                className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                  editableModules.includes(m)
                                    ? 'bg-brand-100 text-brand-800'
                                    : 'bg-stone-100 text-stone-600'
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
                            <span className="text-xs text-stone-500">確認刪除？</span>
                            <button
                              onClick={() => handleDelete(u.id)}
                              disabled={deleting}
                              className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                            >
                              {deleting ? '…' : '確認'}
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="text-xs text-stone-400 hover:text-stone-600"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 justify-end">
                            <button
                              onClick={() => { setEditingUser(u); setDeleteConfirmId(null) }}
                              className="text-xs text-stone-400 hover:text-brand-600 transition-colors"
                            >
                              編輯
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(u.id)}
                              className="text-xs text-stone-300 hover:text-red-500 transition-colors"
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
