import Image from 'next/image'
import type { Metadata } from 'next'
import { unstable_noStore as noStore } from 'next/cache'
import { getEventById } from '@/lib/notion/events'
import { verifyCheckinToken, isCheckinOpen } from '@/lib/checkin-token'
import { CheckinForm } from './CheckinForm'

export const metadata: Metadata = {
  title: '活動簽到｜崧達企業',
  robots: { index: false, follow: false, nocache: true },
}

/** 展會現場 QR 簽到頁（公開）。簽章錯誤或非活動期間不顯示表單，也不透露活動是否存在以外的資訊。 */
export default async function CheckinPage({
  params, searchParams,
}: { params: { eventId: string }; searchParams: { t?: string } }) {
  noStore()
  const token = searchParams.t ?? ''
  const valid = verifyCheckinToken(params.eventId, token)
  const event = valid ? await getEventById(params.eventId) : null
  const open = !!event && isCheckinOpen(event)

  return (
    <div className="min-h-screen bg-cream-100 px-4 py-10">
      <div className="mx-auto max-w-md">
        <Image src="/Logo.svg" alt="崧達企業" width={520} height={78} className="mx-auto h-auto w-40 object-contain" />
        <div className="card-soft mt-6 p-6">
          {!event ? (
            <p className="py-8 text-center text-sm text-stone-500">簽到連結無效，請向現場人員索取新的 QR code。</p>
          ) : !open ? (
            <p className="py-8 text-center text-sm text-stone-500">「{event.name}」目前不開放簽到。</p>
          ) : (
            <>
              <p className="text-[11px] font-bold uppercase tracking-widest text-brand-500">現場簽到</p>
              <h1 className="mt-1 text-xl font-bold text-stone-800">{event.name}</h1>
              <p className="mt-1 text-sm text-stone-500">
                {event.date}{event.endDate && event.endDate !== event.date ? ` — ${event.endDate}` : ''}
                {event.location ? `・${event.location}` : ''}
              </p>
              <CheckinForm eventId={params.eventId} token={token} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
