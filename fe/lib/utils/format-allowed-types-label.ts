export interface UrlFileTypeOption {
  value: string
  label: string
}

const URL_FILE_TYPE_CATALOG: UrlFileTypeOption[] = [
  { value: "image/*", label: "Image" },
  { value: "video/*", label: "Video (MP4, MPEG, WebM, …)" },
  { value: "audio/*", label: "Audio" },
  { value: "application/pdf", label: "PDF" },
  { value: "text/*", label: "Text" },
]

function mimeTypeOptionLabel(mime: string): string {
  const type = mime.trim().toLowerCase()
  if (type === "image/*" || type.startsWith("image/")) return "Image"
  if (type === "video/*" || type.startsWith("video/")) return "Video (MP4, MPEG, WebM, …)"
  if (type === "audio/*" || type.startsWith("audio/")) return "Audio"
  if (type === "application/pdf" || type.endsWith("/pdf")) return "PDF"
  if (type === "text/*" || type.startsWith("text/")) return "Text"
  const subtype = type.split("/")[1]
  return subtype ? subtype.toUpperCase() : mime
}

/** MIME options for the Enter URL tab, filtered by `allowedTypes`. */
export function getUrlFileTypeOptions(allowedTypes: string[]): UrlFileTypeOption[] {
  if (!allowedTypes.length || allowedTypes.includes("*/*")) {
    return [...URL_FILE_TYPE_CATALOG]
  }

  const fromCatalog = URL_FILE_TYPE_CATALOG.filter((opt) => allowedTypes.includes(opt.value))
  const extras = allowedTypes
    .filter((t) => t !== "*/*" && !fromCatalog.some((o) => o.value === t))
    .map((t) => ({ value: t, label: mimeTypeOptionLabel(t) }))

  return [...fromCatalog, ...extras]
}

export function getDefaultUrlFileType(allowedTypes: string[]): string {
  const options = getUrlFileTypeOptions(allowedTypes)
  return options[0]?.value ?? "application/octet-stream"
}

export function isUrlFileTypeAllowed(fileType: string, allowedTypes: string[]): boolean {
  if (!allowedTypes.length || allowedTypes.includes("*/*")) return true
  return allowedTypes.includes(fileType)
}

export function getUrlTabPlaceholders(allowedTypes: string[]): {
  url: string
  fileName: string
  description: string
} {
  const options = getUrlFileTypeOptions(allowedTypes)
  const only = options.length === 1 ? options[0].value : null

  if (only === "application/pdf") {
    return {
      url: "https://example.com/document.pdf",
      fileName: "document.pdf",
      description: "Add a PDF from an external URL",
    }
  }
  if (only === "video/*") {
    return {
      url: "https://example.com/video.mp4",
      fileName: "video.mp4",
      description: "Add a video from an external URL (MP4, MPEG, WebM, etc.)",
    }
  }
  if (only === "audio/*") {
    return {
      url: "https://example.com/audio.mp3",
      fileName: "audio.mp3",
      description: "Add audio from an external URL",
    }
  }
  if (only === "image/*") {
    return {
      url: "https://example.com/image.jpg",
      fileName: "image.jpg",
      description: "Add an image from an external URL",
    }
  }

  return {
    url: "https://example.com/media.file",
    fileName: "media.file",
    description: "Add a media file from an external URL",
  }
}

/**
 * Human-readable label for file-picker `accept` / allowedTypes lists.
 */
export function formatAllowedTypesLabel(allowedTypes: string[]): string {
  if (!allowedTypes.length || allowedTypes.includes("*/*")) {
    return "All file types are supported"
  }

  const labels: string[] = []
  const seen = new Set<string>()

  const add = (label: string) => {
    if (!seen.has(label)) {
      seen.add(label)
      labels.push(label)
    }
  }

  for (const raw of allowedTypes) {
    const type = raw.trim().toLowerCase()
    if (!type || type === "*/*") {
      return "All file types are supported"
    }
    if (type === "image/*" || type.startsWith("image/")) {
      add("Images")
    } else if (type === "video/*" || type.startsWith("video/")) {
      add("Videos")
    } else if (type === "audio/*" || type.startsWith("audio/")) {
      add("Audio")
    } else if (type === "application/pdf" || type.endsWith("/pdf")) {
      add("PDF")
    } else if (type === "text/*" || type.startsWith("text/")) {
      add("Text")
    } else {
      const subtype = type.split("/")[1]
      add(subtype ? subtype.toUpperCase() : raw)
    }
  }

  if (labels.length === 0) {
    return "See accepted file types for this upload"
  }
  if (labels.length === 1) {
    return `Supported format: ${labels[0]}`
  }
  return `Supported formats: ${labels.join(", ")}`
}
