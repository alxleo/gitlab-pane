# Working in gitlab-pane

A Claude Code mod in TypeScript: a GitLab pane beside the session. [README.md](../README.md) says what it does, [DESIGN.md](../DESIGN.md) what each colour means, [CONTRIBUTING.md](../CONTRIBUTING.md) how to set up, which script checks what, and how releases work. `claude-code` comes from the engine at runtime, not npm.

Before changing what the pane shows, how it behaves, or what Claude is handed, read [AGENTS.md](../AGENTS.md) and the [product brief](../PRODUCT_BRIEF.md): the brief, not the current code, says what the pane is meant to become.

## No debt

- Dead code is an error (`npm run knip`): delete it. A path knip cannot see goes in `knip.jsonc` with its reason, never ignored per export.
- Whoever adds a rule fixes every violation in the same change. No allowlists, ratchets or "to be split" lists. No disable comments: `eslint-disable`, `@ts-ignore`, `@ts-expect-error` and `@ts-nocheck` are errors. A wrong rule changes in `eslint.config.cjs`, with its reason beside it.
- Do not hide a violation in another form (a cast in a helper, state in a const object). If the rule is in the way, the code is.
- Change an existing test before adding one: a changed behaviour edits the test that names it. A bug fix starts with a test that fails for it. Fix the code, not the test; never weaken an assertion to go green.

## Layers

| Rule | Detail |
| --- | --- |
| The core is pure code on plain data | The files in `include` of `tsconfig.core.json`: the one list (the linter and `tools/check_core.ts` read it). `claude-code` is not importable there. A new file joins by being listed. |
| Imports | A core file imports core files by their `.ts` path, and `../types`. Other files import without extensions. `tools/*.ts` import `gitlab-documents.ts` and `decode.ts` under plain Node. |
| New logic | On plain data goes in the core, with a test on plain data. Engine-facing files stay thin: `pane.tsx`, `card.tsx`, `poll.ts`, `choices.ts`, `data.ts`, `inbox.ts`, `register.tsx`. |
| `fromGitLab` (`markdown.ts`) | Turns text into GitLab's Markdown to draw; only `gitlab.ts` imports it (`local/only-importers`). Anything else gets such text from `cleanBody`. |
| Module state | None: no module `let` or mutated `const`. State lives in atoms. `in-flight.ts` alone holds promises and callbacks. |
| Size | No file in `hooks/` over 400 lines. |
| Conditions | No `if (text)` or `if (count)` anywhere: say `!== ''`, `> 0`, `!== null`. |

## Types

- No `x as T` (`as const` is fine). The only assertions: `decodeGraphql` in `decode.ts` (GitLab checked the answer against the schema the types came from), and the private `brand` in `markdown.ts`, `model-text.ts` and `svg.ts`.
- Narrow with a type guard. An annotated `x is T` must test `x` in its body (`typeof`, `in`, `instanceof`, `Array.isArray`, or a call of another guard); a null check is left unannotated for the compiler to infer. An overload implementation returns no more than its signatures.
- No `any`, no `!`. No `JSON.parse`: use `parseJson`.
- GitLab's types: documents are static strings in `gitlab-documents.ts`; `hooks/gitlab.generated.ts` is made from them and `tools/gitlab_schema.snapshot.json` by `npm run schema -- types`. Never edit it; a stale one fails `npm run check`. `schema -- snapshot` refreshes the snapshot from gitlab.com.
- `types/index.d.ts` stays one self-contained file (`claude plugin validate --strict`): domain types cannot move out, and every atom key is declared there.
- The engine's declarations are not committed: `npm run setup` unpacks them into git-ignored `.claude-plugin/types/`. `tsconfig.core.json` has none, which keeps the core off the engine.
- The Claude Code version is pinned in `check.yml`, `screens.yml` and `tools/pane_screens.ts`: change all together.

## What the engine enforces

| Constraint | Consequence |
| --- | --- |
| A hook's matcher is read from literals and consts in `register.tsx` only | `PANE` lives there, beside `PANE_ID` in `panes.ts`; `tests/register.test.ts` keeps them equal. |
| An atom is read and written only in the file that declares it (`claude plugin validate` fails otherwise) | Go through that file's functions: `data.ts`, `choices.ts`, `panes.ts`, `failures.ts`, `inbox.ts`, `job-failures.ts`. |
| `$` goes in no object, and is passed on only into function declarations (`function quietly($, …)`), not arrow consts | The draw kit (`kit.tsx`) holds no `$`; `buildCard($, kit, …)` takes both. |
| A render hook may not write an atom | What it records (`health` in `register.tsx`, `drawn` in `in-flight.ts`) cannot be one. |
| The desktop draws nothing for a tree past 100,000 characters | `DRAWING_BUDGET` in `drawing.ts` is 85,000. Measure with `measure`; drop rows rather than overshoot. |
| Atoms and settings are keyed by plugin id | The id is `gitlab-pane`; renaming it loses installs' settings and store. |

## Words the model reads

- Wakes and `watch_mr` answers never carry other people's words (comments, descriptions, titles): only who, what and where.
- Text from GitLab reaches the model only through `foreign` in `model-text.ts`.

## Toolchain

- Node only: every tool, check and hook is TypeScript run by Node (`node tools/<name>.ts` or an `npm run` script). No bash, no Python. A new tool is a `tools/*.ts` file under the same lint. The only shell is a workflow's `run:` lines.
- One `package.json` and one `package-lock.json`; the published tree leaves both out. Git hooks are written by `simple-git-hooks` from `package.json`; no script lives in the repository.
- gitleaks, actionlint and zizmor are not Node tools: CI runs them; `npm run scan` runs those installed.
- Formatting is Biome's (`biome.jsonc`, formatter only): never hand-format, run `npm run format`. ESLint sets no formatting rule; keep it that way, so the two cannot disagree. A tool that generates a file formats its output through `tools/format.ts`.
- On editing a core file, `.claude/settings.json` runs the core's `tsc`, `eslint` and `biome format`: read what it says.

## Before you commit

- Run `npm run check` and `npm test`; CI runs the same and has gone red when a branch skipped one.
- Messages are conventional (`feat:`, `fix(jira):`, `docs:` …); commitlint checks them. Do not edit `CHANGELOG.md`: releases write it.
- Author and committer must be GitHub noreply addresses (CI fails any other). Set git's `author.*` and `committer.*` apart, not `user.*`, so a rebase keeps both right. In an agent container, `author.*` is the human's noreply identity and `committer.*` is `Claude <noreply@anthropic.com>`.

## Tests

- Pure logic: `tests/core/<module>.spec.ts` (Vitest and fast-check, plain Node), named after the core module it tests. `tests/*.test.ts` (`claude plugin test`) is only for wiring, drawing, wakes end to end, the budgets and the scenes. Shared data: `tests/fixtures.ts`.
- A test name is a sentence saying what happens: `a pipeline that failed twice shows its latest failure`.
- `tests/core/reconcile.spec.ts` is the model of a pure test; `tests/watch.test.ts` is the engine smoke test. Property tests use a fixed seed (`tests/core/setup.ts`); fast-check prints the seed and path of a counterexample.
