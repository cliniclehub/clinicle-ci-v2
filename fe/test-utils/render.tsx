import { render as rtlRender, type RenderOptions } from "@testing-library/react"
import type { ReactElement } from "react"

/** RTL render — extend here with providers (theme, auth) when needed. */
export function render(ui: ReactElement, options?: RenderOptions) {
  return rtlRender(ui, options)
}

export * from "@testing-library/react"
export { default as userEvent } from "@testing-library/user-event"
