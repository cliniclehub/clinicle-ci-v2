import { describe, expect, it, vi } from "vitest"

import { AppVersionLabel } from "@/components/site/app-version-label"

import { render, screen } from "@/test-utils/render"

vi.mock("@/lib/build-info", () => ({
  formatAppVersionLabel: vi.fn(),
}))

import { formatAppVersionLabel } from "@/lib/build-info"

describe("AppVersionLabel", () => {
  it("renders nothing when build info is unavailable", () => {
    vi.mocked(formatAppVersionLabel).mockReturnValue(null)
    const { container } = render(<AppVersionLabel />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows formatted release label", () => {
    vi.mocked(formatAppVersionLabel).mockReturnValue("v1.2.3 · abc123")
    render(<AppVersionLabel />)
    expect(screen.getByText("v1.2.3 · abc123")).toBeInTheDocument()
  })
})
