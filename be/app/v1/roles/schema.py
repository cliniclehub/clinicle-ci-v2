from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import Field

from app.common.base_schema import CamelModel


class PermissionOut(CamelModel):
    id: int
    key: str
    label: str
    description: Optional[str] = None
    scope: str

    class Config:
        from_attributes = True


class RoleOut(CamelModel):
    id: int
    key: str
    label: str
    is_system: bool = False
    organization_id: Optional[UUID] = None
    permissions: List[str] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CustomRoleCreate(CamelModel):
    label: str = Field(..., min_length=1, max_length=100)
    permissions: List[str] = Field(default_factory=list)


class CustomRoleUpdate(CamelModel):
    label: Optional[str] = Field(None, min_length=1, max_length=100)
    permissions: Optional[List[str]] = None
