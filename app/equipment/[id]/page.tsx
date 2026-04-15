'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppShell } from '@/components/AppShell'

type EquipmentDetail = {
  id: string
  customerName: string
  customerId: string
  productName: string
  manufacturer: string
  serialNumber: string
  status: string
  supportId: string
  teamViewerId: string
  dongleSerial: string
  note: string
  warrantyEnd: string
  activationDate: string
  thumbnail: string
  originalProductId: string
}

const STATUS_STYLES: Record<string, string> = {
  '正常':    'bg-blue-100 text-blue-700',
  '新機':    'bg-green-100 text-green-700',
  '高齡設備': 'bg-red-100 text-red-700',
  '報廢':    'bg-gray-100 text-gray-500',
  '借用中':  'bg-yellow-100 text-yellow-700',
  '狀態不明': 'bg-orange-100 text-orange-700',
}

export default function EquipmentDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const [data, setData] = useState<EquipmentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/equipment/${params.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else setData(d)
      })
      .catch(() => setError('無法載入設備資料'))
      .finally(() => setLoading(false))
  }, [params.id])

  return (
    <AppShell title="CRM 客戶管理" description="設備詳細資訊。">
      <div className="mb-4">
        <button
          onClick={() => router.back()}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← 返回
        </button>
      </div>

      {loading && (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-200 p-6 h-40 animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 text-sm text-red-600">{error}</div>
      )}

      {data && (
        <div className="space-y-4">
          {/* Hero card */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            {data.thumbnail && (
              <div className="w-full bg-slate-50 flex items-center justify-center" style={{ maxHeight: 280 }}>
                <img
                  src={data.thumbnail}
                  alt={data.productName}
                  className="object-contain w-full"
                  style={{ maxHeight: 280 }}
                />
              </div>
            )}
            <div className="p-6">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h1 className="text-xl font-semibold text-slate-900">
                  {data.productName || data.manufacturer || '未知機型'}
                </h1>
                {data.status && (
                  <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${STATUS_STYLES[data.status] ?? 'bg-gray-100 text-gray-500'}`}>
                    {data.status}
                  </span>
                )}
              </div>
              {data.manufacturer && (
                <p className="text-sm text-slate-500">{data.manufacturer}</p>
              )}
              {data.customerName && (
                <Link
                  href={data.customerId ? `/customers/${data.customerId}` : '#'}
                  className="inline-block mt-3 text-sm text-green-800 hover:underline font-medium"
                >
                  {data.customerName} →
                </Link>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
            <h2 className="font-semibold text-gray-800 mb-4">設備資訊</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {data.serialNumber && <InfoRow label="序號" value={data.serialNumber} />}
              {data.supportId && <InfoRow label="Support ID" value={data.supportId} />}
              {data.teamViewerId && <InfoRow label="TeamViewer ID" value={data.teamViewerId} />}
              {data.dongleSerial && <InfoRow label="Dongle 序號" value={data.dongleSerial} />}
              {data.activationDate && (
                <InfoRow label="啟用日期" value={data.activationDate.slice(0, 10).replace(/-/g, '/')} />
              )}
              {data.warrantyEnd && (
                <InfoRow label="保固結束日期" value={data.warrantyEnd.slice(0, 10).replace(/-/g, '/')} />
              )}
            </div>
            {data.note && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <dt className="text-xs text-slate-400 mb-1">備註</dt>
                <dd className="text-sm text-slate-700 whitespace-pre-wrap">{data.note}</dd>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-slate-900 font-medium">{value}</dd>
    </div>
  )
}
