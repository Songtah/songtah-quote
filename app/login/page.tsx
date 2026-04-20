'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

export default function LoginPage() {
  const router = useRouter()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await signIn('credentials', {
      ...form,
      redirect: false,
    })
    setLoading(false)
    if (res?.ok) {
      router.push('/dashboard')
    } else {
      setError('帳號或密碼錯誤')
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.12),transparent_25%),linear-gradient(180deg,#f8f4ea_0%,#eef3ef_52%,#e5ede8_100%)] px-4 py-10">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="hidden lg:block">
          <div className="max-w-xl">
            <p className="eyebrow mb-3">Songtah Internal Suite</p>
            <Image src="/Logo.svg" alt="崧達企業" width={260} height={88} className="h-auto w-64 object-contain" />
            <h1 className="mt-8 text-5xl font-black tracking-tight text-slate-900">
              CRM、RMA 與
              <br />
              BD 的統一工作台
            </h1>
            <p className="muted mt-5 max-w-lg text-base">
              將客戶主檔、產品資訊、技術支援工單與報價流程集中到同一個平台，
              讓業務、行政與工程團隊使用同一套資料與操作入口。
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="panel p-4">
                <p className="eyebrow mb-2">CRM</p>
                <p className="text-sm font-semibold text-slate-900">客戶與轄區查閱</p>
              </div>
              <div className="panel p-4">
                <p className="eyebrow mb-2">RMA</p>
                <p className="text-sm font-semibold text-slate-900">維修案件與設備追蹤</p>
              </div>
              <div className="panel p-4">
                <p className="eyebrow mb-2">BD</p>
                <p className="text-sm font-semibold text-slate-900">商機與報價流程</p>
              </div>
            </div>
          </div>
        </section>

        <section className="panel soft-grid mx-auto w-full max-w-md overflow-hidden border-white/80 bg-white/82 p-8 backdrop-blur">
          <div className="mb-8 flex flex-col items-center text-center">
            <Image src="/Logo.svg" alt="崧達企業" width={216} height={72} className="mb-4 h-auto w-52 object-contain" />
            <p className="eyebrow">CRM・RMA・BD 內部平台</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">登入後台</h2>
            <p className="mt-3 text-sm leading-7 text-slate-500">
              使用公司內部分配的帳號登入，進入客戶、工單、產品與報價模組。
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">帳號</label>
              <input
                type="text"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                className="input"
                placeholder="輸入帳號"
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">密碼</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className="input"
                placeholder="輸入密碼"
                autoComplete="current-password"
                required
              />
            </div>
            {error && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-center text-rose-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="button-primary w-full"
            >
              {loading ? '登入中...' : '登入系統'}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
