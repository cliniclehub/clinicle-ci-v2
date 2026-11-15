"""
Consolidated Enums
==================

Shared enum definitions used by remaining platform modules.
"""

from enum import Enum


class OrgType(str, Enum):
    """Organization type enumeration"""
    COMPANY = "Company"
    NONPROFIT = "Nonprofit"
    EDUCATION = "Education"
    OTHER = "Other"


# Legacy alias
OrgTypeEnum = OrgType
