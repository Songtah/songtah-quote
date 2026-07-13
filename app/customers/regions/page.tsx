import { redirect } from 'next/navigation'

// 區域客戶儀表板已搬到客戶資料監控頁(分頁),舊網址永久導向新位置(保留書籤相容)。
export default function CustomerRegionsPage() {
  redirect('/admin/clinic-monitor?tab=regions')
}
