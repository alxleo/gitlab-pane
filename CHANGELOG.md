# Changelog

## [0.3.0](https://github.com/alxleo/gitlab-pane/compare/v0.2.1...v0.3.0) (2026-11-07)


### ⚠ BREAKING CHANGES

* rename the plugin to gitlab-pane, compress the docs, and format with Biome ([#35](https://github.com/alxleo/gitlab-pane/issues/35))

### Features

* a lease for one shared GitLab reader, a store probe, and fixes from an adversarial review ([#26](https://github.com/alxleo/gitlab-pane/issues/26)) ([877874f](https://github.com/alxleo/gitlab-pane/commit/877874f45de4c903733d4c9f51c08b5c7ddb7f68))
* one GitLab reader shared by every session ([#32](https://github.com/alxleo/gitlab-pane/issues/32)) ([9884be3](https://github.com/alxleo/gitlab-pane/commit/9884be3728d6debb0f09723f79738c563af70aab))
* one person identity, one tool wrapper, recorded errors, and model text and SVG safe by type ([#22](https://github.com/alxleo/gitlab-pane/issues/22)) ([24948b1](https://github.com/alxleo/gitlab-pane/commit/24948b10071e90d88f7347841f601aa88a8e3001))
* read any number of GitLab hosts over HTTP, with a token per host ([#27](https://github.com/alxleo/gitlab-pane/issues/27)) ([f4314fb](https://github.com/alxleo/gitlab-pane/commit/f4314fbe6cfa22f6d37febc4d15ed302237b4b55))
* read the inbox from GitLab to-dos, without mr-inbox ([#31](https://github.com/alxleo/gitlab-pane/issues/31)) ([6633c90](https://github.com/alxleo/gitlab-pane/commit/6633c90e6b394773b1b805f8285fee14d4ae8c45))
* say which GitLab host is stale or fresh, and check the screenshots in CI ([#29](https://github.com/alxleo/gitlab-pane/issues/29)) ([98b2649](https://github.com/alxleo/gitlab-pane/commit/98b2649d2352c7ae9569c01a1391d434ed7e94a4))
* use GitLab's own merge checks, check query cost, and say why a job failed in wakes ([#30](https://github.com/alxleo/gitlab-pane/issues/30)) ([24c3d5e](https://github.com/alxleo/gitlab-pane/commit/24c3d5ed36eee076dc024675ed076dd2b73bfe94))


### Bug Fixes

* a person's hover card says a name written like their handle once ([f43ae9e](https://github.com/alxleo/gitlab-pane/commit/f43ae9e8d4255e66ab40f4feb15bcdc1f883a37d))
* going back lands on the card by opening the page only after the list moves ([8d2b750](https://github.com/alxleo/gitlab-pane/commit/8d2b75044489dc73a49ca7a6b1bcd4c82dd7104b))
* going back scrolls to the MR's title button, the card's box being one the desktop never reports ([2f79967](https://github.com/alxleo/gitlab-pane/commit/2f79967398643fe95a585391dd73ab271bd1efe5))
* send each GitLab token only to its own host, and fixes from the merge-train review ([#46](https://github.com/alxleo/gitlab-pane/issues/46)) ([b77a5b1](https://github.com/alxleo/gitlab-pane/commit/b77a5b1ca4c0e463f6eafe4645f0e5a90cd06c46))


### Code Refactoring

* rename the plugin to gitlab-pane, compress the docs, and format with Biome ([#35](https://github.com/alxleo/gitlab-pane/issues/35)) ([7b52d4f](https://github.com/alxleo/gitlab-pane/commit/7b52d4fce14fc918a3c57611774e4d8491fb0dd4))

## [0.2.1](https://github.com/alxleo/gitlab-pane/compare/v0.2.0...v0.2.1) (2026-11-02)


### Bug Fixes

* **security:** https-only avatars; CI checks secrets and workflows ([#2](https://github.com/alxleo/gitlab-pane/issues/2)) ([6a9dfa4](https://github.com/alxleo/gitlab-pane/commit/6a9dfa4198b1ec38f5154b0e9eff00571ec3b44e))

## [0.2.0](https://github.com/alxleo/gitlab-pane/compare/v0.1.0...v0.2.0) (2026-11-01)


### Features

* **jira:** read ticket details with Atlassian's acli ([a28ec71](https://github.com/alxleo/gitlab-pane/commit/a28ec7114f6de557bd7903dabc58172a7547b5f4))
* **tools:** CI draws the README screenshots ([faca0b1](https://github.com/alxleo/gitlab-pane/commit/faca0b1675652b49ffc3f88e637054d08b627ba3))


### Bug Fixes

* **tools:** pane-screens rebases before pushing and fails loudly ([0585922](https://github.com/alxleo/gitlab-pane/commit/05859220315c2666784a457516feb429e0d0844b))
