import type React from "react"

interface ValidationTooltipProps {
  message: string
  show: boolean
  children: React.ReactNode
}

export function ValidationTooltip({ message, show, children }: ValidationTooltipProps) {
  return (
    <div className="relative">
      {children}
      {show && message && (
        <div className="absolute z-10 mt-1 animate-fade-in">
          <div className="bg-amber-100 border border-amber-200 rounded-md p-2 shadow-md relative">
            <div className="absolute -top-2 left-4 w-4 h-4 bg-amber-100 border-t border-l border-amber-200 transform rotate-45"></div>
            <div className="flex items-center">
              <div className="bg-amber-500 text-white rounded-full p-1 mr-2 flex-shrink-0">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                  <path d="M12 8v4" />
                  <path d="M12 16h.01" />
                </svg>
              </div>
              <span className="text-sm text-amber-800">{message}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
