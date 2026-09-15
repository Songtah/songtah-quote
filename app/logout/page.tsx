'use client'

/**
 * 登出頁（取代 NextAuth 內建的英文確認頁；lib/auth.ts pages.signOut 指向這裡）。
 * 與登入頁同一套版面：左側一句話＋右側確認卡片。登出後回登入頁並顯示「已安全登出」。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { signOut, useSession } from 'next-auth/react'
import { motion } from 'framer-motion'
import { ArrowLeft, LogOut, MessageSquareText, MonitorSmartphone } from 'lucide-react'

function greetingFor(hour: number) {
  if (hour < 5) return '夜深了，早點休息'
  if (hour < 11) return '早安，祝今天順利'
  if (hour < 14) return '午安，記得吃飯'
  if (hour < 18) return '下午好，辛苦了'
  return '今天辛苦了'
}

export default function LogoutPage() {
  const { data: session, status } = useSession()
  const [loading, setLoading] = useState(false)
  const [now, setNow] = useState<Date | null>(null)

  useEffect(() => { setNow(new Date()) }, [])

  const name = session?.user?.name?.trim() ?? ''
  const hour = now?.getHours() ?? 12
  const dateLabel = now
    ? now.toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' })
    : ''
  // 業務的回報窗是晚上；傍晚之後登出時提醒一次回報（業務唯一的手動工作）
  const remindReport = hour >= 16 || hour < 3

  async function handleSignOut() {
    setLoading(true)
    await signOut({ callbackUrl: '/login?loggedOut=1' })
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      <div className="pointer-events-none absolute -left-32 top-1/3 size-96 rounded-full bg-brand-50 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 top-0 size-80 rounded-full bg-brand-50/70 blur-3xl" />
      <div className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[1fr_420px]">
        <section className="hidden lg:block">
          <Image src="/Logo.svg" alt="崧達企業" width={2638} height={437} className="h-auto w-56" priority />
          <p className="mt-10 text-sm font-bold uppercase tracking-[0.2em] text-brand-500">{dateLabel || ' '}</p>
          <h1 className="mt-3 max-w-xl text-5xl font-bold leading-tight tracking-tight text-stone-800">
            {name ? `${name}，${greetingFor(hour)}。` : `${greetingFor(hour)}。`}
          </h1>
          <p className="mt-5 max-w-lg text-lg leading-8 text-stone-500">
            登出後，這台裝置就不會再保留你的登入狀態。下次回來，從首頁的「下一個動作」接著做就好。
          </p>
          {remindReport && (
            <div className="mt-10 flex max-w-lg items-start gap-3 rounded-2xl bg-brand-50/70 px-5 py-4 text-sm leading-6 text-stone-600">
              <MessageSquareText className="mt-0.5 size-5 shrink-0 text-brand-600" />
              <span>業務夥伴別忘了在 LINE 群組發今天的「行程回報」，系統會自動建立客情紀錄。</span>
            </div>
          )}
        </section>

        <motion.section
          className="relative mx-auto w-full max-w-md"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="rounded-3xl bg-white p-7 shadow-[0_28px_80px_rgba(87,74,48,0.13)] ring-1 ring-stone-900/[0.05] sm:p-9">
            <div className="mb-8 flex flex-col items-center text-center">
              <Image src="/Logo.svg" alt="崧達企業" width={2638} height={437} className="mb-7 h-auto w-40 lg:hidden" priority />
              <span className="mb-4 rounded-full bg-brand-50 p-3 text-brand-600"><LogOut className="size-5" /></span>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">企業管理平台</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-stone-800">確定要登出嗎？</h2>
              <p className="mt-2 text-sm text-stone-400">
                {status === 'loading' ? '讀取帳號中…' : name ? <>目前登入帳號：<b className="font-semibold text-stone-600">{name}</b></> : '目前沒有登入中的帳號'}
              </p>
            </div>

            {remindReport && (
              <p className="mb-5 rounded-2xl bg-brand-50/70 px-4 py-3 text-center text-sm leading-6 text-stone-600 lg:hidden">
                業務夥伴別忘了在 LINE 群組發今天的「行程回報」。
              </p>
            )}

            <div className="space-y-3">
              <button type="button" onClick={handleSignOut} disabled={loading} className="button-primary h-12 w-full gap-2">
                {loading ? '登出中…' : <>確認登出 <LogOut className="size-4" /></>}
              </button>
              <Link href="/dashboard" className="button-secondary h-12 w-full gap-2">
                <ArrowLeft className="size-4" /> 返回首頁
              </Link>
            </div>

            <p className="mt-6 flex items-start justify-center gap-2 text-center text-xs leading-5 text-stone-400">
              <MonitorSmartphone className="mt-0.5 size-4 shrink-0" />
              使用公用電腦或借用他人手機時，登出後請一併關閉瀏覽器。
            </p>
          </div>
        </motion.section>
      </div>
    </div>
  )
}
