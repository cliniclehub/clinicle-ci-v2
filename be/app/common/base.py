from sqlalchemy import Column, String, Boolean, ForeignKey, Text, Integer
from sqlalchemy.dialects.postgresql import UUID, TIMESTAMP
from sqlalchemy.sql import text
from sqlalchemy.orm import relationship, registry

from app.common.database_pool import Base

# Create a registry for model registration
mapper_registry = registry()

# Export all symbols
Base = Base
Column = Column
String = String
Boolean = Boolean
ForeignKey = ForeignKey
Text = Text
Integer = Integer
UUID = UUID
TIMESTAMP = TIMESTAMP
text = text
relationship = relationship

# Export common imports
__all__ = [
    'Base', 'Column', 'String', 'Boolean', 'ForeignKey', 'Text', 
    'Integer', 'UUID', 'TIMESTAMP', 'text', 'relationship'
] 