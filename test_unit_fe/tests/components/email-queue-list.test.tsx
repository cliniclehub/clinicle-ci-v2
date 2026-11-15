import { EmailQueueList } from "@/components/email-engine/email-queue-list"
import { getEmailQueue } from "@/lib/actions/email-engine/email-engine-actions"
import { render, screen } from "@/test-utils/render"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/actions/email-engine/email-engine-actions", () => ({
  getEmailQueue: vi.fn(),
  processEmailQueue: vi.fn(),
}))

vi.mock("@/components/email-engine/email-preview-dialog", () => ({
  EmailPreviewDialog: () => null,
}))

vi.mock("@/components/email-engine/template-variables-dialog", () => ({
  TemplateVariablesDialog: () => null,
}))

describe("EmailQueueList", () => {
  beforeEach(() => {
    vi.mocked(getEmailQueue).mockResolvedValue({
      status: "success",
      data: {
        queueItems: [
          {
            id: 1,
            organizationId: "5a9eaa0c-4251-4ede-a404-34c8fd05f4d2",
            toEmails: ["queued@example.com"],
            subject: "Queued email",
            fromEmail: "noreply@example.com",
            status: "pending",
            priority: 5,
            attempts: 0,
            maxAttempts: 3,
            createdAt: "2026-07-22T12:00:00.000Z",
            updatedAt: "2026-07-22T12:00:00.000Z",
          },
        ],
        totalCount: 1,
      },
      message: "Resources listed successfully",
      timestamp: "2026-07-22T12:00:00.000Z",
    })
  })

  it("renders queue items from the camelCase API response", async () => {
    render(<EmailQueueList />)

    expect(await screen.findByText("queued@example.com")).toBeInTheDocument()
    expect(screen.getByText("Queued email")).toBeInTheDocument()
    expect(screen.queryByText("No emails in queue")).not.toBeInTheDocument()
  })
})
