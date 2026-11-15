# Backend unit tests

This pytest suite covers the Clinicle Intelligence FastAPI backend. Run commands from the repository root.

## Commands

- `make test-unit-be-no-db` — mocked unit suite without PostgreSQL.
- `make setup-test-db` — create `ci_db_unit_test` as a schema-only copy of local `ci_db`.
- `make test-unit-be-db` — unit and marked integration tests.
- `make test-unit-be-no-db-cov` or `make test-unit-be-db-cov` — coverage gates.
- `make db-shell-test` — open the disposable test database.

The default integration URL is `postgresql://ci_user:ci_user@localhost:5432/ci_db_unit_test`; override `TEST_DATABASE_URL` when using another host port. `make reset-test-db` drops only `ci_db_unit_test`, recreates it from the current development schema, and never drops `ci_db`.

Coverage gates use `test_unit_be/.coveragerc` (unit gate surface). HTTP wiring and large ST-covered engines are omitted from the percentage; raise `BE_COV_FAIL_UNDER` / expand the surface as more unit tests land.

Tests under `tests/common` cover shared infrastructure. Directories under `tests/v1` mirror retained backend modules. Integration tests use transaction rollback and must use disposable data. No hosted CI workflow is bundled; the root commands are ready to map into the client's CI system.
