import Image from 'next/image'
import type { Metadata } from 'next'
import { PublicForm } from './PublicForm'

export const metadata: Metadata = {
  title: '活動問卷｜崧達企業',
  robots: { index: false, follow: false, nocache: true },
}

/** 活動問卷／滿意度調查的公開填寫頁（未登入）。題目與狀態由 /api/public/forms/[formId] 提供。 */
export default function PublicFormPage({ params }: { params: { formId: string } }) {
  return (
    <div className="min-h-screen bg-cream-100 px-4 py-10">
      <div className="mx-auto max-w-md">
        <Image src="/Logo.svg" alt="崧達企業" width={2638} height={437} className="mx-auto h-auto w-40 object-contain" />
        <div className="card-soft mt-6 p-6">
          <PublicForm formId={params.formId} />
        </div>
      </div>
    </div>
  )
}
