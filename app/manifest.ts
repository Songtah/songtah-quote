import type { MetadataRoute } from 'next'

/**
 * 網頁應用程式資訊：讓手機可以「加到主畫面」像 App 一樣開啟。
 * iPhone 必須從主畫面開啟，才收得到網頁推播（iOS 16.4 以上），見 components/NotificationBell。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '崧達企業管理系統',
    short_name: '崧達系統',
    description: '崧達企業內部營運平台',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    lang: 'zh-TW',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
