import { describe, expect, it } from "vitest"

import {
  formatDate,
  formatDateTime,
  fromDatetimeLocalToISO,
  getRelativeTime,
  isPastDate,
  isToday,
  toDatetimeLocalString,
} from "@/lib/utils/date-time-helper"

describe("date-time-helper", () => {
  it("formats dates and relative times", () => {
    expect(formatDate("")).toBe("")
    expect(formatDate("2024-06-15T00:00:00.000Z")).toMatch(/2024/)
    expect(formatDateTime("2024-06-15T12:00:00.000Z")).toMatch(/2024/)
    expect(getRelativeTime(new Date(Date.now() - 60_000))).toMatch(/ago|minute/)
    expect(isPastDate("2000-01-01T00:00:00.000Z")).toBe(true)
    expect(isToday(new Date())).toBe(true)
  })

  it("converts datetime-local values", () => {
    expect(toDatetimeLocalString("")).toBe("")
    const local = toDatetimeLocalString("2024-06-15T15:30:00.000Z")
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(fromDatetimeLocalToISO(local)).toMatch(/Z$/)
  })
})
