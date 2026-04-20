'use client'
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { Spotlight } from '@/components/ui/spotlight'
import { BackgroundBeams } from '@/components/ui/background-beams'
import { HoverEffect } from '@/components/ui/card-hover-effect'
const modules = [
  { badge: 'CRM', title: '客戶與轄區查閱', description: '客戶主檔、聯繫紀錄、區域管理' },
  { badge: 'RMA', title: '維修案件與設備追蹤', description: '工單管理、設備序號、維護排程' },
  { badge: 'BD', title: '商機與報價流程', description: '商機追蹤、報價建立、PDF 匯出' },
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
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-cream-100 via-cream-200 to-brand-100">
      {/* Aceternity effects */}
      <Spotlight />
      <BackgroundBeams />

      {/* Subtle marble texture overlay */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='200' height='200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
      }} />

      <div className="relative z-10 px-4 py-10">
        <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          {/* Left info panel */}
          <section className="hidden lg:block">
            <div className="max-w-xl">
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
              >
                <Image src="/Logo.svg" alt="崧達企業" width={400} height={130} className="h-auto w-[340px] object-contain" />
                <h1 className="mt-4 text-5xl font-black tracking-tight text-stone-800">企業管理系統</h1>
                <div className="gold-line mt-4 w-24" />
              </motion.div>

              <motion.p
                className="muted mt-5 max-w-lg text-base"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.6 }}
              >
                將客戶主檔、產品資訊、技術支援工單與報價流程集中到同一個平台，
                讓業務、行政與工程團隊使用同一套資料與操作入口。
              </motion.p>

              <motion.div
                className="mt-8"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 1 }}
              >
                <HoverEffect items={modules} />
              </motion.div>
            </div>
          </section>

          {/* Right login card */}
          <motion.section
            className="panel soft-grid mx-auto w-full max-w-md overflow-hidden p-8"
            initial={{ opacity: 0, x: 40, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <div className="mb-8 flex flex-col items-center text-center">
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.5 }}
              >
                <Image src="/Logo.svg" alt="崧達企業" width={216} height={72} className="mb-4 h-auto w-52 object-contain" />
              </motion.div>
              <div className="gold-line mx-auto mb-4 w-12" />
              <p className="eyebrow">企業管理平台</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-stone-800">帳號登入</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.6 }}
              >
                <label className="mb-2 block text-sm font-semibold text-stone-600">帳號</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  className="input"
                  placeholder="輸入帳號"
                  autoComplete="username"
                  required
                />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.7 }}
              >
                <label className="mb-2 block text-sm font-semibold text-stone-600">密碼</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="input"
                  placeholder="輸入密碼"
                  autoComplete="current-password"
                  required
                />
              </motion.div>
              {error && (
                <motion.p
                  className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-center text-rose-600"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                >
                  {error}
                </motion.p>
              )}
              <motion.button
                type="submit"
                disabled={loading}
                className="button-primary w-full"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.8 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {loading ? '登入中...' : '登入系統'}
              </motion.button>
            </form>
          </motion.section>
        </div>
      </div>
    </div>
  )
}
