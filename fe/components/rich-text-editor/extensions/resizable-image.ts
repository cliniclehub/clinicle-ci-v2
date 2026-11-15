import { Node, mergeAttributes } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"

export interface ResizableImageOptions {
  inline: boolean
  allowBase64: boolean
  HTMLAttributes: Record<string, any>
}

/** Ensure email/browser links are absolute (www.zoom.com → https://www.zoom.com). */
export function normalizeExternalHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed
  if (trimmed.startsWith("//")) return `https:${trimmed}`
  // Bare domains / paths like www.zoom.com
  if (/^[a-z0-9.-]+\.[a-z]{2,}([/:].*)?$/i.test(trimmed)) {
    return `https://${trimmed}`
  }
  return trimmed
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    resizableImage: {
      /**
       * Add an image
       */
      setImage: (options: {
        src: string
        alt?: string
        title?: string
        width?: number
        height?: number
        href?: string | null
      }) => ReturnType
    }
  }
}

export const ResizableImage = Node.create<ResizableImageOptions>({
  name: "resizableImage",

  addOptions() {
    return {
      inline: false,
      allowBase64: false,
      HTMLAttributes: {},
    }
  },

  inline() {
    return this.options.inline
  },

  group() {
    return this.options.inline ? "inline" : "block"
  },

  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      href: {
        default: null,
        parseHTML: (element) => {
          const el = element as HTMLElement
          const img =
            el.tagName === "IMG" ? (el as HTMLImageElement) : el.querySelector("img")
          if (!img) return null
          return (
            normalizeExternalHref(img.getAttribute("data-href")) ||
            normalizeExternalHref(img.closest("a")?.getAttribute("href")) ||
            null
          )
        },
        // Persist on <img> so re-parse / Link extension cannot drop the URL.
        renderHTML: (attributes) => {
          const href = normalizeExternalHref(attributes.href)
          if (!href) return {}
          return { "data-href": href }
        },
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const width = element.style.width || element.getAttribute("width")
          return width ? Number.parseInt(width) : null
        },
        renderHTML: (attributes) => {
          if (!attributes.width) {
            return {}
          }
          return {
            width: attributes.width,
            style: `width: ${attributes.width}px`,
          }
        },
      },
      height: {
        default: null,
        parseHTML: (element) => {
          const height = element.style.height || element.getAttribute("height")
          return height ? Number.parseInt(height) : null
        },
        renderHTML: (attributes) => {
          if (!attributes.height) {
            return {}
          }
          return {
            height: attributes.height,
            style: `height: ${attributes.height}px`,
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: "a[href] > img[src]",
        getAttrs: (element) => {
          const img = element as HTMLImageElement
          const anchor = img.closest("a")
          if (!anchor) return false
          const width = img.style.width || img.getAttribute("width")
          const height = img.style.height || img.getAttribute("height")
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            title: img.getAttribute("title"),
            href:
              normalizeExternalHref(img.getAttribute("data-href")) ||
              normalizeExternalHref(anchor.getAttribute("href")),
            width: width ? Number.parseInt(width, 10) : null,
            height: height ? Number.parseInt(height, 10) : null,
          }
        },
      },
      {
        tag: this.options.allowBase64 ? "img[src]" : 'img[src]:not([src^="data:"])',
      },
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    const {
      textAlign,
      style: existingStyle,
      href: _ignoredHref,
      ...imgAttrs
    } = HTMLAttributes
    const linkHref =
      normalizeExternalHref(node.attrs.href) ||
      normalizeExternalHref(
        typeof HTMLAttributes["data-href"] === "string"
          ? HTMLAttributes["data-href"]
          : null
      )

    const imgStyle = [existingStyle, "max-width:100%;height:auto;border:0;display:block"]
      .filter(Boolean)
      .join(";")
    const img = [
      "img",
      mergeAttributes(this.options.HTMLAttributes, imgAttrs, {
        style: imgStyle,
        border: "0",
        ...(linkHref ? { "data-href": linkHref } : {}),
      }),
    ]

    // Email clients need a real <a href> wrapper when a link is set.
    const linked = linkHref
      ? (["a", { href: linkHref, target: "_blank", rel: "noopener noreferrer" }, img] as const)
      : img

    if (textAlign) {
      return ["div", { style: `text-align: ${textAlign}` }, linked]
    }
    return ["div", { class: "resizable-image-container" }, linked]
  },

  addCommands() {
    return {
      setImage:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              ...options,
              href: normalizeExternalHref(options.href) || null,
            },
          })
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("resizableImage"),
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target as HTMLElement

              // Find the image container - clicks on CSS ::after report as clicks on the container
              const container = target.classList.contains("resizable-image-container")
                ? (target as HTMLElement)
                : (target.closest(".resizable-image-container") as HTMLElement | null)

              if (!container) return false

              const rect = container.getBoundingClientRect()
              const x = event.clientX - rect.left
              const y = event.clientY - rect.top

              // Check if click is in the bottom-right corner (resize handle area)
              const isInResizeArea = x > rect.width - 20 && y > rect.height - 20

              if (!isInResizeArea) return false

              event.preventDefault()
              event.stopPropagation()

              const { state, dispatch } = view

              // Find the image node from DOM - don't rely on selection (it may not have updated yet on mousedown)
              const pos = view.posAtDOM(container, 0)
              const $pos = state.doc.resolve(pos)
              const nodeAfter = $pos.nodeAfter
              const imagePos = pos
              const imageNode = nodeAfter?.type.name === "resizableImage" ? nodeAfter : null

              if (!imageNode) return true

              const img = container.querySelector("img") as HTMLImageElement
              if (!img) return true

              const startX = event.clientX
              const startY = event.clientY
              const startWidth = img.offsetWidth
              const startHeight = img.offsetHeight
              const aspectRatio = startWidth / startHeight

              const handleMouseMove = (e: MouseEvent) => {
                const deltaX = e.clientX - startX
                const deltaY = e.clientY - startY

                // Use the larger delta to maintain aspect ratio
                const delta = Math.max(deltaX, deltaY)
                const newWidth = Math.max(50, startWidth + delta)
                const newHeight = newWidth / aspectRatio

                // Update the image size immediately for visual feedback
                img.style.width = `${newWidth}px`
                img.style.height = `${newHeight}px`
              }

              const handleMouseUp = (e: MouseEvent) => {
                document.removeEventListener("mousemove", handleMouseMove)
                document.removeEventListener("mouseup", handleMouseUp)

                const deltaX = e.clientX - startX
                const deltaY = e.clientY - startY
                const delta = Math.max(deltaX, deltaY)
                const newWidth = Math.max(50, startWidth + delta)
                const newHeight = newWidth / aspectRatio

                // Update the node attributes
                const currentState = view.state
                const currentNode = currentState.doc.nodeAt(imagePos)
                if (currentNode && currentNode.type.name === "resizableImage") {
                  const tr = currentState.tr.setNodeMarkup(imagePos, null, {
                    ...currentNode.attrs,
                    width: Math.round(newWidth),
                    height: Math.round(newHeight),
                  })
                  view.dispatch(tr)
                }
              }

              document.addEventListener("mousemove", handleMouseMove)
              document.addEventListener("mouseup", handleMouseUp)

              return true
            },
          },
        },
      }),
    ]
  },
})
