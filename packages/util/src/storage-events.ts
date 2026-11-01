/** Web Storage does not notify the window performing a write. Bridges can observe this without patching Storage. */
export function notifyStorageWrite(key: string, value: string | null) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("opencode:storage-write", { detail: { key, value } }))
}
