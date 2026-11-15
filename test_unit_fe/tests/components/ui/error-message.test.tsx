import { describe, expect, it, vi } from "vitest"

import { ErrorMessage } from "@/components/ui/error-message"

import { render, screen, userEvent } from "@/test-utils/render"

describe("ErrorMessage", () => {
  it("shows title and message", () => {
    render(<ErrorMessage message="Something went wrong" />)
    expect(screen.getByText("Error")).toBeInTheDocument()
    expect(screen.getByText("Something went wrong")).toBeInTheDocument()
  })

  it("uses custom title", () => {
    render(<ErrorMessage title="Payment failed" message="Card declined" />)
    expect(screen.getByText("Payment failed")).toBeInTheDocument()
  })

  it("calls onDismiss when dismiss control is clicked", async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<ErrorMessage message="Retry later" onDismiss={onDismiss} />)

    await user.click(screen.getByRole("button"))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
