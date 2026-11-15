from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, UUID
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import relationship
from sqlalchemy.sql import text

from app.common.database_pool import Base
from app.common.schema_name import ORG_ID_FK, ROLE_ID_FK, SCHEMA, USER_ID_FK


class Permission(Base):
    __tablename__ = "permissions"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True)
    key = Column(String(100), nullable=False, unique=True)
    label = Column(String(150), nullable=False)
    description = Column(String(500), nullable=True)
    scope = Column(String(20), nullable=False)  # platform | org
    created_at = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))

    role_permissions = relationship("RolePermission", back_populates="permission")


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = {"schema": SCHEMA}

    id = Column(Integer, primary_key=True)
    key = Column(String(50), nullable=False, unique=True)
    label = Column(String(100), nullable=False)
    is_system = Column(Boolean, nullable=False, default=False, server_default="false")
    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey(ORG_ID_FK, ondelete="CASCADE"),
        nullable=True,
    )
    created_at = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))

    user_roles = relationship("UserRole", back_populates="role")
    role_permissions = relationship(
        "RolePermission",
        back_populates="role",
        cascade="all, delete-orphan",
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint("role_id", "permission_id", name="uq_role_permission"),
        {"schema": SCHEMA},
    )

    id = Column(Integer, primary_key=True)
    role_id = Column(Integer, ForeignKey(ROLE_ID_FK, ondelete="CASCADE"), nullable=False)
    permission_id = Column(
        Integer,
        ForeignKey(f"{SCHEMA}.permissions.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))

    role = relationship("Role", back_populates="role_permissions")
    permission = relationship("Permission", back_populates="role_permissions")


class UserRole(Base):
    __tablename__ = "user_roles"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "organization_id",
            "role_id",
            name="uq_user_org_role",
        ),
        {"schema": SCHEMA},
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey(USER_ID_FK, ondelete="CASCADE"), nullable=False)
    organization_id = Column(UUID(as_uuid=True), ForeignKey(ORG_ID_FK, ondelete="CASCADE"), nullable=False)
    role_id = Column(Integer, ForeignKey(ROLE_ID_FK, ondelete="CASCADE"), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))

    user = relationship("User", back_populates="roles")
    organization = relationship("Organization", back_populates="user_roles")
    role = relationship("Role", back_populates="user_roles")
