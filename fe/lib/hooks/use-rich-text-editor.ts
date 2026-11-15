"use client"

import { useState, useCallback } from "react"

export function useRichTextEditor(initialContent = "") {
  const [content, setContent] = useState(initialContent)
  const [isModified, setIsModified] = useState(false)

  const handleChange = useCallback(
    (newContent: string) => {
      setContent(newContent)
      setIsModified(newContent !== initialContent)
    },
    [initialContent],
  )

  const resetContent = useCallback(() => {
    setContent(initialContent)
    setIsModified(false)
  }, [initialContent])

  const clearContent = useCallback(() => {
    setContent("")
    setIsModified(true)
  }, [])

  return {
    content,
    isModified,
    handleChange,
    resetContent,
    clearContent,
    setContent,
  }
}
