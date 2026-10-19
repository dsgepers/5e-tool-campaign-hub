# ADR 0023: Build personal Portainer app images from Git

Date: 2026-10-19
Status: Accepted for the personal Docker Standalone stack

## Context

Building app images on a development machine does not make them available to a
different Docker endpoint managed by Portainer. The previous image-only standalone
file required manual builds or transfers, preventing Compose-plus-environment deployment.

## Decision

`compose.hub.portainer.yml` declares remote Git build contexts and
`pull_policy: build` for application services. The default source is the public
`dsgepers/5e-tool-campaign-hub` repository's `multiplayer-hub` branch. Backend jobs
share one build definition; the website and optional backup image use their own
Dockerfiles. `HUB_BUILD_CONTEXT` can select a different source ref, including a
pinned commit. Published infrastructure images continue to use normal registry pulls.

## Consequences

The selected build environment needs GitHub, base-image, npm and package-repository
access. Deployment builds take time and may fail before containers start. A branch
ref follows committed changes; pin a commit when reproducible source selection is
needed. Runtime credentials are not build arguments. Keep the Docker build contexts'
credential exclusions and never put secrets in a Git URL.

Managed configuration/data volumes, proxy trust, OAuth admission and all application
authorization, revision, lease, receipt and event contracts remain unchanged. No
schema migration or canonical user-data change is introduced. Existing stack handover
and volume-preserving rollback procedures still apply. Swarm is outside this scope.

## Evidence

See [Portainer build validation](../testing.md#automatic-portainer-git-build-validation)
for CLI remote-source builds and a real isolated Portainer deployment starting with
missing app-image tags, using synthetic credentials and disposable volumes.
