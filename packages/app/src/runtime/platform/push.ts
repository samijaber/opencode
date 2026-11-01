/** Clear only this session's delivered Web Push alerts, including request alerts without an idle watermark. */
export async function dismissPushNotifications(url: string) {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return

  const worker = await navigator.serviceWorker.getRegistration("/")
  const notifications = await worker?.getNotifications()
  notifications
    ?.filter((notification) => notification.data?.url === url)
    .forEach((notification) => notification.close())
}
