'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { motion } from 'framer-motion'

const modules = [
  { badge: '客戶', title: '客戶管理', description: '客戶主檔、聯繫紀錄、區域管理' },
  { badge: '技術支援', title: '維修案件與設備追蹤', description: '工單管理、設備序號、維護排程' },
  { badge: '業務開發', title: '商機與報價流程', description: '商機追蹤、報價建立、PDF 匯出' },
]

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
    <div className="min-h-screen bg-white">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-8 px-5 sm:px-8 lg:grid-cols-[1.15fr_0.85fr]">
        {/* Left info panel */}
        <section className="hidden lg:block py-16">
          <div className="max-w-lg">
            <Image src="/Logo.svg" alt="崧達企業" width={520} height={78} className="h-auto w-[260px] object-contain" />
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-gray-900">企業管理系統</h1>
            <p className="muted mt-4 max-w-md text-base">
              將客戶主檔、產品資訊、技術支援工單與報價流程集中到同一個平台，
              讓業務、行政與工程團隊使用同一套資料與操作入口。
            </p>
            <div className="mt-10 space-y-4">
              {modules.map((m) => (
                <div key={m.badge} className="flex items-start gap-4 rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
                  <span className="mt-0.5 shrink-0 rounded-md bg-gray-900 px-2 py-0.5 text-xs font-semibold text-white">
                    {m.badge}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{m.title}</p>
                    <p className="text-sm text-gray-500">{m.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Right login card */}
        <motion.section
          className="mx-auto w-full max-w-sm py-8 sm:py-16"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
            <div className="mb-8 flex flex-col items-center text-center">
              <Image src="/Logo.svg" alt="崧達企業" width={520} height={78} className="mb-5 h-auto w-40 object-contain" />
              <p className="eyebrow">企業管理平台</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-900">帳號登入</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">帳號</label>
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
                <label className="mb-1.5 block text-sm font-medium text-gray-700">密碼</label>
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
              {error && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-center text-rose-600">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="button-primary w-full py-2.5"
              >
                {loading ? '登入中...' : '登入系統'}
              </button>
            </form>
          </div>
        </motion.section>
      </div>
    </div>
  )
}
