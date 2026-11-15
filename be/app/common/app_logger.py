import logging
import socket
import sys
from datetime import datetime, timezone
from contextvars import ContextVar

from pythonjsonlogger import jsonlogger

from app.common.config import LOG_LEVEL, ENVIRONMENT, SERVICE_NAME, LOG_JSON


# Context variable for request-scoped trace ID
request_trace_id: ContextVar[str] = ContextVar('request_trace_id', default='')


# ANSI color codes for terminal output
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    
    # Log level colors
    DEBUG = "\033[36m"      # Cyan
    INFO = "\033[32m"       # Green
    WARNING = "\033[33m"    # Yellow
    ERROR = "\033[31m"      # Red
    CRITICAL = "\033[35m"   # Magenta
    
    # Field colors
    TIMESTAMP = "\033[90m"  # Gray
    LOGGER = "\033[34m"     # Blue
    TRACE = "\033[95m"      # Light magenta
    MESSAGE = "\033[97m"    # White


class HumanReadableFormatter(logging.Formatter):
    """
    Human-readable colored formatter for local development.
    
    Output format:
    21:39:09 DEBUG  [eea0dfd5] app.main.log_requests_and_responses
       → Request: GET /api/v1/organizations/get-white-label-data-by-domain
    """
    
    LEVEL_COLORS = {
        'DEBUG': Colors.DEBUG,
        'INFO': Colors.INFO,
        'WARNING': Colors.WARNING,
        'ERROR': Colors.ERROR,
        'CRITICAL': Colors.CRITICAL,
    }
    
    def format(self, record):
        # Get trace ID
        trace_id = request_trace_id.get()
        trace_str = f"[{trace_id}] " if trace_id else ""
        
        # Color for level
        level_color = self.LEVEL_COLORS.get(record.levelname, Colors.RESET)
        
        # Time (just HH:MM:SS for readability)
        time_str = datetime.now().strftime("%H:%M:%S")
        
        # Short logger name (last 2 parts)
        logger_parts = record.name.split('.')
        if len(logger_parts) > 2:
            short_logger = '.'.join(logger_parts[-2:])
        else:
            short_logger = record.name
        
        # Format the message
        # Check if message contains newlines (like JSON body dumps)
        message = record.getMessage()
        if '\n' in message:
            # Indent multiline messages
            lines = message.split('\n')
            first_line = lines[0]
            rest_lines = '\n'.join(f"       {line}" for line in lines[1:])
            formatted_message = f"{first_line}\n{Colors.DIM}{rest_lines}{Colors.RESET}"
        else:
            formatted_message = message
        
        # Build the log line
        output = (
            f"{Colors.TIMESTAMP}{time_str}{Colors.RESET} "
            f"{level_color}{record.levelname:7}{Colors.RESET} "
            f"{Colors.TRACE}{trace_str}{Colors.RESET}"
            f"{Colors.LOGGER}{short_logger}{Colors.RESET}\n"
            f"   → {Colors.MESSAGE}{formatted_message}{Colors.RESET}"
        )
        
        # Add exception info if present
        if record.exc_info:
            output += f"\n{Colors.ERROR}{self.formatException(record.exc_info)}{Colors.RESET}"
        
        return output


class CustomJsonFormatter(jsonlogger.JsonFormatter):
    """
    Custom JSON formatter for production/container environments.
    
    Output format:
    {
        "timestamp": "2024-12-19T10:30:45.123456Z",
        "level": "INFO",
        "message": "User logged in",
        "logger": "app.v1.auth.services",
        "service": "platform-api",
        "environment": "production",
        "host": "web-abc123",
        "trace_id": "req-uuid-here"
    }
    """
    
    def add_fields(self, log_record, record, message_dict):
        super().add_fields(log_record, record, message_dict)
        
        # Timestamp in ISO 8601 format with UTC
        log_record['timestamp'] = datetime.now(timezone.utc).isoformat()
        
        # Standard fields
        log_record['level'] = record.levelname
        log_record['logger'] = record.name
        log_record['service'] = SERVICE_NAME
        log_record['environment'] = ENVIRONMENT
        log_record['host'] = socket.gethostname()
        
        # Request trace ID (if set via middleware)
        trace_id = request_trace_id.get()
        if trace_id:
            log_record['trace_id'] = trace_id
        
        # Include function/module info for debugging
        if record.funcName and record.funcName != '<module>':
            log_record['function'] = record.funcName
        
        # Include line number for errors
        if record.levelno >= logging.WARNING:
            log_record['line'] = record.lineno
            log_record['file'] = record.filename
        
        # Include exception info if present
        if record.exc_info:
            log_record['exception'] = self.formatException(record.exc_info)


class HostLogger(logging.Logger):
    """Logger with convenience methods for structured logging."""
    
    def get_method_logger(self, method_name: str) -> 'HostLogger':
        """Returns a child logger with method name for better logging context."""
        method_logger_name = f"{self.name}.{method_name}"
        method_logger = logging.getLogger(method_logger_name)
        
        if not isinstance(method_logger, HostLogger):
            method_logger.__class__ = HostLogger
        
        if not method_logger.handlers:
            method_logger.handlers = self.handlers[:]
            method_logger.setLevel(self.level)
            method_logger.propagate = False
        
        return method_logger  # type: ignore
    
    def log_with_context(self, level: int, msg: str, **kwargs):
        """Log with additional context fields."""
        self.log(level, msg, extra=kwargs)


def set_trace_id(trace_id: str):
    """Set the trace ID for the current request context."""
    request_trace_id.set(trace_id)


def get_trace_id() -> str:
    """Get the current trace ID."""
    return request_trace_id.get()


def get_logger(name: str) -> HostLogger:
    """Returns a configured logger with appropriate formatter based on environment."""
    logger = logging.getLogger(name)
    
    # Avoid duplicate handlers
    if logger.handlers:
        return logger  # type: ignore
    
    logger.propagate = False
    
    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(getattr(logging, LOG_LEVEL))
    
    # Choose formatter based on LOG_JSON setting
    if LOG_JSON:
        formatter = CustomJsonFormatter()
    else:
        formatter = HumanReadableFormatter()
    
    console_handler.setFormatter(formatter)
    
    logger.addHandler(console_handler)
    logger.setLevel(getattr(logging, LOG_LEVEL))
    
    return logger  # type: ignore


def _init_module():
    """Initialize the logging module."""
    logging.setLoggerClass(HostLogger)
    
    # Set root logger to higher level to prevent duplicate logs
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.WARNING)
    root_logger.handlers.clear()

    # Middleware already logs method/path/status/duration — drop uvicorn's duplicate access lines.
    logging.getLogger("uvicorn.access").disabled = True
    
    # Print startup info
    format_type = "JSON" if LOG_JSON else "Human-readable"
    print(f"📋 Logging initialized: {format_type} format, level={LOG_LEVEL}, env={ENVIRONMENT}")


# Initialize on import
_init_module()
