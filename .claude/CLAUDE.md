# Working in gitlab-pane

A Claude Code mod in TypeScript: a GitLab pane beside the session. README.md says what it does, DESIGN.md what each colour means, CONTRIBUTING.md how the checks run. The `claude-code` module comes from the engine at runtime, not npm.

## No debt from day one

- Whoever adds a rule fixes every violation of it, in the same change. There are no allowlists, no ratchets, no "to be split" lists, and no disable comments: `eslint-disable` is itself an error, and so is `@ts-ignore`. A rule that is wrong changes in `eslint.config.cjs`, with its reason beside it.
- Do not hide a violation in another form (a cast in a helper, state in a const object). If the rule seems to be in the way, the code is.
- Change existing tests before adding new ones: a behaviour that changes edits the test that names it. A bug fix starts with a test that fails for it.

## Layers

- The core is pure code on plain data: the files in `include` in `tsconfig.core.json`, the one list of it (the linter and the Claude hook read it too). `claude-code` is not importable there.
- A core file imports only core files, each by its `.ts` path (`import { x } from './identity.ts'`; `tools/gitlab_queries.ts` runs `gitlab.ts` under plain Node), and `../types`. Other files import the core, the engine and each other without extensions.
- New logic that can run on plain data goes in the core, with a test on plain data. The engine-facing files (`pane.tsx`, `card.tsx`, `poll.ts`, `choices.ts`, `data.ts`, `inbox.ts`, `register.tsx`) stay thin. A new file joins the core by being listed in `tsconfig.core.json`.
- No `x as T` anywhere (`as const` is fine). The only assertions: `decodeGraphql` in `decode.ts` (the GraphQL boundary: GitLab checked the answer against the schema the types came from) and the private `brand` of `markdown.ts`, `model-text.ts` and `svg.ts`. Narrow with a type guard instead: an annotated `x is T` must test `x` in its body (`typeof`, `in`, `instanceof`, `Array.isArray`, or a call of another guard), a null check is left unannotated for the compiler to infer, and an overload implementation returns no more than its signatures. No `any`, no `!`, no `JSON.parse` outside the core (use `parseJson`).
- No state in module variables, `let` or mutated `const`. State lives in atoms; `in-flight.ts` alone may hold promises and callbacks, which an atom cannot store.
- No file in `hooks/` over 400 lines. In the core, no `if (text)` or `if (count)`: say `!== ''`, `> 0`, `!== null`.

## What the engine enforces, mostly in comments

- A hook's matcher is read from literals and consts in `register.tsx` only. That is why `PANE` lives there, beside `PANE_ID` in `panes.ts`; `tests/register.test.ts` keeps them equal.
- An atom is read and written only in the file that declares it (`claude plugin validate` fails otherwise). Other files go through that file's functions: `data.ts`, `choices.ts`, `panes.ts`, `failures.ts`, `inbox.ts` each hold their own.
- `$` is never put in an object, and it is passed on only into function declarations (`function quietly($, …)`), not arrow consts. So the draw kit (`kit.tsx`) holds no `$`; `buildCard($, kit, …)` takes both.
- A render hook may not write an atom, so what it must record (`health` in `register.tsx`, `drawn` in `in-flight.ts`) cannot be one.
- The desktop draws nothing for a tree past 100,000 characters. `DRAWING_BUDGET` in `drawing.ts` is 85,000; measure with `measure`, and drop rows rather than overshoot.
- `types/index.d.ts` must stay one self-contained file for `claude plugin validate --strict`. Domain types cannot move out of it, and every atom key is declared there.
- Wakes and `watch_mr` answers never carry other people's words (comments, descriptions, titles): only who, what and where. Text from GitLab reaches the model only through `foreign` in `model-text.ts`.
- GitLab's types: documents are static strings in `gitlab.ts`; `hooks/gitlab.generated.ts` is made from them and `tools/gitlab_schema.snapshot.json` by `uv run tools/gitlab_schema.py types` (never edit it; a stale one fails the `gitlab-types` hook). `uv run tools/gitlab_schema.py snapshot` refreshes the snapshot from gitlab.com.
- The engine's declarations are not committed: `node tools/engine_types.ts` has the `claude` on PATH unpack them from its bundled plugin-authoring skill (no sign-in, no network) into the git-ignored `.claude-plugin/types/`, where the full `tsc -p tsconfig.json` and the type-aware lint over every file read them. `tsconfig.core.json` still has no engine types, which keeps the core from importing the engine. The Claude Code version is pinned in `check.yml`, `screens.yml` and `tools/pane_screens.py`: change all three together, and the declarations follow.

## Commits

- The author must be a GitHub noreply address (`<id>+<name>@users.noreply.github.com`); the committer the same, or `noreply@anthropic.com` for a commit Claude signs. CI fails any other. Set git's `author.*` and `committer.*` apart, not `user.*`, so a rebase keeps both right.
- Conventional messages: `feat:`, `fix(jira):`, `docs:`, `test:`, `ci:`, `refactor:`, `chore:`. Releases are worked out from them. Do not edit `CHANGELOG.md`.

## Before you commit

Run all of these; CI runs the same and has gone red when a branch skipped one.

```bash
pre-commit run --all-files --hook-stage manual   # every check; zizmor needs the GitHub API
claude plugin validate --strict .
claude plugin test .
```

The pre-commit run includes the full `tsc -p tsconfig.json` and the type-aware lint over every file. `.claude/settings.json` runs the core's `tsc` and `eslint` on a core file you edit; read what it says.

## Tests

- They live in `tests/*.test.ts` and import from `claude-code/testing`; shared data is in `tests/fixtures.ts`.
- A test name is a sentence that says what happens: `a pipeline that failed twice shows its latest failure`.
- Test pure logic on plain data, with no engine: see `tests/reconcile.test.ts`. A few engine-level tests (`tests/watch.test.ts`) stay as smoke tests that the whole pane draws and wakes.
- Fix the code, not the test, when they disagree. Do not weaken an assertion to go green.
