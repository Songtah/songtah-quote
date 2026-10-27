import Image from 'next/image'
import type { Metadata } from 'next'
import { unstable_noStore as noStore } from 'next/cache'
import { headers } from 'next/headers'
import { getEventById, listEventRegistrations } from '@/lib/notion/events'
import { registrationGate, formatNT } from '@/lib/online-registration'
import { RegisterForm } from './RegisterForm'

/**
 * 課程線上報名頁（公開）—— 一個活動一個頁面：/register/[活動 id]
 * 設定在活動管理 → 活動詳情 →「線上報名頁」。未勾選線上報名時只顯示未開放，不透露其他資訊。
 */

export async function generateMetadata({ params }: { params: { eventId: string } }): Promise<Metadata> {
  const event = await getEventById(params.eventId).catch(() => null)
  if (!event || !event.onlineRegistration) return { title: '課程報名｜崧達企業', robots: { index: false } }
  const description = event.description.slice(0, 120) || `${event.date} ${event.location}`.trim()
  return {
    title: `${event.name}｜線上報名｜崧達企業`,
    description,
    robots: { index: false, follow: false },
    // 分享到 LINE／Facebook 時顯示廣告圖：經 og 路由把任意比例的廣告圖完整放進 1200×630，避免分享卡裁掉左右兩側。
    // v＝廣告圖檔名，換圖即換網址，不被分享平台與 CDN 的舊快取卡住。
    openGraph: { title: event.name, description, ...(event.bannerUrl ? { images: [{ url: ogImageUrl(params.eventId, event.bannerUrl), width: 1200, height: 630 }] } : {}) },
  }
}

function ogImageUrl(eventId: string, bannerUrl: string) {
  const host = headers().get('x-forwarded-host') ?? headers().get('host') ?? 'songtah-quote.vercel.app'
  const v = encodeURIComponent(bannerUrl.split('/').pop() ?? '')
  return `https://${host}/api/public/register/og/${eventId}?v=${v}`
}

// 用 UTC 取星期：伺服器在 UTC，原本 getDay() 把台灣 00:00 當成前一天，12/12（六）顯示成（五）
const weekday = (d: string) => (d ? '日一二三四五六'[new Date(`${d.slice(0, 10)}T00:00:00Z`).getUTCDay()] : '')
const fmtDate = (d: string) => (d ? `${d.slice(0, 10).replace(/-/g, '/')}（${weekday(d)}）` : '')

export default async function RegisterPage({ params }: { params: { eventId: string } }) {
  noStore()
  const event = await getEventById(params.eventId)
  const regs = event?.onlineRegistration ? await listEventRegistrations(params.eventId).catch(() => []) : []
  const taken = regs.filter((r) => r.status !== '取消').reduce((s, r) => s + (r.attendees || 1), 0)
  const gate = event ? registrationGate(event, taken) : null

  return (
    <div className="min-h-screen overflow-x-hidden bg-cream-100 px-4 py-8 sm:py-12">
      {/* 桌機：廣告圖與下方內容同寬（max-w-5xl），活動資訊與報名表左右並排；手機上下排列 */}
      <div className="mx-auto max-w-5xl">
        <Image src="/Logo.svg" alt="崧達企業" width={2638} height={437} className="mx-auto h-auto w-36 object-contain" />

        {!event || !event.onlineRegistration ? (
          <div className="card-soft mx-auto mt-6 max-w-2xl p-8 text-center text-sm text-stone-500">此活動目前未開放線上報名。</div>
        ) : (
          <>
            {event.bannerUrl && (
              // 廣告圖比例不固定（1200×630、2000×770 長橫幅都常見）：一律等比完整顯示、不裁切；手機上點圖開原圖可放大。
              <a href={event.bannerUrl} target="_blank" rel="noreferrer" title="點擊查看原圖"
                className="mt-6 block overflow-hidden rounded-3xl bg-stone-100 ring-1 ring-stone-900/[0.05]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={event.bannerUrl} alt={event.name} className="block h-auto w-full" />
              </a>
            )}
            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
            <article className="card-soft overflow-hidden">
              <div className="p-6 sm:p-8">
                <div className="flex flex-wrap items-center gap-2">
                  {event.type && <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">{event.type}</span>}
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${event.paid ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {!event.paid ? '免費參加'
                      : event.plans.length ? `報名費 ${formatNT(Math.min(...event.plans.map((p) => p.price)))}${event.plans.length > 1 ? ' 起' : ''}`
                      : `報名費 ${formatNT(event.fee)}／人`}
                  </span>
                  {gate?.seatsLeft !== null && gate?.open && (
                    <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-600">剩餘名額 {gate?.seatsLeft}</span>
                  )}
                </div>
                <h1 className="mt-3 text-balance text-2xl font-bold leading-snug text-stone-800 sm:text-3xl lg:text-2xl">{event.name}</h1>
                <dl className="mt-4 grid gap-2 text-sm text-stone-600">
                  <div className="flex gap-2"><dt className="shrink-0 font-semibold text-stone-500">日期</dt>
                    <dd>{fmtDate(event.date)}{event.endDate && event.endDate !== event.date ? ` — ${fmtDate(event.endDate)}` : ''}</dd></div>
                  {event.location && <div className="flex gap-2"><dt className="shrink-0 font-semibold text-stone-500">地點</dt><dd>{event.location}</dd></div>}
                  {event.deadline && <div className="flex gap-2"><dt className="shrink-0 font-semibold text-stone-500">截止</dt><dd>{fmtDate(event.deadline)}</dd></div>}
                </dl>
                {event.description && <p className="mt-5 whitespace-pre-line border-t border-stone-900/[0.06] pt-5 text-sm leading-7 text-stone-600">{event.description}</p>}
              </div>
            </article>

            <section className="card-soft p-6 sm:p-8">
              {gate?.open ? (
                <RegisterForm
                  eventId={params.eventId}
                  paid={event.paid}
                  fee={event.fee}
                  plans={event.plans}
                  paymentNote={event.paid ? event.paymentNote : ''}
                  seatsLeft={gate.seatsLeft}
                />
              ) : (
                <p className="py-6 text-center text-base font-semibold text-stone-600">{gate?.reason}</p>
              )}
            </section>
            </div>
            <p className="mt-6 text-center text-xs text-stone-400">崧達企業股份有限公司</p>
          </>
        )}
      </div>
    </div>
  )
}
