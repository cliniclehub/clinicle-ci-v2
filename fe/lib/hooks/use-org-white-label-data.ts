import { useOrgWhiteLabelContext } from "@/lib/contexts/org-white-label-context"

/** Reads org branding from the shared provider (single fetch per session). */
export function useOrgWhiteLabelData() {
  return useOrgWhiteLabelContext()
}
