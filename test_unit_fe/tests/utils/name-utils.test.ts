import { describe, expect, it } from "vitest"

import {
  hasInsufficientPersonNameLetters,
  looksLikeIncompletePersonName,
  normalizePersonName,
  SHORT_PERSON_NAME_WARNING,
} from "@/lib/utils/name-utils"

describe("normalizePersonName", () => {
  it("title-cases hyphenated and apostrophe names", () => {
    expect(normalizePersonName("mary-jane o'brien")).toBe("Mary-Jane O'Brien")
  })
})

describe("looksLikeIncompletePersonName", () => {
  it("ignores empty values (required validation handles those)", () => {
    expect(looksLikeIncompletePersonName("")).toBe(false)
    expect(looksLikeIncompletePersonName("   ")).toBe(false)
    expect(looksLikeIncompletePersonName(null)).toBe(false)
  })

  it("flags one- and two-letter names", () => {
    expect(looksLikeIncompletePersonName("A")).toBe(true)
    expect(looksLikeIncompletePersonName("Jo")).toBe(true)
    expect(looksLikeIncompletePersonName("al")).toBe(true)
  })

  it("flags punctuation-only placeholders", () => {
    expect(looksLikeIncompletePersonName(".")).toBe(true)
    expect(looksLikeIncompletePersonName("..")).toBe(true)
    expect(looksLikeIncompletePersonName("-")).toBe(true)
  })

  it("allows typical full names", () => {
    expect(looksLikeIncompletePersonName("John")).toBe(false)
    expect(looksLikeIncompletePersonName("O'Brien")).toBe(false)
    expect(looksLikeIncompletePersonName("Mary-Jane")).toBe(false)
  })

  it("exposes soft-warning copy", () => {
    expect(SHORT_PERSON_NAME_WARNING.toLowerCase()).toContain("full")
  })
})

describe("hasInsufficientPersonNameLetters", () => {
  it("rejects single-letter and punctuation-only names", () => {
    expect(hasInsufficientPersonNameLetters("A")).toBe(true)
    expect(hasInsufficientPersonNameLetters(".")).toBe(true)
    expect(hasInsufficientPersonNameLetters("K.")).toBe(true)
  })

  it("allows two-letter and longer names (warn-only on FE)", () => {
    expect(hasInsufficientPersonNameLetters("Jo")).toBe(false)
    expect(hasInsufficientPersonNameLetters("John")).toBe(false)
  })
})
