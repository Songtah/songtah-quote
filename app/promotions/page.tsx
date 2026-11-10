import { redirect } from 'next/navigation'

// 2026-11-10：促銷改掛在各場活動底下，這個獨立頁面不再使用
export default function PromotionsPage() {
  redirect('/marketing')
}
