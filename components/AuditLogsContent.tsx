'use client'

import { useEffect, useMemo, useState } from 'react'
import type { AuditLogRow } from '@/lib/audit'

function formatDateTime(value: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

const MODULE_LABEL: Record<string, string> = {
  auth:       '登入',
  navigation: '頁面瀏覽',
  crm:        'CRM',
  rma:        'RMA',
  accounts:   '帳號',
  quote:      '報價',
  bd:         'BD',
}

const ACTION_LABEL: Record<string, { label: string; cls: string }> = {
  login:  { label: '登入', cls: 'bg-blue-100 text-blue-700' },
  logout: { label: '登出', cls: 'bg-slate-100 text-slate-600' },
  view:   { label: '瀏覽', cls: 'bg-stone-100 text-stone-500' },
  create: { label: '新增', cls: 'bg-brand-100 text-brand-700' },
  update: { label: '修改', cls: 'bg-amber-100 text-amber-700' },
  delete: { label: '刪除', cls: 'bg-red-100 text-red-600' },
}

export default function AuditLogsContent() {
  const [logs, setLogs] = useState<AuditLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [moduleFilter, setModuleFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')

  useEffect(() => {
    setLoading(true)
    setError('')
    fetch('/api/audit-logs')
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? '讀取失敗')
        setLogs(Array.isArray(data) ? data : [])
      })
      .catch((err: Error) => setError(err.message || '讀取失敗'))
      .finally(() => setLoading(false))
  }, [])

  const moduleOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.module).filter(Boolean))),
    [logs]
  )
  const actionOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.action).filter(Boolean))),
    [logs]
  )

  const filteredLogs = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return logs.filter((log) => {
      if (moduleFilter && log.module !== moduleFilter) return false
      if (actionFilter && log.action !== actionFilter) return false
      if (!keyword) return true
      return [log.summary, log.entityTitle, log.actorName, log.path, log.module, log.action]
        .join(' ').toLowerCase().includes(keyword)
    })
  }, [logs, query, moduleFilter, actionFilter])

  const inputCls = 'w-full rounded-xl border border-brand-200/60 bg-cream-50/50 px-3 py-2 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-400 transition'

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="panel p-4">
        <div className="grid gap-3 md:grid-cols-[1.5fr_0.7fr_0.7fr]">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋摘要、操作者、實體名稱…"
            className={inputCls}
          />
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className={inputCls}
          >
            <option value="">全部模組</option>
            {moduleOptions.map((o) => (
              <option key={o} value={o}>{MODULE_LABEL[o] ?? o}</option>
            ))}
          </select>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className={inputCls}
          >
            <option value="">全部操作</option>
            {actionOptions.map((o) => (
              <option key={o} value={o}>{ACTION_LABEL[o]?.label ?? o}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats */}
      {!loading && !error && logs.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-stone-400 px-1">
          <span>共 <strong className="text-stone-700">{logs.length}</strong> 筆紀錄</span>
          {filteredLogs.length !== logs.length && (
            <span>・篩選後 <strong className="text-brand-600">{filteredLogs.length}</strong> 筆</span>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-brand-200/40 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-sm text-stone-400">載入操作紀錄中…</div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-red-500 bg-red-50 rounded-2xl m-4">{error}</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-10 text-center text-sm text-stone-400">
            {query || moduleFilter || actionFilter ? '沒有符合條件的操作紀錄。' : '尚無操作紀錄。'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cream-50 text-xs text-stone-500 border-b border-brand-100/40">
                <tr>
                  <th className="px-4 py-3 text-left whitespace-nowrap">時間</th>
                  <th className="px-4 py-3 text-left">模組</th>
                  <th className="px-4 py-3 text-left">操作</th>
                  <th className="px-4 py-3 text-left">摘要</th>
                  <th className="px-4 py-3 text-left">操作者</th>
                  <th className="px-4 py-3 text-right">詳情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100/30">
                {filteredLogs.map((log) => {
                  const actionMeta = ACTION_LABEL[log.action]
                  return (
                    <tr key={log.id} className="hover:bg-cream-50/60 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-stone-500 text-xs">
                        {formatDateTime(log.occurredAt)}
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        {MODULE_LABEL[log.module] ?? log.module || '—'}
                      </td>
                      <td className="px-4 py-3">
                        {actionMeta ? (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${actionMeta.cls}`}>
                            {actionMeta.label}
                          </span>
                        ) : (
                          <span className="text-stone-500">{log.action || '—'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 min-w-[280px] text-stone-800 font-medium">
                        {log.summary || '—'}
                      </td>
                      <td className="px-4 py-3 text-stone-600">
                        {log.actorName || '—'}
                        {log.actorRole ? (
                          <span className="ml-2 text-xs text-stone-400">（{log.actorRole}）</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {log.url ? (
                          <a
                            href={log.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-semibold text-brand-600 hover:text-brand-800 transition-colors"
                          >
                            Notion ↗
                          </a>
                        ) : (
                          <span className="text-xs text-stone-300">—</span>
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
    </div>
  )
}
