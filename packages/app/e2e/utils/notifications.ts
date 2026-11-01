import type { Page } from "@playwright/test"

// Browser-owned APIs are simulated; the settings UI and its server requests are real.
export async function mockWebPush(page: Page, input: { standalone: boolean; denied?: boolean }) {
  await page.addInitScript(({ standalone, denied }) => {
    Object.defineProperty(navigator, "standalone", { value: standalone, configurable: true })
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      configurable: true,
    })
    Object.defineProperty(window, "PushManager", { value: class {}, configurable: true })
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: class {
        static permission = denied ? "denied" : "default"
        static async requestPermission() {
          if (!navigator.userActivation.isActive) throw new Error("Permission must be requested from a tap")
          this.permission = denied ? "denied" : "granted"
          return this.permission
        }
      },
    })
    const sub = {
      endpoint: "https://web.push.apple.com/synthetic-device",
      toJSON: () => ({ keys: { p256dh: "B" + "a".repeat(86), auth: "a".repeat(22) } }),
      unsubscribe: async () => {
        sessionStorage.removeItem("mock-push")
        return true
      },
    }
    const worker = {
      pushManager: {
        getSubscription: async () => (sessionStorage.getItem("mock-push") ? sub : null),
        subscribe: async (options: PushSubscriptionOptionsInit) => {
          if (!options.userVisibleOnly || !options.applicationServerKey) throw new Error("Missing push options")
          sessionStorage.setItem("mock-push", "enabled")
          return sub
        },
      },
    }
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: async () => worker,
        getRegistration: async () => worker,
        ready: Promise.resolve(worker),
      },
    })
  }, input)
}

export async function recordNotifications(page: Page) {
  const notifications: { title: string; body?: string }[] = []

  const sounds: string[] = []

  await page.exposeBinding("recordNotification", (_source, notification: { title: string; body?: string }) => {
    notifications.push(notification)
  })
  await page.exposeBinding("recordNotificationSound", (_source, src: string) => {
    sounds.push(src)
  })
  await page.addInitScript(() => {
    // SAFETY: exposeBinding above installs these callbacks before the app starts.
    const host: Window & {
      recordNotification?: (notification: { title: string; body?: string }) => Promise<void>
      recordNotificationSound?: (src: string) => Promise<void>
    } = window

    document.hasFocus = () => false
    Object.defineProperty(window, "Notification", {
      value: class extends EventTarget {
        static permission = "granted"
        onclick: (() => void) | null = null

        constructor(title: string, options?: NotificationOptions) {
          super()
          void host.recordNotification!({ title, body: options?.body })
        }

        close() {}
      },
    })
    Object.defineProperty(window, "Audio", {
      value: class {
        currentTime = 0

        constructor(readonly src: string) {}

        play() {
          return host.recordNotificationSound!(this.src)
        }

        pause() {}
      },
    })
  })

  return { notifications, sounds }
}
