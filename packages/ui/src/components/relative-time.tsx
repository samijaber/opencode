import { createMemo, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useI18n } from "../context/i18n"

// All mounted timestamps share one clock, including cached session timelines.
const [clock, setClock] = createStore({ now: Date.now() })

const subscribers = new Set<symbol>()

let timer: ReturnType<typeof setInterval> | undefined

export function RelativeTime(props: { timestamp: number; class?: string; "data-slot"?: string }) {
  const i18n = useI18n()
  const subscriber = Symbol()
  const date = createMemo(() => new Date(props.timestamp))

  const title = createMemo(() =>
    new Intl.DateTimeFormat(i18n.locale(), { dateStyle: "medium", timeStyle: "long" }).format(date()),
  )

  const label = createMemo(() => {
    clock.now

    return i18n.relativeTime(props.timestamp)
  })

  onMount(() => {
    subscribers.add(subscriber)

    if (timer !== undefined) return
    setClock("now", Date.now())
    timer = setInterval(() => setClock("now", Date.now()), 30_000)
  })
  onCleanup(() => {
    subscribers.delete(subscriber)

    if (subscribers.size > 0) return
    clearInterval(timer)
    timer = undefined
  })

  return (
    <time data-slot={props["data-slot"]} class={props.class} dateTime={date().toISOString()} title={title()} dir="auto">
      {label()}
    </time>
  )
}
