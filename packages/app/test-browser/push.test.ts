import { expect, test } from "bun:test"
import { runInNewContext } from "node:vm"
import { dismissPushNotifications } from "@/runtime/platform/push"

type WorkerEvent = {
  data?: { json: () => unknown }
  notification?: { close: () => void; data: { url: string } }
  waitUntil: (work: Promise<unknown>) => void
}

async function worker(
  windows: { url: string; focus: () => Promise<void> }[] = [],
  delivered: { data: { url: string }; close: () => void }[] = [],
) {
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const notifications: { title: string; options: NotificationOptions }[] = []
  const opened: string[] = []
  runInNewContext(await Bun.file(new URL("../public/push.js", import.meta.url)).text(), {
    URL,
    self: {
      location: { origin: "https://hub.samijaber.com" },
      addEventListener: (name: string, listener: (event: WorkerEvent) => void) => listeners.set(name, listener),
      registration: {
        getNotifications: async () => delivered,
        showNotification: async (title: string, options: NotificationOptions) => {
          notifications.push({ title, options })
        },
      },
      clients: {
        matchAll: async () => windows,
        openWindow: async (url: string) => {
          opened.push(url)
        },
      },
    },
  })
  const dispatch = async (
    name: string,
    input: { data?: { json: () => unknown }; notification?: { close: () => void; data: { url: string } } },
  ) => {
    const work: Promise<unknown>[] = []
    const listener = listeners.get(name)
    if (!listener) throw new Error(`Missing ${name} handler`)
    listener({
      ...input,
      waitUntil: (promise) => {
        work.push(promise)
      },
    })
    await Promise.all(work)
  }
  return { dispatch, notifications, opened }
}

test("a push displays its embedded session alert without fetching an API or needing an app window", async () => {
  const fixture = await worker()
  await fixture.dispatch("push", {
    data: {
      json: () => ({
        title: "Your response is ready",
        body: "Synthetic session",
        tag: "session:test",
        url: "/server/test/session/synthetic",
      }),
    },
  })
  expect(fixture.notifications).toEqual([
    {
      title: "Your response is ready",
      options: {
        body: "Synthetic session",
        tag: "session:test",
        icon: "/favicon-96x96-v3.png",
        data: { url: "/server/test/session/synthetic" },
      },
    },
  ])
})

test("notification taps focus the matching session, open missing sessions and reject another origin", async () => {
  const focused: string[] = []
  const url = "https://hub.samijaber.com/server/test/session/synthetic"
  const dismissed: string[] = []
  const fixture = await worker(
    [
      {
        url,
        focus: async () => {
          focused.push(url)
        },
      },
    ],
    [
      "/server/test/session/synthetic",
      "/server/test/session/synthetic",
      "/server/test/session/other",
      "/server/other/session/synthetic",
    ].map((url) => ({
      data: { url },
      close: () => {
        dismissed.push(url)
      },
    })),
  )
  const closed: boolean[] = []
  const click = (url: string) =>
    fixture.dispatch("notificationclick", {
      notification: {
        data: { url },
        close: () => {
          closed.push(true)
        },
      },
    })
  await click("/server/test/session/synthetic")
  expect(focused).toEqual([url])
  expect(fixture.opened).toEqual([])
  expect(dismissed).toEqual(["/server/test/session/synthetic", "/server/test/session/synthetic"])
  await click("/server/test/session/other")
  expect(fixture.opened).toEqual(["https://hub.samijaber.com/server/test/session/other"])
  expect(dismissed).toEqual([
    "/server/test/session/synthetic",
    "/server/test/session/synthetic",
    "/server/test/session/other",
  ])
  await click("https://untrusted.example/session")
  expect(fixture.opened).toEqual(["https://hub.samijaber.com/server/test/session/other"])
  expect(closed).toHaveLength(3)
})

test("opening a session dismisses every delivered alert for its route, without touching other sessions or servers", async () => {
  const dismissed: string[] = []
  const registrations: string[] = []
  const secure = Object.getOwnPropertyDescriptor(window, "isSecureContext")
  const serviceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker")
  // Happy DOM has no service-worker notification store; replace only that browser boundary.
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true })
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: async (scope: string) => {
        registrations.push(scope)
        return {
          getNotifications: async () =>
            [
              "/server/test/session/synthetic",
              "/server/test/session/synthetic",
              "/server/test/session/other",
              "/server/other/session/synthetic",
            ].map((url) => ({
              data: { url },
              close: () => {
                dismissed.push(url)
              },
            })),
        }
      },
    },
  })
  try {
    await dismissPushNotifications("/server/test/session/synthetic")
    expect(dismissed).toEqual(["/server/test/session/synthetic", "/server/test/session/synthetic"])
    expect(registrations).toEqual(["/"])

    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false })
    await dismissPushNotifications("/server/test/session/other")
    expect(registrations).toEqual(["/"])
  } finally {
    if (secure) Object.defineProperty(window, "isSecureContext", secure)
    // oxlint-disable-next-line no-restricted-globals -- Restore an originally absent browser property without a type assertion.
    if (!secure) Reflect.deleteProperty(window, "isSecureContext")
    if (serviceWorker) Object.defineProperty(navigator, "serviceWorker", serviceWorker)
    // oxlint-disable-next-line no-restricted-globals -- Restore an originally absent browser property without a type assertion.
    if (!serviceWorker) Reflect.deleteProperty(navigator, "serviceWorker")
  }
})
