import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Providers } from '@/components/Providers'
import { FloatingFontSizeToggle } from '@/components/FontSizeToggle'

export const metadata: Metadata = {
  title: '崧達企業管理系統',
  description: 'SONGTAH TRADING CO.,LTD. 內部營運平台',
  // 手機瀏覽器（尤其 iPhone Safari）不吃 SVG 小圖示，另給 PNG／ICO；加到主畫面用 apple-touch-icon
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  // 加到 iPhone 主畫面時以 App 樣式開啟（網頁推播在 iPhone 上需要這樣開）
  appleWebApp: { capable: true, title: '崧達系統', statusBarStyle: 'default' },
}

// 手機：固定以裝置寬度顯示。maximumScale 1 讓 iPhone 點輸入框時不會自動放大（放大後在主畫面 App 裡常卡在放大、畫面偏一邊）；
// iOS 仍可雙指縮放。viewportFit cover＋各處 safe-area 讓瀏海／底部橫條不擋內容。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      {/* 在 React hydration 前套用字體大小設定，避免畫面閃爍 */}
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            try {
              var fs = localStorage.getItem('songtah-fs');
              if (fs === 'large' || fs === 'xlarge') document.documentElement.setAttribute('data-fs', fs);
            } catch (e) {}
          })();
        `}} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <FloatingFontSizeToggle />
      </body>
    </html>
  )
}
