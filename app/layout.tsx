import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/Providers'
import { FloatingFontSizeToggle } from '@/components/FontSizeToggle'

export const metadata: Metadata = {
  title: '崧達企業管理系統',
  description: 'SONGTAH TRADING CO.,LTD. 內部營運平台',
  icons: {
    icon: '/favicon.svg',
  },
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
