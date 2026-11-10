import { redirect } from 'next/navigation'

// 2026-11-10：活動規劃（辦課成本試算）依使用者指示移除；既有資料保留在資料庫
export default function CourseCostsPage() {
  redirect('/marketing')
}
