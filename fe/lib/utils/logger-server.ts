/**
 * Server-side Logger - For Node.js environment (Next.js server actions, API routes)
 * 
 * Logs to console only (stdout/stderr).
 * Supports JSON format for production and human-readable format for development.
 */

import {
  getLoggingEnvironment,
  getServerLogLevel,
} from "@/lib/utils/log-config"

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4
}

// Configuration from environment (aligned with backend three-knob model for level)
const LOG_LEVEL = getServerLogLevel()
const LOG_JSON = process.env.LOG_JSON === 'true'
// Environment: local, integration, test, production
const ENVIRONMENT = getLoggingEnvironment()
const SERVICE_NAME = process.env.SERVICE_NAME || 'platform-fe'
// Max length before truncating. 0 = no truncation. In local/dev, default to 100000 for full debug output.
const LOG_TRUNCATE_LIMIT = (() => {
  const envVal = process.env.LOG_TRUNCATE_LIMIT
  if (envVal !== undefined && envVal !== '') {
    const num = parseInt(envVal, 10)
    return isNaN(num) ? 5000 : num
  }
  return ENVIRONMENT === 'local' || ENVIRONMENT === 'development' ? 100000 : 5000
})()

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

// ANSI colors for terminal
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  debug: '\x1b[36m',   // cyan
  info: '\x1b[32m',    // green
  warn: '\x1b[33m',    // yellow
  error: '\x1b[31m',   // red
  fatal: '\x1b[35m',   // magenta
  timestamp: '\x1b[90m', // gray
  logger: '\x1b[34m',  // blue
}

const levelNames: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.FATAL]: 'FATAL',
}

const levelColors: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: colors.debug,
  [LogLevel.INFO]: colors.info,
  [LogLevel.WARN]: colors.warn,
  [LogLevel.ERROR]: colors.error,
  [LogLevel.FATAL]: colors.fatal,
}

interface LogPayload {
  timestamp: string
  level: string
  message: string
  logger: string
  service: string
  environment: string
  host?: string
  function?: string
  data?: unknown
  error?: string
  stack?: string
  file?: string
  line?: number
}

// Get hostname (cached)
let cachedHostname: string | undefined
function getHostname(): string {
  if (cachedHostname) return cachedHostname
  try {
    cachedHostname = require('os').hostname()
  } catch {
    cachedHostname = 'unknown'
  }
  return cachedHostname || 'unknown'
}

class ServerLogger {
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
    const payload: LogPayload = {
      timestamp: new Date().toISOString(),
      level: levelNames[level],
      message,
      logger: this.getLoggerName(),
      service: SERVICE_NAME,
      environment: ENVIRONMENT,
      host: getHostname(),
      function: this.methodName,
    }

    if (data !== undefined) {
      payload.data = data
    }

    if (error) {
      payload.error = error.message
      payload.stack = error.stack
    }

    return payload
  }

  private safeConsoleLog(level: LogLevel, output: string): void {
    // Ensure output is a safe string and sanitize it
    let safeOutput: string
    try {
      safeOutput = typeof output === 'string' ? output : String(output || '[Empty log message]')
      // Remove any problematic characters that might break console methods
      safeOutput = safeOutput.replace(/\0/g, '') // Remove null bytes
      // Limit length to prevent memory issues (0 = no truncation)
      if (LOG_TRUNCATE_LIMIT > 0 && safeOutput.length > LOG_TRUNCATE_LIMIT) {
        safeOutput = safeOutput.substring(0, LOG_TRUNCATE_LIMIT) + '...[truncated]'
      }
    } catch {
      safeOutput = '[Logger: Failed to format output]'
    }

    // Check if console is available
    if (typeof console === 'undefined' || !console) {
      return
    }

    // For ERROR and FATAL levels, use console.log as the safest option
    // This avoids issues with console.error in some environments
    if (level === LogLevel.ERROR || level === LogLevel.FATAL) {
      // Always use console.log for errors to avoid crashes
      try {
        if (console.log && typeof console.log === 'function') {
          // Split into smaller chunks if too long
          if (safeOutput.length > 1000) {
            const chunks = safeOutput.match(/.{1,1000}/g) || [safeOutput]
            console.log('[ERROR]', chunks[0])
            if (chunks.length > 1) {
              chunks.slice(1).forEach(chunk => {
                try {
                  console.log(chunk)
                } catch {
                  // Ignore chunk errors
                }
              })
            }
          } else {
            console.log('[ERROR]', safeOutput)
          }
        }
      } catch {
        // Completely silent failure
      }
      return
    }

    // For other levels, use appropriate console methods
    try {
      switch (level) {
        case LogLevel.DEBUG:
          if (console.debug && typeof console.debug === 'function') {
            try {
              console.debug(safeOutput)
            } catch {
              if (console.log) console.log('[DEBUG]', safeOutput.substring(0, 500))
            }
          }
          break
        case LogLevel.INFO:
          if (console.info && typeof console.info === 'function') {
            try {
              console.info(safeOutput)
            } catch {
              if (console.log) console.log('[INFO]', safeOutput.substring(0, 500))
            }
          }
          break
        case LogLevel.WARN:
          if (console.warn && typeof console.warn === 'function') {
            try {
              console.warn(safeOutput)
            } catch {
              if (console.log) console.log('[WARN]', safeOutput.substring(0, 500))
            }
          }
          break
      }
    } catch (outerError) {
      // Last resort: try to log a minimal message
      try {
        if (console && console.log && typeof console.log === 'function') {
          console.log('[Logger]', levelNames[level] || 'LOG', safeOutput.substring(0, 200))
        }
      } catch {
        // Completely silent failure - nothing we can do
      }
    }
  }

  private log(level: LogLevel, message: string, data?: unknown, error?: Error): void {
    if (!this.shouldLog(level)) return

    try {
      const payload = this.formatPayload(level, message, data, error)

      if (LOG_JSON) {
        // JSON format for production/container logs
        let output: string
        try {
          output = JSON.stringify(payload)
        } catch (e) {
          // Fallback if JSON.stringify fails (circular reference, etc.)
          output = JSON.stringify({
            timestamp: payload.timestamp,
            level: payload.level,
            message: String(message),
            logger: payload.logger,
            error: 'Failed to stringify payload'
          })
        }
        
        // Ensure output is a valid string
        if (typeof output !== 'string') {
          output = String(output || '')
        }
        
        // Additional safety: ensure output is not empty and is a valid string
        const safeOutput = output || '[Empty log message]'
        
        // Safely log to console with multiple fallbacks
        this.safeConsoleLog(level, safeOutput)
      } else {
        // Human-readable format for development
        const time = new Date().toLocaleTimeString('en-US', { hour12: false })
        const levelStr = levelNames[level].padEnd(5)
        const levelColor = levelColors[level]
        const loggerShort = this.getLoggerName().split('.').slice(-2).join('.')
        
        // First line: timestamp, level, logger
        let output = `${colors.timestamp}${time}${colors.reset} `
        output += `${levelColor}${levelStr}${colors.reset} `
        output += `${colors.logger}${loggerShort}${colors.reset}\n`
        
        // Second line: message
        output += `   → ${String(message || '')}`
        
        // Data on separate lines if present
        if (data !== undefined) {
          try {
            const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data)
            const indentedData = dataStr.split('\n').map(line => `      ${line}`).join('\n')
            output += `\n   📦 Data:\n${colors.dim}${indentedData}${colors.reset}`
          } catch (e) {
            output += `\n   📦 Data: [Unable to stringify data]`
          }
        }
        
        // Error info
        if (error) {
          const errorMessage = error?.message || String(error || 'Unknown error')
          output += `\n   ${colors.error}❌ Error: ${errorMessage}${colors.reset}`
          if (error.stack) {
            try {
              const stackLines = error.stack.split('\n').slice(1, 4).map(line => `      ${line.trim()}`).join('\n')
              output += `\n${colors.dim}${stackLines}${colors.reset}`
            } catch (e) {
              // Ignore stack trace formatting errors
            }
          }
        }
        
        // Ensure output is a valid string before logging
        if (typeof output !== 'string') {
          output = String(output || '')
        }
        
        // Additional safety: ensure output is not empty and is a valid string
        const safeOutput = output || '[Empty log message]'
        
        // Safely log to console with multiple fallbacks
        this.safeConsoleLog(level, safeOutput)
      }
    } catch (logError) {
      // Fallback: if logging itself fails, use basic console.error
      try {
        console.error('[Logger Error]', String(message || ''), logError)
      } catch {
        // If even basic console.error fails, silently fail
      }
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

  forMethod(methodName: string): ServerLogger {
    return new ServerLogger(this.className, methodName)
  }
}

export function createServerLogger(className: string, methodName?: string): ServerLogger {
  return new ServerLogger(className, methodName)
}

// Export LogPayload type for compatibility
export type { LogPayload }
