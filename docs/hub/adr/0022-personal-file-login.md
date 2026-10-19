# ADR 0022: Explicit personal file-backed login

Status: Accepted for personal installations; OAuth remains the default.

Personal hosts may select `HUB_AUTH_MODE=local` and a private JSON allowlist instead
of registering an external OAuth application. File entries contain stable UUID
identities and bounded, salted scrypt hashes. Plaintext password entries are rejected.
The file is mounted read-only into the BFF and is never part of a static or backend
image. Only active allowlisted identities are provisioned, and existing sessions
are rejected after their entry is removed/disabled and the backend is recreated.

This narrows ADR 0018's invite-only first-account admission for explicitly selected
personal mode: the host-authored file is the account admission authority. It creates
no public registration route. Account provisioning uses the existing provider-neutral
PostgreSQL identity writer; sessions and sign-in/reauthentication use existing atomic
completion methods and browser-bound login transactions. No schema migration is needed.

OAuth accounts are not merged or selected by mutable names. Identity linking is
unavailable in personal mode. All campaign tenancy, membership, role, revision,
lease, idempotency, audit/outbox and realtime authorization contracts remain in force.
The default entitlement-disabled personal stack allows its admitted users to create
campaigns; enabling entitlements still requires the existing operator provisioning.

Rollback selects OAuth again without deleting database data. Credential changes
require BFF recreation; sessions for an enabled account persist through password
changes until revoked normally. No credentials or auth request bodies may be logged.

See [local login](../local-login.md) for setup, file permissions, account lifecycle,
and validation coverage in `HubLocalPassword.test.js`.
