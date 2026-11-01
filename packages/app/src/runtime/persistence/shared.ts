import { notifyStorageWrite } from "@opencode/util/storage-events"

const canonical = "https://opencode.samijaber.com"
const hub = "https://hub.samijaber.com"
const endpoint = "/_opencode/preferences"
const protocol = "opencode-preferences-v1"
const pendingKey = "opencode.preferences.pending.v1"

// Never include server registrations, authentication, prompt drafts/history, or cached API responses.
const keys = [
  "settings.v3",
  "opencode.global.dat:language",
  "opencode.global.dat:layout",
  "opencode.window.browser.dat:tabs",
  "opencode.window.browser.dat:tabs.info",
  "opencode.window.browser.dat:tabs.panes",
  "opencode.window.browser.dat:tabs.closed",
  "opencode-theme-id",
  "opencode-color-scheme",
]

type Values = Record<string, string | null>
type Message = { protocol: typeof protocol; values: Values }

export function isSharedPreference(key: string) {
  return typeof location !== "undefined" && [canonical, hub].includes(location.origin) && keys.includes(key)
}

function decode(value: unknown): Message | undefined {
  if (!value || typeof value !== "object" || !("protocol" in value) || value.protocol !== protocol) return
  if (!("values" in value) || !value.values || typeof value.values !== "object") return
  const entries = Object.entries(value.values)
  if (entries.some(([key, value]) => !keys.includes(key) || (value !== null && typeof value !== "string"))) return
  return { protocol, values: Object.fromEntries(entries) }
}

function snapshot(): Values {
  return Object.fromEntries(keys.map((key) => [key, transferable(key, localStorage.getItem(key))]))
}

// Draft composers belong to their current origin: sharing only their tab metadata would create empty copies.
function transferable(key: string, value: string | null) {
  if (key !== "opencode.window.browser.dat:tabs" || !value) return value
  return JSON.stringify(readTabs(value).filter((tab) => tab?.type === "session"))
}

function readTabs(value: string | null): { type?: string }[] {
  try {
    const tabs: unknown = JSON.parse(value ?? "[]")
    return Array.isArray(tabs) ? tabs.filter((tab) => tab && typeof tab === "object") : []
  } catch {
    // Browser state predates this bridge and can be malformed. The app will repair it on its next save.
    return []
  }
}

function apply(values: Values, remote: boolean) {
  Object.entries(values).forEach(([key, value]) => {
    const oldValue = localStorage.getItem(key)
    const next = (() => {
      if (key !== "opencode.window.browser.dat:tabs") return value
      return JSON.stringify([
        ...readTabs(value).filter((tab) => tab.type === "session"),
        ...readTabs(oldValue).filter((tab) => tab.type === "draft"),
      ])
    })()
    if (next === oldValue) return
    if (next === null) localStorage.removeItem(key)
    if (next !== null) localStorage.setItem(key, next)
    if (!remote) notifyStorageWrite(key, next)
    window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue: next, storageArea: localStorage }))
  })
}

// Server identities inside layout and tab state must refer to the current hostname, not the other origin.
function translate(values: Values, from: string, to: string): Values {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value?.replaceAll(from, to).replaceAll(btoa(from).replaceAll("=", ""), btoa(to).replaceAll("=", "")) ?? null,
    ]),
  )
}

/** This tiny document runs on the canonical origin, behind its existing Cloudflare Access application. */
export function serveSharedPreferences() {
  if (location.origin !== canonical || parent === window) return
  const send = (values: Values) => parent.postMessage({ protocol, values }, hub)
  window.addEventListener("message", (event) => {
    if (event.origin !== hub || event.source !== parent) return
    const message = decode(event.data)
    if (!message) return
    apply(message.values, false)
    send(snapshot())
  })
  window.addEventListener("storage", (event) => {
    if (event.isTrusted && event.key && keys.includes(event.key)) {
      send({ [event.key]: transferable(event.key, event.newValue) })
    }
  })
  send(snapshot())
}

/** Only the owner's two deployed web origins participate; other web and desktop builds are unchanged. */
export async function initializeSharedPreferences() {
  if (location.origin !== hub) return
  const frame = document.createElement("iframe")
  frame.hidden = true
  frame.src = canonical + endpoint
  const state = { connected: false }
  const pending: Values = (() => {
    try {
      return decode(JSON.parse(localStorage.getItem(pendingKey) ?? "null"))?.values ?? {}
    } catch {
      return {}
    }
  })()
  const savePending = () => {
    if (!Object.keys(pending).length) return localStorage.removeItem(pendingKey)
    localStorage.setItem(pendingKey, JSON.stringify({ protocol, values: pending }))
  }
  const ready = Promise.withResolvers<void>()
  const send = (values: Values) => {
    if (!Object.keys(values).length) return
    frame.contentWindow?.postMessage({ protocol, values: translate(values, hub, canonical) }, canonical)
  }
  window.addEventListener("message", (event) => {
    if (event.origin !== canonical || event.source !== frame.contentWindow) return
    const message = decode(event.data)
    if (!message) return
    const first = !state.connected
    if (first) {
      // Retain the previous Hub UI state before importing the authoritative preferences.
      if (!localStorage.getItem("opencode.preferences.backup.v1")) {
        localStorage.setItem("opencode.preferences.backup.v1", JSON.stringify(snapshot()))
      }
      state.connected = true
    }
    const values = translate(message.values, canonical, hub)
    Object.entries(values).forEach(([key, value]) => {
      if (pending[key] === value) delete pending[key]
    })
    // Edits made while Access was expired/offline survive a reload and win when the bridge reconnects.
    apply(Object.fromEntries(Object.entries(values).filter(([key]) => !(key in pending))), true)
    savePending()
    if (first) send(pending)
    ready.resolve()
  })
  window.addEventListener("opencode:storage-write", (event) => {
    // SAFETY: only our app/theme write helper emits this document-local event with this payload.
    const detail = (event as CustomEvent<{ key: string; value: string | null }>).detail
    if (!keys.includes(detail.key)) return
    const value = transferable(detail.key, detail.value)
    pending[detail.key] = value
    savePending()
    if (state.connected) send({ [detail.key]: value })
  })
  document.body.append(frame)
  // Access expiry or an offline canonical origin must not make Hub unusable. A late handshake still syncs.
  const timer = setTimeout(() => ready.resolve(), 2500)
  await ready.promise
  clearTimeout(timer)
}
