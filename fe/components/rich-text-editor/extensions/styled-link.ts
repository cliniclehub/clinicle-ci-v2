import { mergeAttributes } from "@tiptap/core"
import { Link } from "@tiptap/extension-link"

function isEmailButtonStyle(style: string | null | undefined): boolean {
  return !!style && /background/i.test(style)
}

/** Ensure CTA links always carry white label text (matches email preview). */
export function normalizeEmailButtonStyle(style: string): string {
  const withoutColor = style.replace(/(?:^|;\s*)color\s*:\s*[^;]+/gi, "")
  const trimmed = withoutColor.replace(/;\s*$/, "").trim()
  return trimmed ? `${trimmed};color:#ffffff` : "color:#ffffff"
}

function withEmailButtonClass(existingClass: string | null | undefined): string {
  if (!existingClass) return "email-cta-button"
  return existingClass.split(/\s+/).includes("email-cta-button")
    ? existingClass
    : `${existingClass} email-cta-button`
}

/**
 * Link extension that preserves inline `style` on <a> tags (email CTA buttons)
 * and normalizes button label color for editor + sent HTML.
 */
export const StyledLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: (element) => {
          const style = element.getAttribute("style")
          if (!style) return null
          return isEmailButtonStyle(style) ? normalizeEmailButtonStyle(style) : style
        },
        renderHTML: (attributes) => {
          if (!attributes.style) return {}
          const style = isEmailButtonStyle(attributes.style)
            ? normalizeEmailButtonStyle(attributes.style)
            : attributes.style
          return { style }
        },
      },
      class: {
        default: null,
        parseHTML: (element) => {
          const style = element.getAttribute("style")
          const existing = element.getAttribute("class")
          if (isEmailButtonStyle(style)) {
            return withEmailButtonClass(existing)
          }
          return existing
        },
        renderHTML: (attributes) => {
          if (!attributes.class) return {}
          return { class: attributes.class }
        },
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = { ...HTMLAttributes }

    if (isEmailButtonStyle(typeof attrs.style === "string" ? attrs.style : null)) {
      attrs.style = normalizeEmailButtonStyle(String(attrs.style))
      attrs.class = withEmailButtonClass(
        typeof attrs.class === "string" ? attrs.class : null
      )
    }

    return ["a", mergeAttributes(this.options.HTMLAttributes, attrs), 0]
  },
})
