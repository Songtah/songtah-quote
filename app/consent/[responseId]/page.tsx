import Image from 'next/image'
import type { Metadata } from 'next'
import { ConsentForm } from './ConsentForm'

export const metadata: Metadata = {
  title: '個人資料告知｜崧達企業',
  robots: { index: false, follow: false, nocache: true },
}

/** 問卷「補告知」公開頁（未登入）：閱讀個資告知事項並勾選同意。連結由後台回覆名單產生，帶 ?t= 簽章。 */
export default function ConsentPage({ params, searchParams }: { params: { responseId: string }; searchParams: { t?: string } }) {
  return (
    <div className="min-h-screen bg-cream-100 px-4 py-10">
      <div className="mx-auto max-w-md">
        <Image src="/Logo.svg" alt="崧達企業" width={2638} height={437} className="mx-auto h-auto w-40 object-contain" />
        <div className="card-soft mt-6 p-6">
          <ConsentForm responseId={params.responseId} token={searchParams.t ?? ''} />
        </div>
      </div>
    </div>
  )
}
