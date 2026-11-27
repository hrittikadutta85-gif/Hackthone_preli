"""SQLite storage for accounts, sessions, codes, login history, notifications and the audit log.

A separate file from the alerts database (default data/auth.sqlite3, git-ignored). Schema changes are numbered
migrations applied in order at start-up; `PRAGMA user_version` records the last one applied, so upgrading an existing
database only runs the new ones.
"""
from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from .rbac import PERMISSIONS, ROLES

TIME_FORMAT = "%Y-%m-%dT%H:%M:%SZ"  # fixed width, so times compare correctly as text in SQL


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime(TIME_FORMAT)


def parse(s: str | None) -> datetime | None:
    return datetime.strptime(s, TIME_FORMAT).replace(tzinfo=timezone.utc) if s else None


MIGRATIONS: list[str] = [
    # 1: core schema
    """
    CREATE TABLE roles (
        name        TEXT PRIMARY KEY,
        rank        INTEGER NOT NULL,
        self_service INTEGER NOT NULL DEFAULT 0   -- may be requested at public registration
    );
    CREATE TABLE role_permissions (
        role        TEXT NOT NULL REFERENCES roles(name) ON DELETE CASCADE,
        permission  TEXT NOT NULL,
        PRIMARY KEY (role, permission)
    );
    CREATE TABLE users (
        id                  INTEGER PRIMARY KEY,
        email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
        username            TEXT UNIQUE COLLATE NOCASE,
        full_name           TEXT NOT NULL,
        phone               TEXT UNIQUE,                    -- E.164, e.g. +8801712345678
        organization        TEXT NOT NULL DEFAULT '',
        designation         TEXT NOT NULL DEFAULT '',
        role                TEXT NOT NULL DEFAULT 'viewer' REFERENCES roles(name),
        requested_role      TEXT REFERENCES roles(name),
        status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'deactivated')),
        password_hash       TEXT,
        password_changed_at TEXT,
        email_verified_at   TEXT,
        phone_verified_at   TEXT,
        otp_login           INTEGER NOT NULL DEFAULT 0,     -- ask for a code at every login
        assigned_wards      TEXT NOT NULL DEFAULT '[]',     -- JSON list, used for field officers
        lang                TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'bn')),
        failed_logins       INTEGER NOT NULL DEFAULT 0,
        lock_count          INTEGER NOT NULL DEFAULT 0,
        locked_until        TEXT,
        terms_accepted_at   TEXT,
        approved_by         INTEGER REFERENCES users(id),
        approved_at         TEXT,
        created_by          INTEGER REFERENCES users(id),
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        last_login_at       TEXT
    );
    CREATE TABLE notification_prefs (
        user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        sms_login           INTEGER NOT NULL DEFAULT 1,
        whatsapp_login      INTEGER NOT NULL DEFAULT 0,
        new_device          INTEGER NOT NULL DEFAULT 1,
        password_change     INTEGER NOT NULL DEFAULT 1,
        security            INTEGER NOT NULL DEFAULT 1,
        channel             TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'whatsapp')),
        whatsapp_consent_at TEXT,                           -- explicit opt-in, required by WhatsApp policy
        updated_at          TEXT NOT NULL
    );
    CREATE TABLE otp_codes (
        id              INTEGER PRIMARY KEY,
        purpose         TEXT NOT NULL,      -- verify_email | verify_phone | login | reset_password | change_phone
        channel         TEXT NOT NULL,      -- email | sms | whatsapp
        target          TEXT NOT NULL,      -- normalised email or E.164 phone
        user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
        challenge_id    INTEGER REFERENCES login_challenges(id) ON DELETE CASCADE,
        code_hash       TEXT NOT NULL,      -- HMAC-SHA256; the code itself is never stored
        attempts        INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL,
        expires_at      TEXT NOT NULL,
        consumed_at     TEXT,
        invalidated_at  TEXT,
        ip              TEXT
    );
    CREATE INDEX otp_target ON otp_codes(target, purpose, created_at);
    CREATE INDEX otp_ip ON otp_codes(ip, created_at);
    CREATE TABLE login_challenges (
        id              INTEGER PRIMARY KEY,
        token_hash      TEXT NOT NULL UNIQUE,
        user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL for an unknown identifier
        method          TEXT NOT NULL,      -- password+otp | otp
        remember        INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL,
        expires_at      TEXT NOT NULL,
        consumed_at     TEXT,
        ip              TEXT
    );
    CREATE TABLE sessions (
        id              INTEGER PRIMARY KEY,
        token_hash      TEXT NOT NULL UNIQUE,   -- SHA-256 of the cookie value
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at      TEXT NOT NULL,
        last_seen_at    TEXT NOT NULL,
        expires_at      TEXT NOT NULL,
        absolute_expires_at TEXT NOT NULL,
        remember        INTEGER NOT NULL DEFAULT 0,
        reauth_at       TEXT,
        ip              TEXT,
        user_agent      TEXT,
        device_hash     TEXT,
        revoked_at      TEXT,
        revoked_reason  TEXT
    );
    CREATE INDEX sessions_user ON sessions(user_id, revoked_at);
    CREATE TABLE known_devices (
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_hash     TEXT NOT NULL,
        label           TEXT NOT NULL,
        first_seen_at   TEXT NOT NULL,
        last_seen_at    TEXT NOT NULL,
        PRIMARY KEY (user_id, device_hash)
    );
    CREATE TABLE login_history (
        id              INTEGER PRIMARY KEY,
        user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
        identifier      TEXT NOT NULL,      -- what was typed (for failed logins to unknown accounts)
        at              TEXT NOT NULL,
        ip              TEXT,
        user_agent      TEXT,
        device          TEXT,
        location        TEXT,               -- only filled in when a reliable source is configured
        success         INTEGER NOT NULL,
        reason          TEXT,               -- ok | bad_password | unknown_user | locked | otp_failed | ...
        method          TEXT NOT NULL,
        new_device      INTEGER NOT NULL DEFAULT 0,
        suspicious      INTEGER NOT NULL DEFAULT 0,
        session_id      INTEGER REFERENCES sessions(id) ON DELETE SET NULL
    );
    CREATE INDEX logins_user ON login_history(user_id, at);
    CREATE INDEX logins_ip ON login_history(ip, at);
    CREATE TABLE notifications (
        id              INTEGER PRIMARY KEY,
        user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
        event           TEXT NOT NULL,      -- otp | login | new_device | suspicious_login | password_change | ...
        channel         TEXT NOT NULL,      -- sms | whatsapp | email
        provider        TEXT,
        target          TEXT NOT NULL,      -- masked, e.g. +88017*****678
        status          TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'skipped')),
        detail          TEXT,               -- reason for failed/skipped, or the provider's own status word
        provider_message_id TEXT,
        login_id        INTEGER REFERENCES login_history(id) ON DELETE SET NULL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
    );
    CREATE INDEX notifications_user ON notifications(user_id, created_at);
    CREATE INDEX notifications_msg ON notifications(provider_message_id);
    CREATE TABLE password_resets (
        id              INTEGER PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash      TEXT NOT NULL UNIQUE,
        channel         TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        expires_at      TEXT NOT NULL,
        used_at         TEXT,
        ip              TEXT
    );
    CREATE TABLE invitations (
        id              INTEGER PRIMARY KEY,
        user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash       TEXT NOT NULL,
        created_by      INTEGER REFERENCES users(id),
        created_at      TEXT NOT NULL,
        expires_at      TEXT NOT NULL,
        accepted_at     TEXT,
        attempts        INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE audit_log (
        id              INTEGER PRIMARY KEY,
        at              TEXT NOT NULL,
        actor_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action          TEXT NOT NULL,
        target_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        ip              TEXT,
        detail          TEXT NOT NULL DEFAULT '{}'   -- JSON; never passwords, codes or tokens
    );
    CREATE INDEX audit_at ON audit_log(at);
    """,
    # 2: sign-up with only a mobile number and password, so email becomes optional (still unique when given)
    """
    CREATE TABLE users_new (
        id                  INTEGER PRIMARY KEY,
        email               TEXT UNIQUE COLLATE NOCASE,
        username            TEXT UNIQUE COLLATE NOCASE,
        full_name           TEXT NOT NULL DEFAULT '',
        phone               TEXT UNIQUE,
        organization        TEXT NOT NULL DEFAULT '',
        designation         TEXT NOT NULL DEFAULT '',
        role                TEXT NOT NULL DEFAULT 'viewer' REFERENCES roles(name),
        requested_role      TEXT REFERENCES roles(name),
        status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'deactivated')),
        password_hash       TEXT,
        password_changed_at TEXT,
        email_verified_at   TEXT,
        phone_verified_at   TEXT,
        otp_login           INTEGER NOT NULL DEFAULT 0,
        assigned_wards      TEXT NOT NULL DEFAULT '[]',
        lang                TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'bn')),
        failed_logins       INTEGER NOT NULL DEFAULT 0,
        lock_count          INTEGER NOT NULL DEFAULT 0,
        locked_until        TEXT,
        terms_accepted_at   TEXT,
        approved_by         INTEGER REFERENCES users(id),
        approved_at         TEXT,
        created_by          INTEGER REFERENCES users(id),
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        last_login_at       TEXT,
        CHECK (email IS NOT NULL OR phone IS NOT NULL)
    );
    INSERT INTO users_new SELECT * FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    """,
]


class Database:
    """One connection per thread; writes are serialised by SQLite itself (WAL mode)."""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self.migrate()

    def conn(self) -> sqlite3.Connection:
        c = getattr(self._local, "conn", None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=15, isolation_level=None, check_same_thread=False)
            c.row_factory = sqlite3.Row
            c.execute("PRAGMA foreign_keys = ON")
            c.execute("PRAGMA journal_mode = WAL")
            c.execute("PRAGMA busy_timeout = 15000")
            self._local.conn = c
        return c

    def migrate(self):
        c = self.conn()
        version = c.execute("PRAGMA user_version").fetchone()[0]
        if version < len(MIGRATIONS):
            c.execute("PRAGMA foreign_keys = OFF")  # table rebuilds need this; it cannot change inside a transaction
            try:
                for i, sql in enumerate(MIGRATIONS[version:], start=version + 1):
                    c.executescript(f"BEGIN; {sql}; PRAGMA user_version = {i}; COMMIT;")
                bad = c.execute("PRAGMA foreign_key_check").fetchall()
                if bad:
                    raise RuntimeError(f"foreign key check failed after migration: {bad[:3]}")
            finally:
                c.execute("PRAGMA foreign_keys = ON")
        self.sync_roles()

    def sync_roles(self):
        """Roles and their permissions are defined in rbac.py; the tables mirror them for integrity and reporting."""
        c = self.conn()
        with self.tx():
            for name, r in ROLES.items():
                c.execute("INSERT INTO roles(name, rank, self_service) VALUES (?, ?, ?) "
                          "ON CONFLICT(name) DO UPDATE SET rank = excluded.rank, self_service = excluded.self_service",
                          (name, r["rank"], int(r["self_service"])))
                c.execute("DELETE FROM role_permissions WHERE role = ?", (name,))
                c.executemany("INSERT INTO role_permissions(role, permission) VALUES (?, ?)",
                              [(name, p) for p in sorted(r["permissions"]) if p in PERMISSIONS])

    def tx(self):
        return _Tx(self.conn())

    def one(self, sql: str, args=()) -> dict | None:
        row = self.conn().execute(sql, args).fetchone()
        return dict(row) if row else None

    def all(self, sql: str, args=()) -> list[dict]:
        return [dict(r) for r in self.conn().execute(sql, args).fetchall()]

    def run(self, sql: str, args=()) -> sqlite3.Cursor:
        return self.conn().execute(sql, args)


class _Tx:
    """BEGIN IMMEDIATE ... COMMIT, so check-then-write sequences (rate limits, one-time codes) can't interleave."""

    def __init__(self, c: sqlite3.Connection):
        self.c = c
        self.nested = c.in_transaction

    def __enter__(self):
        if not self.nested:
            self.c.execute("BEGIN IMMEDIATE")
        return self.c

    def __exit__(self, exc_type, *_):
        if self.nested:
            return False
        self.c.execute("ROLLBACK" if exc_type else "COMMIT")
        return False
