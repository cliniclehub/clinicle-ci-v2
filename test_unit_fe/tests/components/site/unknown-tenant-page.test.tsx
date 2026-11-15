import { describe, expect, it } from "vitest"

import { UnknownTenantPage } from "@/components/site/unknown-tenant-page"
import { render, screen } from "@/test-utils/render"

describe("UnknownTenantPage", () => {
  it("explains that the host is not an organization and has no auth links", () => {
    render(<UnknownTenantPage hostname="anything.midad.co" />)

    expect(screen.getByRole("heading", { name: "This site isn't available" })).toBeInTheDocument()
    expect(screen.getByText(/anything\.midad\.co/)).toBeInTheDocument()
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })
})
