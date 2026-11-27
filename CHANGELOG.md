# Changelog

## [0.4.5](https://github.com/alxleo/gitlab-pane/compare/v0.4.4...v0.4.5) (2026-11-27)


### Features

* **mine:** search as you type, and open a person or ticket under its card instead of a page ([#128](https://github.com/alxleo/gitlab-pane/issues/128)) ([38caa0c](https://github.com/alxleo/gitlab-pane/commit/38caa0cd43da939b5b34b4aaf2931db335ff540b))
* **pane:** a card short of a reviewer offers whom GitLab suggests, faded, and two presses add them ([#132](https://github.com/alxleo/gitlab-pane/issues/132)) ([be69ec6](https://github.com/alxleo/gitlab-pane/commit/be69ec6093c10c11b639024aafec898b2e80427f))
* **pane:** every MR card drawn alike, with a line down its left in its verdict's colour ([#142](https://github.com/alxleo/gitlab-pane/issues/142)) ([9eb6cf7](https://github.com/alxleo/gitlab-pane/commit/9eb6cf7c12570fbf7109906eb5d50804ada2ea44))
* **pane:** every symbol says what it means once the pointer rests on it ([#131](https://github.com/alxleo/gitlab-pane/issues/131)) ([da5718f](https://github.com/alxleo/gitlab-pane/commit/da5718f5977fda9dbeefffe2bd60ba8075808274))


### Bug Fixes

* **pane:** suggest the people who own the code, ranked by who approves there, badged ＋ ([#143](https://github.com/alxleo/gitlab-pane/issues/143)) ([5ddefab](https://github.com/alxleo/gitlab-pane/commit/5ddefab7d43cc95e9089818fbe30c6d06eb82bf7))
* **release:** rename main's release folder so `--ref release` checks out the branch ([#135](https://github.com/alxleo/gitlab-pane/issues/135)) ([3916823](https://github.com/alxleo/gitlab-pane/commit/3916823963dc4dd468b13de1c417dd798f16611c))
* **validate:** import the core without .ts endings so validate passes on Claude Code 2.1.323+ ([#138](https://github.com/alxleo/gitlab-pane/issues/138)) ([cd1534f](https://github.com/alxleo/gitlab-pane/commit/cd1534fcbcc1a049a78b546a0cdf75ed1e31eaa4))

## [0.4.4](https://github.com/alxleo/gitlab-pane/compare/v0.4.3...v0.4.4) (2026-11-21)


### Features

* **chatgpt:** ship the ChatGPT panel beside the mod, under the same checks and releases ([#133](https://github.com/alxleo/gitlab-pane/issues/133)) ([954d460](https://github.com/alxleo/gitlab-pane/commit/954d4607ce671da8116b6598d8dc9843aed160dc))
* **mine:** a search box finds an MR the pane holds by its number, ticket or words ([#120](https://github.com/alxleo/gitlab-pane/issues/120)) ([13c8aa1](https://github.com/alxleo/gitlab-pane/commit/13c8aa10a6cf98fa5b9d8ad409243e989a286ec7))
* **mine:** fold your recently merged MRs last, each with the build that landed on its target ([#110](https://github.com/alxleo/gitlab-pane/issues/110)) ([8088e6b](https://github.com/alxleo/gitlab-pane/commit/8088e6b66dd9688525c8d10a6dbf1b02524e0184))
* **pane:** follow the app's light or dark theme, and say nothing by colour alone ([#123](https://github.com/alxleo/gitlab-pane/issues/123)) ([8ee8f9b](https://github.com/alxleo/gitlab-pane/commit/8ee8f9be43dff0d8d6a31769c4f013cf56f79533))
* ready-to-merge cards come first, show the head they merge, and lead with their move ([#106](https://github.com/alxleo/gitlab-pane/issues/106)) ([a499b89](https://github.com/alxleo/gitlab-pane/commit/a499b89a87d3384d961022018b2965cad618ae37))
* **tools:** a live browser preview of the pane a checkout draws, from real GitLab ([#122](https://github.com/alxleo/gitlab-pane/issues/122)) ([e1d58d1](https://github.com/alxleo/gitlab-pane/commit/e1d58d15b7fa27e6f42871177e6ef1fa37b0d477))


### Bug Fixes

* **merge:** squash as GitLab will, so a project that always squashes merges from the pane ([#107](https://github.com/alxleo/gitlab-pane/issues/107)) ([c242c3c](https://github.com/alxleo/gitlab-pane/commit/c242c3ccee57dd5db0d84051f18b5b52b5dee4f1))
* **reads:** ask run times and tickets at their pace, even for one that gets no answer ([#121](https://github.com/alxleo/gitlab-pane/issues/121)) ([088cb29](https://github.com/alxleo/gitlab-pane/commit/088cb29933cd0111091b88ff32431aa4006849c8))
* **shot:** give Hammerspoon as long as the call, so listing the windows does not time out ([#112](https://github.com/alxleo/gitlab-pane/issues/112)) ([30bd5da](https://github.com/alxleo/gitlab-pane/commit/30bd5daddf17f25ac8c4d3a52850f78f6eb790ac))
* **tools:** unpack the engine's declarations under CLAUDE_CODE_TMPDIR, the folder claude reads ([#113](https://github.com/alxleo/gitlab-pane/issues/113)) ([3a66b59](https://github.com/alxleo/gitlab-pane/commit/3a66b5978d5b97cee6fd8bc90a87310a02598f5f))


### Performance Improvements

* **markdown:** a fence with no closer tries only the lengths some line closes with ([#130](https://github.com/alxleo/gitlab-pane/issues/130)) ([7852cee](https://github.com/alxleo/gitlab-pane/commit/7852cee31e19aa007c2acc65c59467f39698b3f5))
* **mine:** read the list without its jobs or system notes, so it answers well inside the limit ([#116](https://github.com/alxleo/gitlab-pane/issues/116)) ([859f106](https://github.com/alxleo/gitlab-pane/commit/859f10601f3267719c042b6c8dabdfb788a990b2))

## [0.4.3](https://github.com/alxleo/gitlab-pane/compare/v0.4.2...v0.4.3) (2026-11-11)


### Bug Fixes

* **inbox:** a push says how many commits it added, not GitLab's HTML list of them ([#100](https://github.com/alxleo/gitlab-pane/issues/100)) ([9ecf6b3](https://github.com/alxleo/gitlab-pane/commit/9ecf6b3902b35f984d96399367f09c7084acb4f6))

## [0.4.2](https://github.com/alxleo/gitlab-pane/compare/v0.4.1...v0.4.2) (2026-11-11)


### Features

* a band above the prompt says the inbox news while the pane does not ([#94](https://github.com/alxleo/gitlab-pane/issues/94)) ([fcdcf36](https://github.com/alxleo/gitlab-pane/commit/fcdcf368b3a4141b01e63b7178e77aa919341ac0))
* a star pins a card; ↻ and 🔔 at the top right refresh and say whether Claude wakes ([#87](https://github.com/alxleo/gitlab-pane/issues/87)) ([d966d15](https://github.com/alxleo/gitlab-pane/commit/d966d15f457f7a1009d3b52e1058f37818316b16))
* arrows walk the inbox's cards and s marks the open tab seen ([#88](https://github.com/alxleo/gitlab-pane/issues/88)) ([21681fb](https://github.com/alxleo/gitlab-pane/commit/21681fbd7d110996327db217ecf993ca9709e29c))
* **jira:** move an MR's ticket to in review, and to done after merge ([#92](https://github.com/alxleo/gitlab-pane/issues/92)) ([fdecb04](https://github.com/alxleo/gitlab-pane/commit/fdecb04d174e5c96d5f108d6add82fc40db399a0))
* pin the MRs you work on and the rest folds to one line; a week untouched parks an MR ([#85](https://github.com/alxleo/gitlab-pane/issues/85)) ([972d478](https://github.com/alxleo/gitlab-pane/commit/972d478682eb762d13631de153d607a4a128b635))
* reply to a review thread beside its diff, posted once you confirm ([#91](https://github.com/alxleo/gitlab-pane/issues/91)) ([d56922e](https://github.com/alxleo/gitlab-pane/commit/d56922e4b8556102ff2140c3f04109204641b2e2))
* **rig:** print what the window showed in each step ([#96](https://github.com/alxleo/gitlab-pane/issues/96)) ([6db4e86](https://github.com/alxleo/gitlab-pane/commit/6db4e86d62078bc23bf121376f661faee5e4b1fc))
* the repo filter is one picker, a single row however many repos; a phone keeps its buttons ([#89](https://github.com/alxleo/gitlab-pane/issues/89)) ([4a3dd52](https://github.com/alxleo/gitlab-pane/commit/4a3dd52b6bbddf175eab80462adfec1074bf681e))
* the verdict is the MR's one move: merge, rebase, or hand conflicts to Claude ([#95](https://github.com/alxleo/gitlab-pane/issues/95)) ([aa952db](https://github.com/alxleo/gitlab-pane/commit/aa952dbce9299470638c4a2edb23d60913c770d7))
* **tools:** pane-shot checks the pane in the running desktop app ([#90](https://github.com/alxleo/gitlab-pane/issues/90)) ([c883040](https://github.com/alxleo/gitlab-pane/commit/c883040b92d9f181019e5000eb65918ff414e2dc))


### Bug Fixes

* going back from an MR's page corrects for rows that changed above its card ([#83](https://github.com/alxleo/gitlab-pane/issues/83)) ([5a165fa](https://github.com/alxleo/gitlab-pane/commit/5a165fa11c29b284a7d50b6efe5f4c457a26035f)), closes [#18](https://github.com/alxleo/gitlab-pane/issues/18)
* **jira:** a ticket that has been in review is never moved back to it ([#99](https://github.com/alxleo/gitlab-pane/issues/99)) ([57510a6](https://github.com/alxleo/gitlab-pane/commit/57510a6a9e6773b9c0067900a92c0088cd83bb54))
* read hostile GitLab text in time in proportion to it ([#81](https://github.com/alxleo/gitlab-pane/issues/81)) ([c64cba5](https://github.com/alxleo/gitlab-pane/commit/c64cba543d80bb5d61a3546d2ce6181ab9b24c4f))
* the desktop draws ↻, 🔔 and the star, and a reload keeps the pane on older cards ([#97](https://github.com/alxleo/gitlab-pane/issues/97)) ([00c1b62](https://github.com/alxleo/gitlab-pane/commit/00c1b62f776d98f816cad5a347137edafdd02165))

## [0.4.1](https://github.com/alxleo/gitlab-pane/compare/v0.4.0...v0.4.1) (2026-11-10)


### Features

* a quiet MR is one line, its title, what it waits on and its age ([#78](https://github.com/alxleo/gitlab-pane/issues/78)) ([973368a](https://github.com/alxleo/gitlab-pane/commit/973368a5b346c6dc1c7f788a18b66ea8b809a85b))
* **screens:** a pull request's delta pictures, the change outlined and the rest faded ([#79](https://github.com/alxleo/gitlab-pane/issues/79)) ([962d3b1](https://github.com/alxleo/gitlab-pane/commit/962d3b1ccce6c9aba8078663904f8c841bb47292))
* the verdict counts the open threads, and an MR's page explains its verdict ([#77](https://github.com/alxleo/gitlab-pane/issues/77)) ([e650721](https://github.com/alxleo/gitlab-pane/commit/e65072107aa3c7edebe79885f3ca16a97d706978))

## [0.4.0](https://github.com/alxleo/gitlab-pane/compare/v0.3.0...v0.4.0) (2026-11-10)


### Features

* a card's title opens its MR's page, and nothing on the list waits for a hover ([#74](https://github.com/alxleo/gitlab-pane/issues/74)) ([bd12369](https://github.com/alxleo/gitlab-pane/commit/bd12369ba822b8a2f2c099feae7c5f23d7f63c9a))


### Bug Fixes

* turn on oxlint's correctness rules, and cut display text by graphemes ([#73](https://github.com/alxleo/gitlab-pane/issues/73)) ([1218164](https://github.com/alxleo/gitlab-pane/commit/12181644b5dbe84520f21fbf7c86ba7e64ba8da6))

## [0.3.0](https://github.com/alxleo/gitlab-pane/compare/v0.2.1...v0.3.0) (2026-11-10)


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
* draw the last cards at once while a slow GitLab read is out ([#66](https://github.com/alxleo/gitlab-pane/issues/66)) ([b575e25](https://github.com/alxleo/gitlab-pane/commit/b575e25891302e86a4529ba2bd7ea9ba8880306d))
* going back lands on the card by opening the page only after the list moves ([8d2b750](https://github.com/alxleo/gitlab-pane/commit/8d2b75044489dc73a49ca7a6b1bcd4c82dd7104b))
* going back scrolls to the MR's title button, the card's box being one the desktop never reports ([2f79967](https://github.com/alxleo/gitlab-pane/commit/2f79967398643fe95a585391dd73ab271bd1efe5))
* send each GitLab token only to its own host, and fixes from the merge-train review ([#46](https://github.com/alxleo/gitlab-pane/issues/46)) ([b77a5b1](https://github.com/alxleo/gitlab-pane/commit/b77a5b1ca4c0e463f6eafe4645f0e5a90cd06c46))
* the Mine tab counts what All counts, and the list's own heading says Ready ([#67](https://github.com/alxleo/gitlab-pane/issues/67)) ([53f5dff](https://github.com/alxleo/gitlab-pane/commit/53f5dff529f49136c46b27238f52571687ea2661))


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
