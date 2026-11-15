/**
 * Client-side Logger - For browser environment
 * 
 * Logs to browser console only.
 * Supports JSON format for production and human-readable format for development.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4
}

// Configuration from environment
const LOG_LEVEL = (process.env.NEXT_PUBLIC_LOG_LEVEL || 'DEBUG').toUpperCase()
const LOG_JSON = process.env.NEXT_PUBLIC_LOG_JSON === 'true'
// Environment: local, integration, test, production
const ENVIRONMENT = process.env.NEXT_PUBLIC_ENVIRONMENT || 'local'
const SERVICE_NAME = 'platform-fe'

// Map string to LogLevel enum
function getLogLevelFromString(level: string): LogLevel {
  switch (level.toUpperCase()) {
    case 'DEBUG': return LogLevel.DEBUG
    case 'INFO': return LogLevel.INFO
    case 'WARN': return LogLevel.WARN
    case 'ERROR': return LogLevel.ERROR
    case 'FATAL': return LogLevel.FATAL
    default: return LogLevel.DEBUG
  }
}

const minLevel = getLogLevelFromString(LOG_LEVEL)

// Colors for browser console
const levelColors: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'color: #06b6d4; font-weight: bold',  // cyan
  [LogLevel.INFO]: 'color: #22c55e; font-weight: bold',   // green
  [LogLevel.WARN]: 'color: #eab308; font-weight: bold',   // yellow
  [LogLevel.ERROR]: 'color: #ef4444; font-weight: bold',  // red
  [LogLevel.FATAL]: 'background: #ef4444; color: white; font-weight: bold',
}

const levelNames: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL',
}

// Safe JSON stringify that handles circular references
function safeStringify(obj: unknown): string {
  const seen = new WeakSet()
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'
      }
      seen.add(value)
      
      // Handle DOM elements
      if (typeof Element !== 'undefined' && value instanceof Element) {
        return `[DOM: ${value.tagName}]`
      }
    }
    return value
  })
}

interface LogPayload {
  timestamp: string
  level: string
  message: string
  logger: string
  service: string
  environment: string
  function?: string
  data?: unknown
  error?: string
  stack?: string
}

class ClientLogger {
  private className: string
  private methodName?: string

  constructor(className: string, methodName?: string) {
    this.className = className
    this.methodName = methodName
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= minLevel
  }

  private getLoggerName(): string {
    return this.methodName ? `${this.className}.${this.methodName}` : this.className
  }

  private formatPayload(level: LogLevel, message: string, data?: unknown, error?: Error): LogPayload {
    return {
      timestamp: new Date().toISOString(),
      level: levelNames[level],
      message,
      logger: this.getLoggerName(),
      service: SERVICE_NAME,
      environment: ENVIRONMENT,
      function: this.methodName,
      data: data,
      error: error?.message,
      stack: error?.stack,
    }
  }

  private log(level: LogLevel, message: string, data?: unknown, error?: Error): void {
    if (!this.shouldLog(level)) return

    const payload = this.formatPayload(level, message, data, error)

    if (LOG_JSON) {
      // JSON format for production/aggregation
      const jsonOutput = safeStringify(payload)
      switch (level) {
        case LogLevel.DEBUG: console.debug(jsonOutput); break
        case LogLevel.INFO: console.info(jsonOutput); break
        case LogLevel.WARN: console.warn(jsonOutput); break
        case LogLevel.ERROR:
        case LogLevel.FATAL: console.error(jsonOutput); break
      }
    } else {
      // Human-readable format for development
      const time = new Date().toLocaleTimeString('en-US', { hour12: false })
      const levelStr = levelNames[level].padEnd(5)
      const loggerShort = this.getLoggerName().split('.').slice(-2).join('.')
      
      const prefix = `${time} ${levelStr} ${loggerShort}`
      
      // Use console groups for better readability
      console.groupCollapsed(`%c${prefix}%c ${message}`, levelColors[level], 'color: inherit')
      
      if (data !== undefined) {
        console.log('📦 Data:', data)
      }
      if (error) {
        console.error('❌ Error:', error.message)
        if (error.stack) {
          console.log('📚 Stack:', error.stack)
        }
      }
      
      console.groupEnd()
    }
  }

  debug(message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, data)
  }

  info(message: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, data)
  }

  warn(message: string, data?: unknown): void {
    this.log(LogLevel.WARN, message, data)
  }

  error(message: string, error?: Error, data?: unknown): void {
    this.log(LogLevel.ERROR, message, data, error)
  }

  fatal(message: string, error?: Error, data?: unknown): void {
    this.log(LogLevel.FATAL, message, data, error)
  }

  forMethod(methodName: string): ClientLogger {
    return new ClientLogger(this.className, methodName)
  }
}

export function createClientLogger(className: string, methodName?: string): ClientLogger {
  return new ClientLogger(className, methodName)
}
