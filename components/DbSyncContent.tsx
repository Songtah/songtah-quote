'use client'

import { useEffect, useState } from 'react'
import type { SyncStatus } from '@/lib/db/sync-notion'

type Resp = ({ configured: true } & SyncStatus) | { configured: false } | { configured: true; error: string }

function fmt(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}

export default function DbSyncContent() {
  const [data, setData] = useState<Resp | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    fetch('/api/settings/db-sync').then((r) => r.json()).then(setData).catch(() => setFailed(true))
  }, [])

  if (failed) return <div className="card-soft p-6 text-sm text-stone-600">讀取失敗，請重新整理。</div>
  if (!data) return <div className="card-soft p-6 text-sm text-stone-500">載入中…</div>
  if (!data.configured) return <div className="card-soft p-6 text-sm text-stone-600">尚未設定資料庫連線（DATABASE_URL）。</div>
  if ('error' in data) return <div className="card-soft p-6 text-sm text-stone-600">{data.error}</div>

  const last = data.lastRun
  const notes = last?.notes && typeof last.notes === 'object' ? last.notes : null
  const allWarnings: string[] = notes?.warnings ?? []
  const infos = allWarnings.filter((w) => w.startsWith('客情以資料庫'))
  const warnings = allWarnings.filter((w) => !w.startsWith('客情以資料庫'))
  const lastFull = data.recentRuns.find((r) => r.mode !== 'incremental' && r.finishedAt)
  const stale = false   // 同步已停用（2026-11-10）
  const dangling = notes?.danglingLinks ?? 0
  const mismatch = lastFull?.finishedAt && lastFull.customersSeen !== data.dbCustomers

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="資料庫內客戶" value={data.dbCustomers.toLocaleString()} note={lastFull?.customersSeen != null ? `上次全量 Notion 讀到 ${lastFull.customersSeen.toLocaleString()}` : ''} />
        <Stat label="資料庫內客情" value={data.dbVisits.toLocaleString()} note={`已連到客戶 ${data.dbVisitsLinked.toLocaleString()}`} />
        <Stat label="上次同步" value={fmt(last?.finishedAt ?? null)} note={notes?.seconds != null ? `耗時 ${notes.seconds} 秒` : last && !last.finishedAt ? '未完成' : ''} />
      </section>

      <div className="card-soft p-4 text-sm text-stone-600">客戶主檔與客情紀錄自 2026-11-10 起以新資料庫為唯一來源，Notion 已封存、不再寫入；同步排程已停用。{infos.length ? '' : ''}</div>
      {(stale || mismatch || dangling > 0 || warnings.length > 0) && (
        <div className="card-soft border-l-4 border-amber-400 p-4 text-sm text-stone-700 space-y-1">
          {stale && <p>超過 36 小時沒有完成的全量同步。</p>}
          {dangling > 0 && <p>有 {dangling} 筆客情連到的客戶在 Notion 找不到，連結已保留原值，請檢查。</p>}
          {mismatch && <p>資料庫筆數與 Notion 上次讀到的不一致，請查看最近幾次紀錄。</p>}
          {warnings.map((w, i) => <p key={i}>{w}</p>)}
        </div>
      )}

      <section className="card-soft overflow-hidden">
        <div className="px-5 py-3 text-sm font-medium text-stone-700">最近 10 次同步</div>
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs text-stone-500">
            <tr><th className="px-5 py-2 font-medium">模式</th><th className="px-5 py-2 font-medium">開始</th><th className="px-5 py-2 font-medium">完成</th><th className="px-5 py-2 font-medium text-right">客戶</th><th className="px-5 py-2 font-medium text-right">客情</th><th className="px-5 py-2 font-medium text-right">未連客戶</th></tr>
          </thead>
          <tbody>
            {data.recentRuns.map((r) => (
              <tr key={r.id} className="border-t border-stone-100 tabular-nums">
                <td className="px-5 py-2 text-stone-500">{r.mode === 'incremental' ? '增量' : '全量'}</td>
                <td className="px-5 py-2 text-stone-600">{fmt(r.startedAt)}</td>
                <td className="px-5 py-2 text-stone-600">{r.finishedAt ? fmt(r.finishedAt) : <span className="text-amber-600">未完成</span>}</td>
                <td className="px-5 py-2 text-right">{r.customersSeen?.toLocaleString() ?? '—'}</td>
                <td className="px-5 py-2 text-right">{r.visitsSeen?.toLocaleString() ?? '—'}</td>
                <td className="px-5 py-2 text-right">{r.visitsUnlinked?.toLocaleString() ?? '—'}</td>
              </tr>
            ))}
            {data.recentRuns.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center text-stone-400">還沒有同步紀錄</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card-soft p-5">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-stone-800">{value}</div>
      {note ? <div className="mt-1 text-xs text-stone-400">{note}</div> : null}
    </div>
  )
}
