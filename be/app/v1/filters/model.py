from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, String, Text, UUID
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.common.database_pool import Base
from app.common.schema_name import ORG_ID_FK, SCHEMA, USER_ID_FK


class SavedFilter(Base):
    """Store user-saved filter configurations for reuse across list pages."""

    __tablename__ = "saved_filters"
    __table_args__ = {"schema": SCHEMA}

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK, ondelete="CASCADE"), nullable=False)
    organization_id = Column(UUID(as_uuid=True), ForeignKey(ORG_ID_FK, ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    page_type = Column(String(100), nullable=False)
    filter_config = Column(JSONB, nullable=False)
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="saved_filters", lazy="select")
    organization = relationship("Organization", lazy="select")
