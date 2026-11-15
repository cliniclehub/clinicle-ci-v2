'use client'

import { cn } from '@/lib/utils/cn'
import { createClientLogger } from '@/lib/utils/logger-client'
import { Expand, Maximize, Minimize, Shrink } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Document, Page, pdfjs } from 'react-pdf'
// AnnotationLayer.css imported in app/globals.css to ensure styles load before PDF viewer
// TextLayer CSS imported but renderTextLayer is false to prevent AbortException on unmount
import 'react-pdf/dist/Page/TextLayer.css'

// Set up PDF.js worker - using legacy build with explicit HTTPS
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/legacy/build/pdf.worker.min.mjs`
}

interface PDFViewerProps {
  url: string
  title: string
  showControls?: boolean // Whether to show the header controls
  className?: string // Additional CSS classes
  disableDownload?: boolean // Whether to disable the download button
  disablePrint?: boolean // Whether to disable the print button
  disableFullscreen?: boolean // Whether to disable the fullscreen button
}

export function PDFViewer({ 
  url, 
  title, 
  showControls = true,
  className = '',
  disableDownload = false,
  disablePrint = false,
  disableFullscreen = false
}: PDFViewerProps) {
  const logger = createClientLogger('PDFViewer')
  const [numPages, setNumPages] = useState<number>(0)
  const [scale, setScale] = useState<number>(1.0)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<boolean>(false)
  const [abortController, setAbortController] = useState<AbortController | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false)
  const [isMobileDevice, setIsMobileDevice] = useState(false)

  // Debug logging
  logger.info('PDFViewer mounted with props:', { url, title, showControls })
  logger.info('Initial state:', { loading, error, numPages })


  // Detect mobile - native Fullscreen API is unreliable on mobile (iOS Safari, Chrome)
  useEffect(() => {
    const check = () => {
      const ua = navigator.userAgent
      const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
      const mobile = /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua) || (touch && window.innerWidth < 1024)
      setIsMobileDevice(mobile)
    }
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Create new abort controller when URL changes
  useEffect(() => {
    // Abort any ongoing operations when URL changes
    if (abortController) {
      abortController.abort()
    }
    
    // Create new abort controller for new PDF
    const newController = new AbortController()
    setAbortController(newController)
    
    // Reset state for new PDF
    setNumPages(0)
    setLoading(true)
    setError(false)
    
    return () => {
      // Cleanup: abort any ongoing operations
      newController.abort()
    }
  }, [url])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortController) {
        abortController.abort()
      }
    }
  }, [abortController])

  // Track container width for responsive PDF sizing (mobile)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const updateWidth = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0) setContainerWidth(rect.width)
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Debug container layout and ensure grid layout
  useEffect(() => {
    const container = document.querySelector('.pdf-viewer-container') as HTMLElement
    if (container) {
      // Force grid layout
      container.style.display = 'grid'
      container.style.gridTemplateRows = 'auto 1fr'
      container.style.height = '100%'
      container.style.width = '100%'

      // Watch for layout changes
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            container.style.display = 'grid'
            container.style.gridTemplateRows = 'auto 1fr'
            container.style.height = '100%'
            container.style.width = '100%'
          }
        })
      })

      observer.observe(container, { attributes: true, attributeFilter: ['style'] })

      return () => observer.disconnect()
    }
  }, [])

  function onDocumentLoadSuccess({ numPages }: { numPages: number }) {
    logger.info('PDF loaded successfully with %s pages', numPages)
    setNumPages(numPages)
    setLoading(false)
    setError(false)
  }

  function onDocumentLoadError(error: Error) {
    // Ignore abort errors as they're expected during cleanup
    if (error.name === 'AbortError' || error.message.includes('aborted')) {
      logger.info('PDF loading aborted (expected during cleanup)')
      return
    }
    logger.error('PDF load error:', error)
    logger.error('Error details: ' + error.message)
    setLoading(false)
    setError(true)
  }

  function onDocumentLoadProgress(progress: { loaded: number; total: number }) {
    logger.info('PDF loading progress: ' + progress.loaded + '/' + progress.total)
  }

  const changeScale = useCallback((newScale: number) => {
    setScale(Math.min(Math.max(0.5, newScale), 3.0))
  }, [])

  const downloadPDF = useCallback(() => {
    const link = document.createElement('a')
    link.href = url
    link.download = title || 'document.pdf'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [url, title])

  const printPDF = useCallback(async () => {
    let objectUrl: string | null = null

    const printRenderedViewer = () => {
      const viewer = wrapperRef.current
      if (!viewer) {
        throw new Error('PDF viewer is not ready to print')
      }

      const style = document.createElement('style')
      style.setAttribute('data-pdf-print-style', 'true')
      style.textContent = `
        @media print {
          body * {
            visibility: hidden !important;
          }
          .pdf-viewer-print-root,
          .pdf-viewer-print-root * {
            visibility: visible !important;
          }
          .pdf-viewer-print-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
          }
          .pdf-viewer-print-root .pdf-viewer-toolbar {
            display: none !important;
          }
        }
      `
      viewer.classList.add('pdf-viewer-print-root')
      document.head.appendChild(style)

      const cleanupPrintStyles = () => {
        viewer.classList.remove('pdf-viewer-print-root')
        style.remove()
      }

      window.addEventListener('afterprint', cleanupPrintStyles, { once: true })
      window.print()
      window.setTimeout(cleanupPrintStyles, 1000)
    }

    try {
      const response = await fetch(url, {
        credentials: 'omit',
        headers: { Accept: 'application/pdf' },
      })
      if (!response.ok) {
        throw new Error(`Failed to load PDF for printing (${response.status})`)
      }

      const blob = await response.blob()
      objectUrl = URL.createObjectURL(blob)
      const printWindow = window.open(objectUrl, '_blank')
      if (printWindow) {
        printWindow.addEventListener('load', () => {
          printWindow.print()
        })
      } else {
        window.print()
      }
      if (objectUrl) {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl!), 60_000)
        objectUrl = null
      }
    } catch (error) {
      logger.warn(
        'Blob PDF print unavailable; using in-page viewer print fallback',
        error as Error
      )
      try {
        printRenderedViewer()
      } catch (fallbackError) {
        logger.error('Failed to print PDF', fallbackError as Error)
      }
    }
  }, [url, title, logger])

  const fitToPage = useCallback(() => {
    setScale(1.0)
  }, [])

  const fitToScreen = useCallback(() => {
    const container = containerRef.current ?? document.querySelector('.pdf-viewer-container')
    if (!container) return
    const w = container.clientWidth
    const h = container.clientHeight
    if (w < 200 || h < 200) return
    const padW = w < 640 ? 24 : 48
    const padH = w < 640 ? 60 : 100
    const availW = Math.max(200, w - padW)
    const availH = Math.max(300, h - padH)
    const scaleX = availW / 595
    const scaleY = availH / 842
    // Fit to page: scale so entire page fits within container (both width and height)
    const newScale = Math.max(0.5, Math.min(scaleX, scaleY, 2.5))
    setScale(newScale)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const el = wrapperRef.current
    if (!el) return

    const exitFullscreen = () => {
      if (isPseudoFullscreen) {
        setIsPseudoFullscreen(false)
        setIsFullscreen(false)
      } else {
        document.exitFullscreen().then(() => setIsFullscreen(false)).catch((err) => logger.error('Failed to exit fullscreen', err as Error))
      }
    }

    if (isFullscreen) {
      exitFullscreen()
      return
    }

    // On mobile: use pseudo-fullscreen (CSS overlay). Native API is unreliable on iOS Safari & mobile Chrome.
    if (isMobileDevice) {
      setIsPseudoFullscreen(true)
      setIsFullscreen(true)
      return
    }

    // Desktop: try native Fullscreen API first
    el.requestFullscreen().then(() => {
      setIsFullscreen(true)
      setIsPseudoFullscreen(false)
    }).catch(() => {
      setIsPseudoFullscreen(true)
      setIsFullscreen(true)
    })
  }, [logger, isFullscreen, isPseudoFullscreen, isMobileDevice])

  useEffect(() => {
    const handler = () => {
      // Only fires for native Fullscreen API; when in pseudo-fullscreen (iOS fallback) this won't fire
      setIsFullscreen(!!document.fullscreenElement)
      if (!document.fullscreenElement) setIsPseudoFullscreen(false)
    }
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // ESC to exit pseudo-fullscreen on iOS (native fullscreen uses browser's ESC handling)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPseudoFullscreen) {
        setIsPseudoFullscreen(false)
        setIsFullscreen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isPseudoFullscreen])

  // Prevent body scroll when in pseudo-fullscreen (iOS)
  useEffect(() => {
    if (isPseudoFullscreen) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [isPseudoFullscreen])

  // Default to fit to page (100%) on load and when dimensions change
  useEffect(() => {
    if (numPages === 0) return
    const runFit = () => {
      requestAnimationFrame(() => fitToPage())
    }
    runFit()
    const t1 = setTimeout(runFit, 150)
    const t2 = setTimeout(runFit, 500)
    const t3 = setTimeout(runFit, 1200)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [numPages, containerWidth, fitToPage])

  // Default to fit to page (100%) when entering fullscreen
  useEffect(() => {
    if (isFullscreen && numPages > 0) {
      const t = setTimeout(() => fitToPage(), 100)
      return () => clearTimeout(t)
    }
  }, [isFullscreen, numPages, fitToPage])

  // Memoize options to prevent unnecessary reloads
  const options = useMemo(() => ({
    cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
    standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
    httpHeaders: {
      'Accept': 'application/pdf',
    },
    withCredentials: false,
    // Disable text layer to prevent AbortException warnings
    disableTextLayer: true,
    // Add abort signal if available
    ...(abortController && { signal: abortController.signal }),
  }), [abortController])

  const pageWidth = containerWidth ? Math.max(200, Math.min(containerWidth - 32, 595 * 2)) : undefined

  const viewerContent = (
    <div
      ref={wrapperRef}
      className={cn(
        'w-full h-full min-h-0',
        isPseudoFullscreen && 'fixed inset-0 z-[9999] flex flex-col bg-background'
      )}
    >
      <div
        ref={containerRef}
        className={cn(
          'w-full max-w-full min-w-0 h-full bg-card rounded-lg shadow-lg border border-border pdf-viewer-container grid grid-rows-[auto_1fr] overflow-hidden',
          isPseudoFullscreen && 'rounded-none border-0 flex-1 min-h-0',
          className
        )}
        style={{
          display: 'grid',
          gridTemplateRows: 'auto 1fr',
          height: isPseudoFullscreen ? '100%' : '100%',
          width: '100%'
        }}
      >
      {/* PDF Viewer Header - Fixed */}
      {showControls && (
        <div className="pdf-viewer-toolbar bg-gray-800 dark:bg-gray-900 text-white rounded-t-lg shadow-lg px-2 py-1.5 flex flex-row flex-nowrap items-center gap-2 overflow-x-auto shrink-0">
          <div className="flex items-center min-w-0 shrink-0">
            <span className="font-medium text-xs">
              PDF
            </span>
          </div>

          <div className="flex items-center flex-1 flex-nowrap gap-1 overflow-x-auto justify-end min-w-0">
            {/* Page count */}
            {numPages > 0 && (
              <span className="shrink-0 text-xs px-1">
                {numPages} pages
              </span>
            )}
            
            {/* Zoom Controls */}
            <div className="flex items-center shrink-0 space-x-1">
              <button 
                onClick={() => changeScale(scale - 0.25)}
                disabled={scale <= 0.5}
                className="p-1 hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                title="Zoom out"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
              </button>
              <select 
                value={scale}
                onChange={(e) => changeScale(Number(e.target.value))}
                className="bg-gray-700 dark:bg-gray-800 text-white text-xs px-1.5 py-0.5 rounded border border-gray-600 dark:border-gray-700 hover:bg-gray-600 dark:hover:bg-gray-700"
              >
                <option value="0.5">50%</option>
                <option value="0.75">75%</option>
                <option value="1">100%</option>
                <option value="1.25">125%</option>
                <option value="1.5">150%</option>
                <option value="2">200%</option>
                <option value="3">300%</option>
              </select>
              <button 
                onClick={() => changeScale(scale + 0.25)}
                disabled={scale >= 3.0}
                className="p-1 hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                title="Zoom in"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
            
            {/* Action Buttons */}
            <div className="flex items-center shrink-0 gap-0.5">
              <button 
                onClick={fitToPage}
                className="p-1 hover:bg-gray-700 rounded" 
                title="Fit to page"
              >
                <Expand className="w-4 h-4" />
              </button>
              <button 
                onClick={fitToScreen}
                className="p-1 hover:bg-gray-700 rounded" 
                title="Fit to screen"
              >
                <Shrink className="w-4 h-4" />
              </button>
              {!disableFullscreen && (
                <button 
                  onClick={toggleFullscreen}
                  className="p-1 hover:bg-gray-700 rounded touch-manipulation" 
                  title={isFullscreen ? "Exit fullscreen (or press ESC)" : "Fullscreen"}
                  type="button"
                >
                  {isFullscreen ? (
                    <Minimize className="w-4 h-4" />
                  ) : (
                    <Maximize className="w-4 h-4" />
                  )}
                </button>
              )}
              {!disableDownload && (
                <button 
                  onClick={downloadPDF}
                  className="p-1 hover:bg-gray-700 rounded" 
                  title="Download"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </button>
              )}
              {!disablePrint && (
                <button 
                  onClick={printPDF}
                  className="p-1 hover:bg-gray-700 rounded" 
                  title="Print"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* PDF Content - Scrollable */}
      <div 
        className="w-full min-w-0 max-w-full bg-muted overflow-x-auto overflow-y-auto"
        style={{
          minHeight: '0',
          overflowY: 'auto'
        }}
      >
        <div className="flex justify-center min-w-0 max-w-full p-2 sm:p-4">
          {error && (
            <div className="flex items-center justify-center p-8 text-red-600">
              <svg className="w-8 h-8 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div className="text-center">
                <div className="font-semibold">Failed to load PDF</div>
                <div className="text-sm mt-1">URL: {url}</div>
                <div className="text-xs mt-2 text-muted-foreground">Check browser console for details</div>
              </div>
            </div>
          )}
          
          <Document
            key={`${url}-${abortController?.signal?.aborted ? 'aborted' : 'active'}`}
            file={url}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            onLoadProgress={onDocumentLoadProgress}
            onSourceError={(error) => {
              // Ignore abort errors as they're expected during cleanup
              if (error.name === 'AbortError' || error.message.includes('aborted')) {
                logger.info('PDF source loading aborted (expected during cleanup)')
                return
              }
              logger.error('Source error:', error)
              setError(true)
            }}
            onSourceSuccess={() => {
              logger.info('PDF source loaded successfully')
            }}
            options={options}
            loading={
              <div className="flex items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
                <span className="ml-2 text-muted-foreground">Loading PDF...</span>
              </div>
            }
            error={
              <div className="text-center p-8 text-red-600">
                <p>Failed to load PDF document</p>
              </div>
            }
          >
            <div className="w-full">
                {numPages > 0 ? (
                  Array.from({ length: numPages }, (_, index) => (
                      <div key={index + 1} className="mb-6 last:mb-0">
                        <div className="text-sm text-muted-foreground mb-2 text-center">Page {index + 1} of {numPages}</div>
                        <div className="flex justify-center overflow-hidden">
                          <Page
                            pageNumber={index + 1}
                            width={pageWidth ? pageWidth * scale : undefined}
                            scale={pageWidth ? undefined : scale}
                            rotate={0}
                            className="shadow-lg max-w-full"
                            renderTextLayer={false}
                            renderAnnotationLayer={true}
                            renderMode="canvas"
                            devicePixelRatio={window.devicePixelRatio || 1}
                            loading={
                              <div className="flex items-center justify-center p-4">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground"></div>
                              </div>
                            }
                          />
                        </div>
                      </div>
                  ))
                ) : (
                  <div className="text-center p-4 text-muted-foreground">
                    Loading pages... (numPages: {numPages})
                  </div>
                )}
            </div>
          </Document>
        </div>
      </div>
    </div>
    </div>
  )

  // Render pseudo-fullscreen overlay via portal so it escapes parent overflow/transforms (e.g. modals)
  if (isPseudoFullscreen && typeof document !== 'undefined') {
    return createPortal(viewerContent, document.body)
  }
  return viewerContent
} 