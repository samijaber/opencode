import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { ModelSelectionSchema } from "@/providers/models/selection"
import { flushPersisted } from "@/runtime/persistence/persist"
import { persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { Schema } from "effect"

test("shared preferences update mounted consumers without a reload or a write-back loop", () => {
  const previous = window.location.href
  window.location.href = "https://hub.samijaber.com/"
  localStorage.setItem("settings.v3", '{"tabLayout":"horizontal"}')
  createRoot((dispose) => {
    try {
      const [state] = persisted(
        "settings.v3",
        Persistence.struct({ tabLayout: Schema.String }),
        { tabLayout: "horizontal" },
        {
          platform: "web",
          openExternal: () => {},
          restart: async () => {},
          notify: async () => {},
        },
      )
      localStorage.setItem("settings.v3", '{"tabLayout":"vertical"}')
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "settings.v3",
          oldValue: '{"tabLayout":"horizontal"}',
          newValue: '{"tabLayout":"vertical"}',
          storageArea: localStorage,
        }),
      )
      expect(state.tabLayout).toBe("vertical")
      flushPersisted()
      expect(localStorage.getItem("settings.v3")).toBe('{"tabLayout":"vertical"}')
    } finally {
      dispose()
      localStorage.removeItem("settings.v3")
      window.location.href = previous
    }
  })
})

test("persisted model selection hydrates, updates and serializes the schema shape", () => {
  const key = `consumer-model-selection-${crypto.randomUUID()}`
  localStorage.setItem(
    key,
    JSON.stringify({ pick: { session1: { agent: "plan" }, __workspace__: { agent: "build" } } }),
  )
  createRoot((dispose) => {
    try {
      const [state, setState] = persisted(
        key,
        ModelSelectionSchema,
        { session: {} },
        {
          platform: "web",
          openExternal: () => {},
          restart: async () => {},
          notify: async () => {},
        },
      )

      expect(state.session.session1?.agent).toBe("plan")
      setState("session", "session1", { agent: "build", variant: null })
      expect(state.session.session1?.agent).toBe("build")
      flushPersisted()
      expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual({
        session: { session1: { agent: "build", variant: null } },
      })
    } finally {
      dispose()
      localStorage.removeItem(key)
    }
  })
})
