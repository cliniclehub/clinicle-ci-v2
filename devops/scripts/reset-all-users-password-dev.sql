-- =============================================================================
-- DEV / LOCAL ONLY — do NOT run on integration, test, or production.
--
-- Sets the same bcrypt password hash for every row in app.users.
-- Invoke with: psql ... -v password_hash='<bcrypt hash>' -f this-file.sql
-- =============================================================================

\if :{?password_hash}
\else
\echo 'Required variable missing: -v password_hash=<bcrypt hash>'
\quit
\endif

BEGIN;

UPDATE app.users
SET
  password_hash = :'password_hash',
  must_change_password = FALSE,
  failed_login_attempts = 0,
  locked = FALSE,
  locked_until = NULL,
  updated_at = NOW();

-- Avoid "recent password" conflicts if users change password later in dev.
DELETE FROM app.password_history;

COMMIT;

SELECT
  COUNT(*) AS users_updated,
  COUNT(*) FILTER (WHERE password_hash IS NOT NULL) AS users_with_password
FROM app.users;
