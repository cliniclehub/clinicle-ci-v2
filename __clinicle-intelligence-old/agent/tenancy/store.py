"""Platform-level tenancy store: organizations, users, memberships.

Separate from the per-tenant `ConversationStore` (`agent/memory/conversation_store.py`)
and per-workspace `ToolManager` (`agent/tools/tool_manager.py`) — those two are
keyed by workspace root and become tenant-isolated for free once each org gets
its own workspace root (see the approved plan at
`~/.claude/plans/typed-pondering-owl.md`). This store is the one genuinely new
piece: it holds the small, global mapping of *who* an authenticated request is
and *which* org(s) they belong to, so the rest of the system can resolve a
`workspace_root` from it.

DB lives at ``~/.cow/platform.db``, alongside the existing
``~/.cow/mcp_oauth.json`` (same cow-wide, not-per-workspace convention). File
is chmod'd 0600 on creation since it holds password hashes.
"""

from __future__ import annotations

import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import bcrypt
import pyotp

from agent.audit import log as audit_log
from common.log import logger

# Role hierarchy for RBAC checks (agent/tenancy/store.py, channel/web/api/auth.py).
# Higher rank can do everything a lower rank can. "owner" is the role signup
# grants automatically (see AuthSignupHandler); "admin" and "member" are
# assignable via add_membership.
ROLE_RANK = {"member": 0, "admin": 1, "owner": 2}


@dataclass
class Organization:
    id: int
    name: str
    plan: str
    stripe_customer_id: Optional[str]
    stripe_subscription_id: Optional[str]
    created_at: int


@dataclass
class User:
    id: int
    email: str
    password_hash: str
    created_at: int
    mfa_secret: Optional[str] = None
    mfa_enabled: bool = False
    last_login_at: Optional[int] = None
    sessions_revoked_at: Optional[int] = None


@dataclass
class Membership:
    user_id: int
    org_id: int
    role: str


@dataclass
class Invite:
    token: str
    org_id: int
    email: str
    role: str
    invited_by: Optional[str]
    created_at: int
    expires_at: int


class EmailAlreadyRegistered(Exception):
    pass


class InviteExpired(Exception):
    pass


def _default_db_path() -> Path:
    return Path(os.path.expanduser("~/.cow/platform.db"))


class TenancyStore:
    def __init__(self, db_path: Optional[Path] = None):
        self._db_path = db_path or _default_db_path()
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        is_new = not self._db_path.exists()
        conn = self._connect()
        try:
            self._migrate(conn)
        finally:
            conn.close()
        if is_new:
            try:
                os.chmod(self._db_path, 0o600)
            except OSError as e:
                logger.debug(f"[TenancyStore] chmod 0600 skipped: {e}")

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._db_path), timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    def _migrate(self, conn: sqlite3.Connection) -> None:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS organizations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                plan TEXT NOT NULL DEFAULT 'free',
                stripe_customer_id TEXT,
                stripe_subscription_id TEXT,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        # memberships references organizations/users, so it must be created
        # after both — an add-table migration sorts after the tables it
        # references, same ordering rule ConversationStore's ALTER-based
        # migrations follow.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS memberships (
                user_id INTEGER NOT NULL,
                org_id INTEGER NOT NULL,
                role TEXT NOT NULL DEFAULT 'member',
                PRIMARY KEY (user_id, org_id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (org_id) REFERENCES organizations(id)
            )
            """
        )
        # Add-column migrations sort after the CREATE TABLE they alter, same
        # rule ConversationStore's ALTER-based migrations follow: a fresh
        # install gets these columns from the table already having existed
        # zero times, an upgrade gets them bolted on here.
        user_cols = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "mfa_secret" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN mfa_secret TEXT")
        if "mfa_enabled" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0")
        if "last_login_at" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN last_login_at INTEGER")
        if "sessions_revoked_at" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN sessions_revoked_at INTEGER")

        # invites references organizations, so (same rule as memberships
        # above) it sorts after that CREATE TABLE. No email sending exists
        # anywhere in this codebase -- an invite is a one-time signed link an
        # admin copies and sends manually, not an automated email.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS invites (
                token TEXT PRIMARY KEY,
                org_id INTEGER NOT NULL,
                email TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'member',
                invited_by TEXT,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL,
                FOREIGN KEY (org_id) REFERENCES organizations(id)
            )
            """
        )
        # Per-org overrides on top of agent/permission/capabilities.py's
        # DEFAULT_ROLE_CAPABILITIES -- sorts after organizations for the same
        # reason invites does. No row here for a (role, capability) pair means
        # "use the default", not "denied" -- see get_role_capabilities().
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS role_capabilities (
                org_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                capability TEXT NOT NULL,
                granted INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (org_id, role, capability),
                FOREIGN KEY (org_id) REFERENCES organizations(id)
            )
            """
        )
        conn.commit()

    # -- organizations --------------------------------------------------

    def create_organization(self, name: str, plan: str = "free") -> Organization:
        now = int(time.time())
        conn = self._connect()
        try:
            cur = conn.execute(
                "INSERT INTO organizations (name, plan, created_at) VALUES (?, ?, ?)",
                (name, plan, now),
            )
            conn.commit()
            return Organization(cur.lastrowid, name, plan, None, None, now)
        finally:
            conn.close()

    def get_organization(self, org_id: int) -> Optional[Organization]:
        """Returns None on a missing id — callers must treat that as a 404,
        never assume the id is valid because it came from a request."""
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM organizations WHERE id = ?", (org_id,)
            ).fetchone()
            return self._row_to_org(row) if row else None
        finally:
            conn.close()

    def list_organizations(self) -> list[Organization]:
        """Every org on this instance. Used only by one-time, instance-wide
        migrations (see agent/admin.py's migrate_legacy_ownership) that need
        to know whether the deployment is single-org before auto-assigning
        anything -- never call this to answer a per-request "which org"
        question, which must always come from the caller's own session."""
        conn = self._connect()
        try:
            rows = conn.execute("SELECT * FROM organizations ORDER BY id").fetchall()
            return [self._row_to_org(row) for row in rows]
        finally:
            conn.close()

    @staticmethod
    def _row_to_org(row: sqlite3.Row) -> Organization:
        return Organization(
            row["id"], row["name"], row["plan"],
            row["stripe_customer_id"], row["stripe_subscription_id"],
            row["created_at"],
        )

    # -- users ------------------------------------------------------------

    def create_user(self, email: str, password: str) -> User:
        email = email.strip().lower()
        password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
        now = int(time.time())
        conn = self._connect()
        try:
            try:
                cur = conn.execute(
                    "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
                    (email, password_hash, now),
                )
            except sqlite3.IntegrityError:
                raise EmailAlreadyRegistered(email)
            conn.commit()
            user = User(cur.lastrowid, email, password_hash, now)
        finally:
            conn.close()
        audit_log.record_event(None, email, "user.created", {"user_id": user.id})
        return user

    def get_user_by_email(self, email: str) -> Optional[User]:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM users WHERE email = ?", (email.strip().lower(),)
            ).fetchone()
            return self._row_to_user(row) if row else None
        finally:
            conn.close()

    def has_any_user(self) -> bool:
        """Whether real accounts have ever been created on this instance.

        The auth layer's fork point: an instance with zero users keeps
        today's single-shared-password behavior untouched; the moment the
        first account is created, real per-user/per-org login takes over.
        """
        conn = self._connect()
        try:
            row = conn.execute("SELECT 1 FROM users LIMIT 1").fetchone()
            return row is not None
        finally:
            conn.close()

    def get_user(self, user_id: int) -> Optional[User]:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return self._row_to_user(row) if row else None
        finally:
            conn.close()

    @staticmethod
    def _row_to_user(row: sqlite3.Row) -> User:
        return User(
            row["id"], row["email"], row["password_hash"], row["created_at"],
            mfa_secret=row["mfa_secret"], mfa_enabled=bool(row["mfa_enabled"]),
            last_login_at=row["last_login_at"], sessions_revoked_at=row["sessions_revoked_at"],
        )

    def touch_last_login(self, user_id: int) -> None:
        conn = self._connect()
        try:
            conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (int(time.time()), user_id))
            conn.commit()
        finally:
            conn.close()

    def revoke_all_sessions(self, user_id: int, *, actor: str) -> None:
        """Signs the user out everywhere: any session token issued before this
        moment fails verification from now on (see ``tenancy_session.py``'s
        ``verify_session_token``, which checks a token's issue time against
        this cutoff). There is no server-side session store to enumerate or
        delete individual sessions from -- this is the whole mechanism."""
        conn = self._connect()
        try:
            conn.execute("UPDATE users SET sessions_revoked_at = ? WHERE id = ?", (int(time.time()), user_id))
            conn.commit()
        finally:
            conn.close()
        audit_log.record_event(None, actor, "session.revoke_all", {"user_id": user_id})

    # -- MFA (TOTP) ---------------------------------------------------------
    # Two-step so a user can't be locked out by an enrollment that never
    # completes: enroll_mfa() generates and stores a secret but leaves
    # mfa_enabled=0; confirm_mfa() only flips it on after the user proves
    # they can generate a valid code with it.

    def enroll_mfa(self, user_id: int, *, actor: str) -> str:
        """Generate and store a new TOTP secret (not yet enabled). Returns
        the base32 secret for rendering a QR / otpauth URI."""
        secret = pyotp.random_base32()
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE users SET mfa_secret = ?, mfa_enabled = 0 WHERE id = ?",
                (secret, user_id),
            )
            conn.commit()
        finally:
            conn.close()
        audit_log.record_event(None, actor, "mfa.enroll_started", {"user_id": user_id})
        return secret

    def confirm_mfa(self, user_id: int, code: str, *, actor: str) -> bool:
        """Verify the enrollment code and, on success, turn MFA on."""
        user = self.get_user(user_id)
        if user is None or not user.mfa_secret:
            return False
        if not pyotp.TOTP(user.mfa_secret).verify(code, valid_window=1):
            return False
        conn = self._connect()
        try:
            conn.execute("UPDATE users SET mfa_enabled = 1 WHERE id = ?", (user_id,))
            conn.commit()
        finally:
            conn.close()
        audit_log.record_event(None, actor, "mfa.enabled", {"user_id": user_id})
        return True

    def disable_mfa(self, user_id: int, *, actor: str) -> None:
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE users SET mfa_secret = NULL, mfa_enabled = 0 WHERE id = ?", (user_id,)
            )
            conn.commit()
        finally:
            conn.close()
        audit_log.record_event(None, actor, "mfa.disabled", {"user_id": user_id})

    @staticmethod
    def verify_mfa_code(user: User, code: str) -> bool:
        """Login-time check. Fails closed (False) for a user with MFA off or
        no code offered — the caller decides whether that's fatal."""
        if not user.mfa_enabled or not user.mfa_secret or not code:
            return False
        return pyotp.TOTP(user.mfa_secret).verify(code, valid_window=1)

    def change_password(self, user_id: int, old_password: str, new_password: str, *, actor: str) -> bool:
        """False (no-op) if old_password doesn't verify -- caller returns a
        generic error, never confirms/denies whether the account exists this
        way since it's always the signed-in user's own account already."""
        user = self.get_user(user_id)
        if user is None or not self.verify_password(user, old_password):
            return False
        password_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt()).decode()
        conn = self._connect()
        try:
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
            conn.commit()
        finally:
            conn.close()
        audit_log.record_event(None, actor, "user.password_changed", {"user_id": user_id})
        return True

    @staticmethod
    def verify_password(user: User, password: str) -> bool:
        try:
            return bcrypt.checkpw(password.encode(), user.password_hash.encode())
        except ValueError:
            # Malformed stored hash — fail closed, never treat as a match.
            return False

    # -- memberships --------------------------------------------------------
    # Membership is the only tenant-scope check in this module; every other
    # part of the system that needs to know "can user X act on org Y" must
    # go through get_membership() rather than trusting an org_id handed to
    # it in a request — a lookup that finds nothing is a 404, not a filtered
    # empty list.

    def add_membership(self, user_id: int, org_id: int, role: str = "member",
                        *, actor: Optional[str] = None) -> Membership:
        if role not in ROLE_RANK:
            raise ValueError(f"unknown role: {role!r}")
        conn = self._connect()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO memberships (user_id, org_id, role) VALUES (?, ?, ?)",
                (user_id, org_id, role),
            )
            conn.commit()
        finally:
            conn.close()
        audit_log.record_event(
            str(org_id), actor or f"user:{user_id}", "membership.role_set",
            {"user_id": user_id, "org_id": org_id, "role": role},
        )
        return Membership(user_id, org_id, role)

    def has_role(self, user_id: int, org_id: int, min_role: str) -> bool:
        """RBAC enforcement point: is this user's role in this org at least
        ``min_role``? A missing membership (wrong org, or none) is always
        False — the same "lookup finds nothing -> treat as denied" rule
        get_membership()'s docstring already states for tenant scoping."""
        membership = self.get_membership(user_id, org_id)
        if membership is None:
            return False
        return ROLE_RANK.get(membership.role, -1) >= ROLE_RANK.get(min_role, 0)

    def get_role_capabilities(self, org_id: int) -> dict[str, dict[str, bool]]:
        """Every editable role's capability grants for one org, seeded from
        DEFAULT_ROLE_CAPABILITIES for any (role, capability) pair with no
        explicit override row yet. Owner isn't included -- it always has
        every capability (see has_capability) and isn't editable."""
        from agent.permission.capabilities import CAPABILITY_KEYS, DEFAULT_ROLE_CAPABILITIES

        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT role, capability, granted FROM role_capabilities WHERE org_id = ?",
                (org_id,),
            ).fetchall()
        finally:
            conn.close()
        overrides = {(r["role"], r["capability"]): bool(r["granted"]) for r in rows}
        return {
            role: {
                cap: overrides.get((role, cap), cap in DEFAULT_ROLE_CAPABILITIES.get(role, frozenset()))
                for cap in CAPABILITY_KEYS
            }
            for role in ("admin", "member")
        }

    def set_role_capability(self, org_id: int, role: str, capability: str, granted: bool,
                             *, actor: str) -> None:
        from agent.permission.capabilities import is_known_capability

        if role not in ("admin", "member"):
            raise ValueError(f"role not editable: {role!r}")
        if not is_known_capability(capability):
            raise ValueError(f"unknown capability: {capability!r}")
        conn = self._connect()
        try:
            conn.execute(
                "INSERT INTO role_capabilities (org_id, role, capability, granted) VALUES (?,?,?,?) "
                "ON CONFLICT(org_id, role, capability) DO UPDATE SET granted = excluded.granted",
                (org_id, role, capability, int(granted)),
            )
            conn.commit()
        finally:
            conn.close()
        audit_log.record_event(
            str(org_id), actor, "capability.set",
            {"role": role, "capability": capability, "granted": granted},
        )

    def has_capability(self, user_id: int, org_id: int, capability: str) -> bool:
        """RBAC-plus enforcement point, layered on top of has_role: owner
        always passes; admin/member are gated by role_capabilities (falling
        back to DEFAULT_ROLE_CAPABILITIES when no override exists). A missing
        membership is always False, same fail-closed rule has_role() follows."""
        membership = self.get_membership(user_id, org_id)
        if membership is None:
            return False
        if membership.role == "owner":
            return True
        return self.get_role_capabilities(org_id).get(membership.role, {}).get(capability, False)

    def list_memberships_for_user(self, user_id: int) -> list[Membership]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM memberships WHERE user_id = ?", (user_id,)
            ).fetchall()
            return [Membership(r["user_id"], r["org_id"], r["role"]) for r in rows]
        finally:
            conn.close()

    def get_membership(self, user_id: int, org_id: int) -> Optional[Membership]:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM memberships WHERE user_id = ? AND org_id = ?",
                (user_id, org_id),
            ).fetchone()
            return Membership(row["user_id"], row["org_id"], row["role"]) if row else None
        finally:
            conn.close()

    def list_memberships_for_org(self, org_id: int) -> list[Membership]:
        """Every member of one org — the export/RTBF surface's "who is this
        tenant's data about" query, as opposed to list_memberships_for_user's
        "which orgs is this user in"."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM memberships WHERE org_id = ?", (org_id,)
            ).fetchall()
            return [Membership(r["user_id"], r["org_id"], r["role"]) for r in rows]
        finally:
            conn.close()

    def delete_membership(self, user_id: int, org_id: int) -> None:
        conn = self._connect()
        try:
            conn.execute(
                "DELETE FROM memberships WHERE user_id = ? AND org_id = ?", (user_id, org_id)
            )
            conn.commit()
        finally:
            conn.close()

    def delete_organization(self, org_id: int) -> None:
        conn = self._connect()
        try:
            conn.execute("DELETE FROM organizations WHERE id = ?", (org_id,))
            conn.commit()
        finally:
            conn.close()

    # -- invites --------------------------------------------------------
    # No email-sending infrastructure exists anywhere in this codebase --
    # an invite is a one-time, unguessable link (secrets.token_urlsafe) an
    # admin copies from the UI and sends manually (Slack/email themselves).
    # The token itself is the invitee's only credential until they set a
    # real password in accept_invite, same shape as tenancy_session.py's
    # signed session tokens.

    _INVITE_TTL_SECONDS = 7 * 86400

    def create_invite(self, org_id: int, email: str, role: str = "member",
                       *, invited_by: Optional[str] = None) -> Invite:
        if role not in ROLE_RANK:
            raise ValueError(f"unknown role: {role!r}")
        import secrets as _secrets

        token = _secrets.token_urlsafe(24)
        now = int(time.time())
        invite = Invite(
            token=token, org_id=org_id, email=email.strip().lower(), role=role,
            invited_by=invited_by, created_at=now, expires_at=now + self._INVITE_TTL_SECONDS,
        )
        conn = self._connect()
        try:
            conn.execute(
                "INSERT INTO invites (token, org_id, email, role, invited_by, created_at, expires_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (invite.token, invite.org_id, invite.email, invite.role,
                 invite.invited_by, invite.created_at, invite.expires_at),
            )
            conn.commit()
        finally:
            conn.close()
        audit_log.record_event(
            str(org_id), invited_by or f"org:{org_id}", "invite.created",
            {"email": invite.email, "role": role},
        )
        return invite

    def get_invite(self, token: str) -> Optional[Invite]:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM invites WHERE token = ?", (token,)).fetchone()
            return self._row_to_invite(row) if row else None
        finally:
            conn.close()

    @staticmethod
    def _row_to_invite(row: sqlite3.Row) -> Invite:
        return Invite(
            row["token"], row["org_id"], row["email"], row["role"],
            row["invited_by"], row["created_at"], row["expires_at"],
        )

    def list_invites_for_org(self, org_id: int) -> list[Invite]:
        """Pending invites only -- an accepted or revoked one is deleted, not
        flagged, so this never needs a status filter."""
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM invites WHERE org_id = ? ORDER BY created_at DESC", (org_id,)
            ).fetchall()
            return [self._row_to_invite(r) for r in rows]
        finally:
            conn.close()

    def delete_invite(self, token: str) -> None:
        conn = self._connect()
        try:
            conn.execute("DELETE FROM invites WHERE token = ?", (token,))
            conn.commit()
        finally:
            conn.close()

    def accept_invite(self, token: str, password: str) -> tuple[User, Membership]:
        """Consumes the invite (deleted either way, success or expiry --
        an expired token is dead, not retryable). If the invited email
        already has an account (accepting a second org's invite), only the
        membership is added and the given password is ignored; otherwise a
        new account is created with it."""
        invite = self.get_invite(token)
        if invite is None:
            raise ValueError("invite not found or already used")
        if invite.expires_at < int(time.time()):
            self.delete_invite(token)
            raise InviteExpired("this invite has expired")

        user = self.get_user_by_email(invite.email)
        if user is None:
            user = self.create_user(invite.email, password)
        membership = self.add_membership(user.id, invite.org_id, role=invite.role, actor=invite.email)
        self.delete_invite(token)
        return user, membership


_instance: Optional[TenancyStore] = None


def get_tenancy_store() -> TenancyStore:
    """Process-wide singleton — there is exactly one platform DB, not one per
    workspace, so this deliberately does not follow the per-workspace-root
    keying pattern `ToolManager`/`ConversationStore` use."""
    global _instance
    if _instance is None:
        _instance = TenancyStore()
    return _instance
