# ADR 0023: Build personal Portainer app images from Git

Date: 2026-10-19
Status: Accepted for the personal Docker Standalone stack

## Context

Building app images on a development machine does not make them available to a
different Docker endpoint managed by Portainer. The previous image-only standalone
file required manual builds or transfers, preventing Compose-plus-environment deployment.

## Decision

`compose.hub.portainer.yml` declares local build contexts (`.`) and
`pull_policy: build` for application services. In Portainer Git Repository mode,
Portainer checks out the selected ref and supplies its files to the builder. The
Docker builder does not perform a second Git clone or require a Git executable. Backend jobs
share one build definition; the website and optional backup image use their own
Dockerfiles. Select a source branch/tag/commit through Portainer's repository reference.
`HUB_BUILD_CONTEXT` remains an optional context override; remote Git overrides need
a Git-capable builder. Published infrastructure images use normal registry pulls.

## Consequences

Portainer needs GitHub access for the checkout; the builder needs base-image, npm
and package-repository access. The initial remote Git default was revised after a
target builder lacked Git. GitHub archives also add a root directory and are not a
drop-in context for these Dockerfiles. Repository deployment with `.` avoids both issues. Deployment builds take time and may fail before containers start. A branch
reference follows committed changes; pin a commit/tag in Portainer when reproducible
source selection is needed. Runtime credentials are not build arguments. Keep the Docker build contexts'
credential exclusions and never put secrets in a Git URL.

Managed configuration/data volumes, proxy trust, OAuth admission and all application
authorization, revision, lease, receipt and event contracts remain unchanged. No
schema migration or canonical user-data change is introduced. Existing stack handover
and volume-preserving rollback procedures still apply. Swarm is outside this scope.

## Evidence

See [Portainer build validation](../testing.md#automatic-portainer-git-build-validation)
for CLI remote-source builds and a real isolated Portainer deployment starting with
missing app-image tags, using synthetic credentials and disposable volumes.
