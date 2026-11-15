"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog"
import { AlertCircle } from "lucide-react"

interface ErrorDialogProps {
  open: boolean
  onClose: () => void
  title?: string
  message: string
  retryAction?: () => void
}

export function ErrorDialog({ 
  open, 
  onClose, 
  title = "Error", 
  message,
  retryAction 
}: ErrorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-6 w-6" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {message}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <p className="text-base text-muted-foreground">
            {message}
          </p>
          {message.includes('contact support') && (
            <div className="mt-4 p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground">
                If this issue persists, please contact our support team at:
                <br />
                <a href="mailto:support@example.com" className="text-primary hover:underline">
                  support@example.com
                </a>
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="flex gap-2 sm:gap-0">
          {retryAction && (
            <Button variant="outline" onClick={retryAction} className="flex-1 sm:flex-none">
              Try Again
            </Button>
          )}
          <Button variant="default" onClick={onClose} className="flex-1 sm:flex-none">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
} 