/*
 * 崧達系統 Service Worker：只負責網頁推播（不做離線快取，避免舊版畫面卡住）。
 * 推播內容由 lib/notifications.ts 送出：{ title, body, href, tag }
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) { data = { title: '崧達系統', body: event.data ? event.data.text() : '' } }
  event.waitUntil(self.registration.showNotification(data.title || '崧達系統', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag,            // 同一件事只留最新一則
    data: { href: data.href || '/dashboard' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.href || '/dashboard', self.location.origin).href
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus()
        return c.navigate(target)
      }
    }
    return self.clients.openWindow(target)
  })())
})
