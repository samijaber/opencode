/* Web Push payloads are encrypted in transit. No API request is needed to display them. */
self.addEventListener("push", (event) => {
  const payload = event.data?.json()
  if (!payload) return
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/favicon-96x96-v3.png",
      data: { url: payload.url },
    }),
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = new URL(event.notification.data.url, self.location.origin)
  if (url.origin !== self.location.origin) return
  event.waitUntil(
    Promise.all([
      self.registration.getNotifications().then((notifications) => {
        notifications
          .filter((notification) => notification.data?.url === event.notification.data.url)
          .forEach((notification) => notification.close())
      }),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
        const existing = windows.find((client) => client.url === url.href)
        if (existing) return existing.focus()
        return self.clients.openWindow(url.href)
      }),
    ]),
  )
})
