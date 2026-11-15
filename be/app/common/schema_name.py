"""PostgreSQL schema used by application tables."""

from app.common.config import DB_SCHEMA

SCHEMA = DB_SCHEMA
ORG_ID_FK = f"{SCHEMA}.organizations.id"
USER_ID_FK = f"{SCHEMA}.users.id"
ROLE_ID_FK = f"{SCHEMA}.roles.id"
