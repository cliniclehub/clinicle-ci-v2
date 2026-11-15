import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/utils/logger-server", () => ({
  createServerLogger: () => ({
    forMethod: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  }),
}))

vi.mock("@/lib/utils/auth-server-helper", () => ({
  getAuthTokenData: vi.fn(),
}))

import { getAuthTokenData } from "@/lib/utils/auth-server-helper"
import { EmailSenderHelper } from "@/lib/utils/email-sender-helper"

describe("email-sender-helper", () => {
  beforeEach(() => {
    vi.mocked(getAuthTokenData).mockReset()
  })

  it("sendEmail returns success stub", async () => {
    await expect(
      EmailSenderHelper.sendEmail({ to: "a@b.com", subject: "s", content: "c" })
    ).resolves.toEqual({ success: true })
  })

  it("sendTestEmail uses auth email then sends", async () => {
    vi.mocked(getAuthTokenData).mockResolvedValue({ email: "me@example.com" } as any)
    await expect(
      EmailSenderHelper.sendTestEmail({ to: "ignored", subject: "s", content: "c" })
    ).resolves.toEqual({ success: true })
  })
})
