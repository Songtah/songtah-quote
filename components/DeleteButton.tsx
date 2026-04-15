'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function DeleteButton({ id }: { id: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    setLoading(true)
    setError('')

    const res = await fetch(`/api/quotes/${id}`, { method: 'DELETE' })

    setLoading(false)

    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error || '刪除失敗')
      return
    }

    setConfirming(false)
    router.refresh()
  }

  if (confirming) {
    return (
      <span className="flex gap-2 items-center">
        <button onClick={handleDelete} disabled={loading} className="text-red-600 hover:text-red-800 text-xs font-semibold">
          {loading ? '刪除中' : '確認刪除'}
        </button>
        <button onClick={() => setConfirming(false)} className="text-gray-400 hover:text-gray-600 text-xs">
          取消
        </button>
        {error && <span className="text-[11px] text-red-500">{error}</span>}
      </span>
    )
  }

  return (
    <button
      onClick={() => {
        setError('')
        setConfirming(true)
      }}
      className="text-red-400 hover:text-red-600 text-xs"
    >
      刪除
    </button>
  )
}
