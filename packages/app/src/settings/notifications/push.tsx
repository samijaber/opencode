import { createEffect, createMemo, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { base64Encode } from "@opencode/util/encode"
import { useGlobal } from "@/runtime/server/runtime"
import { usePlatform } from "@/runtime/platform/platform"
import { isStandalone } from "@/runtime/platform/pwa"
import { useLanguage } from "@/runtime/i18n/language"
import { useSettings } from "@/settings/model"

export function SettingsPush() {
  const platform = usePlatform()
  return (
    <Show when={platform.platform === "web"}>
      <WebPushSettings />
    </Show>
  )
}

function WebPushSettings() {
  const global = useGlobal()
  const language = useLanguage()
  const settings = useSettings()
  const sdk = createMemo(() => {
    const conn = global.servers.list().find((item) => item.http.url.replace(/\/$/, "") === location.origin)
    return conn ? global.ensureServerCtx(conn).sdk : undefined
  })
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  const install = ios && !isStandalone()
  const supported =
    window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
  const [state, setState] = createStore({
    loading: true,
    busy: false,
    enabled: false,
    publicKey: "",
    blocked: supported && Notification.permission === "denied",
    error: false,
    sent: false,
  })

  const subscription = async () => (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription()
  const save = async (sub: PushSubscription) => {
    const client = sdk()
    if (!client) throw new Error("Server unavailable")
    const json = sub.toJSON()
    if (!json.keys?.p256dh || !json.keys.auth) throw new Error("Subscription keys unavailable")
    await client.api.experimental.push.subscribe({
      subscription: { endpoint: sub.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
      path: `/server/${base64Encode(client.url)}`,
      events: {
        agent: settings.notifications.agent(),
        permissions: settings.notifications.permissions(),
        questions: settings.notifications.questions(),
        errors: settings.notifications.errors(),
      },
      labels: {
        ready: language.t("notification.session.responseReady.title"),
        question: language.t("notification.question.title"),
        permission: language.t("notification.permission.title"),
        error: language.t("notification.session.error.title"),
        test: language.t("settings.push.testMessage"),
      },
    })
  }

  const load = async () => {
    setState({ loading: true, error: false })
    if (!supported || install) return
    const client = sdk()
    if (!client) throw new Error("Server unavailable")
    const key = await client.api.experimental.push.key()
    setState("publicKey", key.publicKey)
    const sub = await subscription()
    setState("enabled", sub ? (await client.api.experimental.push.status({ endpoint: sub.endpoint })).enabled : false)
  }
  onMount(
    () =>
      void load()
        .catch(() => setState("error", true))
        .finally(() => setState("loading", false)),
  )

  createEffect(() => {
    if (!state.enabled || state.loading) return
    settings.notifications.agent()
    settings.notifications.permissions()
    settings.notifications.questions()
    settings.notifications.errors()
    language.t("settings.push.testMessage")
    void subscription()
      .then((sub) => sub && save(sub))
      .catch(() => setState("error", true))
  })

  const enable = async () => {
    // iOS requires permission from a user gesture, before any unrelated awaits.
    const permission = await Notification.requestPermission()
    setState("blocked", permission === "denied")
    if (permission !== "granted") return
    await navigator.serviceWorker.register("/sw.js")
    const worker = await navigator.serviceWorker.ready
    const sub =
      (await worker.pushManager.getSubscription()) ??
      (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: state.publicKey }))
    settings.notifications.setAgent(true)
    await save(sub)
    setState("enabled", true)
  }

  const disable = async () => {
    const client = sdk()
    if (!client) throw new Error("Server unavailable")
    const sub = await subscription()
    if (sub) {
      await client.api.experimental.push.unsubscribe({ endpoint: sub.endpoint })
      await sub.unsubscribe()
    }
    setState({ enabled: false, sent: false })
  }

  const test = async () => {
    const client = sdk()
    if (!client) throw new Error("Server unavailable")
    const sub = await subscription()
    if (!sub) throw new Error("Subscription unavailable")
    await client.api.experimental.push.test({ endpoint: sub.endpoint })
    setState("sent", true)
  }

  const run = (action: () => Promise<void>) => {
    setState({ busy: true, error: false, sent: false })
    void action()
      .catch(() => setState("error", true))
      .finally(() => setState("busy", false))
  }

  return (
    <section class="settings-section">
      <h3 class="settings-section-title">{language.t("settings.push.title")}</h3>
      <div class="flex flex-col gap-3 border-y border-v2-border-base py-4">
        <p class="text-13-regular text-v2-text-text-muted">{language.t("settings.push.description")}</p>
        <Show when={install}>
          <p class="text-13-regular">{language.t("settings.push.install")}</p>
        </Show>
        <Show when={!install && !supported}>
          <p class="text-13-regular">{language.t("settings.push.unsupported")}</p>
        </Show>
        <Show when={supported && !install}>
          <Show when={state.blocked}>
            <p class="text-13-regular">{language.t("settings.push.blocked")}</p>
          </Show>
          <p class="text-13-regular" role="status">
            {language.t(state.enabled ? "settings.push.enabled" : "settings.push.disabled")}
          </p>
          <div class="flex flex-wrap gap-2">
            <Button
              class="min-h-11 rounded-none"
              variant="outline"
              disabled={state.loading || state.busy || (!state.enabled && (state.blocked || !state.publicKey))}
              onClick={() => run(state.enabled ? disable : enable)}
            >
              {language.t(state.enabled ? "settings.push.disable" : "settings.push.enable")}
            </Button>
            <Show when={state.enabled}>
              <Button class="min-h-11 rounded-none" variant="outline" disabled={state.busy} onClick={() => run(test)}>
                {language.t("settings.push.test")}
              </Button>
            </Show>
          </div>
        </Show>
        <Show when={state.sent}>
          <p class="text-13-regular" role="status">
            {language.t("settings.push.sent")}
          </p>
        </Show>
        <Show when={state.error}>
          <p class="text-13-regular" role="alert">
            {language.t("settings.push.error")}
          </p>
          <Button
            class="min-h-11 rounded-none self-start"
            variant="outline"
            disabled={state.busy}
            onClick={() => run(() => load().finally(() => setState("loading", false)))}
          >
            {language.t("settings.push.retry")}
          </Button>
        </Show>
      </div>
    </section>
  )
}
