import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fetchOrgWhiteLabelDataByDomain = vi.fn()
const getCurrentUser = vi.fn()

vi.mock("@/lib/actions/organizations/organizations-org-actions", () => ({
  fetchOrgWhiteLabelDataByDomain: (...args: unknown[]) =>
    fetchOrgWhiteLabelDataByDomain(...args),
}))

vi.mock("@/lib/actions/users/users-me-actions", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUser(...args),
}))

import {
  fetchOrgWhiteLabelDataCached,
  getCurrentUserCached,
  invalidateCurrentUserClientCache,
  invalidateOrgWhiteLabelClientCache,
} from "@/lib/utils/cached-client-requests"

describe("cached-client-requests", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"))
    invalidateOrgWhiteLabelClientCache()
    invalidateCurrentUserClientCache()
    fetchOrgWhiteLabelDataByDomain.mockReset()
    getCurrentUser.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("deduplicates concurrent org white-label fetches and caches TTL", async () => {
    let resolveFetch!: (value: { id: string }) => void
    fetchOrgWhiteLabelDataByDomain.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        })
    )

    const p1 = fetchOrgWhiteLabelDataCached()
    const p2 = fetchOrgWhiteLabelDataCached()
    expect(fetchOrgWhiteLabelDataByDomain).toHaveBeenCalledTimes(1)

    resolveFetch({ id: "org-1" })
    await expect(Promise.all([p1, p2])).resolves.toEqual([{ id: "org-1" }, { id: "org-1" }])

    await expect(fetchOrgWhiteLabelDataCached()).resolves.toEqual({ id: "org-1" })
    expect(fetchOrgWhiteLabelDataByDomain).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    fetchOrgWhiteLabelDataByDomain.mockResolvedValueOnce({ id: "org-2" })
    await expect(fetchOrgWhiteLabelDataCached()).resolves.toEqual({ id: "org-2" })
    expect(fetchOrgWhiteLabelDataByDomain).toHaveBeenCalledTimes(2)

    invalidateOrgWhiteLabelClientCache()
    fetchOrgWhiteLabelDataByDomain.mockResolvedValueOnce({ id: "org-3" })
    await expect(fetchOrgWhiteLabelDataCached()).resolves.toEqual({ id: "org-3" })
  })

  it("deduplicates concurrent profile fetches and caches TTL", async () => {
    let resolveProfile!: (value: { status: string; data: { id: string } }) => void
    getCurrentUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProfile = resolve
        })
    )

    const p1 = getCurrentUserCached()
    const p2 = getCurrentUserCached()
    expect(getCurrentUser).toHaveBeenCalledTimes(1)

    resolveProfile({ status: "success", data: { id: "u1" } })
    await expect(Promise.all([p1, p2])).resolves.toEqual([
      { status: "success", data: { id: "u1" } },
      { status: "success", data: { id: "u1" } },
    ])

    await expect(getCurrentUserCached()).resolves.toEqual({
      status: "success",
      data: { id: "u1" },
    })
    expect(getCurrentUser).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60 * 1000 + 1)
    getCurrentUser.mockResolvedValueOnce({
      status: "success",
      data: { id: "u2" },
    })
    await expect(getCurrentUserCached()).resolves.toEqual({
      status: "success",
      data: { id: "u2" },
    })

    invalidateCurrentUserClientCache()
    getCurrentUser.mockResolvedValueOnce({
      status: "success",
      data: { id: "u3" },
    })
    await expect(getCurrentUserCached()).resolves.toEqual({
      status: "success",
      data: { id: "u3" },
    })
  })
})
