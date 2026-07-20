'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react'

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
    <div className="relative min-h-screen overflow-hidden bg-white">
      <div className="pointer-events-none absolute -left-32 top-1/3 size-96 rounded-full bg-brand-50 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 top-0 size-80 rounded-full bg-brand-50/70 blur-3xl" />
      <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[1fr_420px]">
        <section className="hidden lg:block">
          <Image src="/Logo.svg" alt="崧達企業" width={520} height={78} className="h-auto w-56" priority />
          <p className="mt-10 text-sm font-bold uppercase tracking-[0.2em] text-brand-500">每天從下一步開始</p>
          <h1 className="mt-3 max-w-xl text-5xl font-bold leading-tight tracking-tight text-stone-800">登入後，立即看見今天該完成的工作。</h1>
          <p className="mt-5 max-w-lg text-lg leading-8 text-stone-500">客戶、拜訪、報價、訂貨與技術支援集中在同一個入口；畫面只呈現你的角色有權查看的內容。</p>
          <div className="mt-10 flex items-center gap-3 text-sm font-semibold text-stone-500"><ShieldCheck className="size-5 text-brand-600" />敏感資料依帳號權限分級顯示</div>
        </section>

        <motion.section
          className="relative mx-auto w-full max-w-md"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="rounded-3xl bg-white p-7 shadow-[0_28px_80px_rgba(87,74,48,0.13)] ring-1 ring-stone-900/[0.05] sm:p-9">
            <div className="mb-8 flex flex-col items-center text-center">
              <Image src="/Logo.svg" alt="崧達企業" width={520} height={78} className="mb-7 h-auto w-40 lg:hidden" priority />
              <span className="mb-4 rounded-full bg-brand-50 p-3 text-brand-600"><LockKeyhole className="size-5" /></span>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">企業管理平台</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-stone-800">登入開始今天的工作</h2>
              <p className="mt-2 text-sm text-stone-400">請使用公司帳號登入</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-semibold text-stone-600">帳號</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  className="input-soft h-12 rounded-2xl"
                  placeholder="輸入帳號"
                  autoComplete="username"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-stone-600">密碼</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="input-soft h-12 rounded-2xl"
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
                className="button-primary h-12 w-full gap-2"
              >
                {loading ? '登入中...' : <>登入系統 <ArrowRight className="size-4" /></>}
              </button>
            </form>
          </div>
        </motion.section>
      </div>
    </div>
  )
}
