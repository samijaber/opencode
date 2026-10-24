import type { HomeSessionRecord } from "./records"
import type { useLanguage } from "@/runtime/i18n/language"

export type HomeSessionGroup = {
  id: "today" | "yesterday" | "older"
  title: string
  sessions: HomeSessionRecord[]
}

export function groupSessions(
  records: HomeSessionRecord[],
  language: ReturnType<typeof useLanguage>,
): HomeSessionGroup[] {
  const now = new Date()
  const today = localDay(now)
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))

  const day = (record: HomeSessionRecord) =>
    localDay(new Date(record.session.time.updated ?? record.session.time.created))

  return [
    {
      id: "today" as const,
      title: language.t("home.sessions.group.today"),
      sessions: records.filter((record) => day(record) === today),
    },
    {
      id: "yesterday" as const,
      title: language.t("home.sessions.group.yesterday"),
      sessions: records.filter((record) => day(record) === yesterday),
    },
    {
      id: "older" as const,
      title: language.t("home.sessions.group.older"),
      sessions: records.filter((record) => day(record) !== today && day(record) !== yesterday),
    },
  ].filter((group) => group.sessions.length > 0)
}

// Compare calendar days in local time, including across daylight-saving changes.
function localDay(date: Date) {
  return date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate()
}
