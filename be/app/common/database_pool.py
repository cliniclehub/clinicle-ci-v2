"""
Database connection pooling configuration for the platform backend.
Implements proper connection pooling to prevent connection exhaustion.
"""

import os
from app.common.app_logger import get_logger
from typing import Generator, Optional
from contextlib import contextmanager
from datetime import timedelta

from sqlalchemy import create_engine, event, pool, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.exc import DBAPIError, DisconnectionError, TimeoutError
from sqlalchemy.pool import NullPool, QueuePool, StaticPool

from .config import DATABASE_URL, ENVIRONMENT, POOL_CLASS, POOL_SIZE, MAX_OVERFLOW, POOL_TIMEOUT, POOL_RECYCLE, POOL_PRE_PING, ECHO, ECHO_POOL, CONNECT_TIMEOUT, STATEMENT_TIMEOUT_MS

# Pool class mapping
POOL_CLASS_MAP = {
    "QueuePool": QueuePool,
    "StaticPool": StaticPool,
    "NullPool": NullPool
}

class_logger = get_logger(__name__)

# Connection pool configuration based on environment
def get_pool_config():
 
    """
    Returns connection pool configuration based on environment.
    
    Production: Larger pool for handling concurrent requests
    Test: Medium pool for test isolation
    Development: Smaller pool for local development
    Unittest: Static pool for test isolation
    """
    if ENVIRONMENT  == "unittest":
        return {
            "poolclass": StaticPool,   # Use static pool for tests
            "connect_args": {
                "check_same_thread": False  # For SQLite in tests
            },
            "echo": False,
            "echo_pool": False,
        }
    else:  # development, test, production
        return {
            "poolclass": POOL_CLASS_MAP.get(POOL_CLASS, QueuePool),
            "pool_size": POOL_SIZE,            
            "max_overflow": MAX_OVERFLOW,        
            "pool_timeout": POOL_TIMEOUT,       
            "pool_recycle": POOL_RECYCLE,      
            "pool_pre_ping": POOL_PRE_PING,   
            "echo": ECHO,             
            "echo_pool": ECHO_POOL,       
        }

# Get pool configuration
pool_config = get_pool_config()

# Create engine with connection pooling
engine = create_engine(
    DATABASE_URL,
    **pool_config,
    # Additional engine configuration
    connect_args={
        "connect_timeout": CONNECT_TIMEOUT,  
        "application_name": f"app_{ENVIRONMENT}",  # Identify connections in pg_stat_activity
        "options": f"-c statement_timeout={STATEMENT_TIMEOUT_MS} -c timezone=UTC"  # ms; store/compare timestamps in UTC
    } if "postgresql" in DATABASE_URL else {}
)

# Create SessionLocal class
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False  # Don't expire objects after commit
)

# Create Base class for models
Base = declarative_base()

# Connection retry configuration
MAX_RETRIES = 3
RETRY_DELAY = 1  # seconds

def add_engine_pidguard(engine):
    methodLogger = class_logger.get_method_logger("add_engine_pidguard")
    """
    Add a pidguard to the connection pool.
    This helps prevent connection issues when using forking servers.
    """
    @event.listens_for(engine, "connect")
    def connect(dbapi_connection, connection_record):
        connection_record.info['pid'] = os.getpid()

    @event.listens_for(engine, "checkout")
    def checkout(dbapi_connection, connection_record, connection_proxy):
        pid = os.getpid()
        if connection_record.info['pid'] != pid:
            connection_record.connection = connection_proxy.connection = None
            raise DisconnectionError(
                f"Connection record belongs to pid {connection_record.info['pid']}, "
                f"attempting to check out in pid {pid}"
            )

# Add pidguard for production
if ENVIRONMENT == "production" or ENVIRONMENT == "test":
    add_engine_pidguard(engine)

# Connection event listeners for monitoring and error handling
@event.listens_for(engine, "connect")
def receive_connect(dbapi_connection, connection_record):
    methodLogger = class_logger.get_method_logger("receive_connect")
    """Log when a new connection is created."""
    methodLogger.info(f"New database connection created. Pool size: {engine.pool.size()}")

@event.listens_for(engine, "checkout")
def receive_checkout(dbapi_connection, connection_record, connection_proxy):
    methodLogger = class_logger.get_method_logger("receive_checkout")
    """Log when a connection is checked out from the pool."""
    methodLogger.debug(f"Connection checked out from pool. Checked out: {engine.pool.checkedout()}")

@event.listens_for(engine, "checkin")
def receive_checkin(dbapi_connection, connection_record):
    methodLogger = class_logger.get_method_logger("receive_checkin")
    """Log when a connection is returned to the pool."""
    methodLogger.debug(f"Connection returned to pool. Checked out: {engine.pool.checkedout()}")

# Connection health check
def is_database_connected():
    methodLogger = class_logger.get_method_logger("is_database_connected")
    """Check if database is accessible."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        methodLogger.error(f"Database connection check failed: {e}")
        return False

# Get database session with retry logic
def get_db() -> Generator[Session, None, None]:
    methodLogger = class_logger.get_method_logger("get_db")
    """
    Dependency to get database session with connection retry logic.
    
    Yields:
        Session: Database session
        
    Raises:
        DBAPIError: If connection cannot be established after retries
    """
    db = None
    retry_count = 0

    while retry_count < MAX_RETRIES:
        try:
            db = SessionLocal()
            db.execute(text("SELECT 1"))
            break
        except (DBAPIError, DisconnectionError, TimeoutError) as e:
            retry_count += 1
            if db:
                db.close()
                db = None
            if retry_count >= MAX_RETRIES:
                methodLogger.error(f"Failed to get database connection after {MAX_RETRIES} retries: {e}")
                raise
            methodLogger.warning(f"Database connection failed, retrying ({retry_count}/{MAX_RETRIES}): {e}")
            import time
            time.sleep(RETRY_DELAY * retry_count)
        except Exception as e:
            methodLogger.error(f"Unexpected error getting database connection: {e}")
            if db:
                db.close()
            raise

    try:
        yield db
    finally:
        if db:
            db.close()

# Context manager for database sessions
@contextmanager
def get_db_context():
    """
    Context manager for database sessions with automatic rollback on error.
    
    Example:
        with get_db_context() as db:
            user = db.query(User).first()
    """
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

# Pool status monitoring
def get_pool_status():
    """
    Get current connection pool status for monitoring.
    
    Returns:
        dict: Pool status information
    """
    pool = engine.pool
    return {
        "size": pool.size(),
        "checked_out": pool.checkedout(),
        "overflow": pool.overflow(),
        "total": pool.size() + pool.overflow(),
        "available": pool.size() - pool.checkedout(),
    }

# Graceful shutdown
def close_database_connections():
    methodLogger = class_logger.get_method_logger("close_database_connections")
    """Close all database connections gracefully."""
    methodLogger.info("Closing database connections...")
    engine.dispose()
    methodLogger.info("Database connections closed.")

# Health check endpoint data
def get_database_health():
    methodLogger = class_logger.get_method_logger("get_database_health")
    """
    Get database health information for monitoring endpoints.
    
    Returns:
        dict: Database health status
    """
    try:
        # Check basic connectivity
        connected = is_database_connected()
        
        # Get pool status
        pool_status = get_pool_status()
        
        # Calculate health metrics
        pool_usage_percent = (pool_status["checked_out"] / pool_status["size"]) * 100 if pool_status["size"] > 0 else 0
        
        return {
            "status": "healthy" if connected and pool_usage_percent < 80 else "unhealthy",
            "connected": connected,
            "pool_status": pool_status,
            "pool_usage_percent": round(pool_usage_percent, 2),
            "environment": ENVIRONMENT,
        }
    except Exception as e:
        methodLogger.error(f"Error getting database health: {e}")
        return {
            "status": "error",
            "error": str(e),
            "environment": ENVIRONMENT,
        }
