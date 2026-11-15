"use client"

import { AlertCircle, XCircle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "./alert"

interface ErrorMessageProps {
  title?: string
  message: string
  onDismiss?: () => void
}

export function ErrorMessage({ title = "Error", message, onDismiss }: ErrorMessageProps) {
  return (
    <Alert variant="destructive" className="mb-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between">
        {title}
        {onDismiss && (
          <button onClick={onDismiss} className="hover:opacity-80">
            <XCircle className="h-4 w-4" />
          </button>
        )}
      </AlertTitle>
      <AlertDescription>
        {message}
      </AlertDescription>
    </Alert>
  )
} 