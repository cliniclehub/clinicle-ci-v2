# Roles API — coverage notes

Canonical QA documentation for this suite:
[`devops/docs/system_docs/ST-API/roles-ST-API.md`](../../../devops/docs/system_docs/ST-API/roles-ST-API.md).

Keep pytest specs under this folder; update the ST-API doc when BRD mapping
changes.

The suite inventories role and permission endpoints, verifies authentication
denial for every route, and verifies an organization administrator can read
assignable roles and the roles management list. Custom-role tenant isolation
and permission validation are also covered by backend unit tests.
