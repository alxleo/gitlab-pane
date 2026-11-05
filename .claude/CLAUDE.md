# Working in gitlab-pane

A Claude Code mod in TypeScript: a GitLab pane beside the session. README.md says what it does, DESIGN.md what each colour means, CONTRIBUTING.md how the checks run. The `claude-code` module comes from the engine at runtime, not npm.

## No debt from day one

- Whoever adds a rule fixes every violation of it, in the same change. There are no allowlists, no ratchets, no "to be split" lists, and no disable comments: `eslint-disable` is itself an error, and so is `@ts-ignore`. A rule that is wrong changes in `eslint.config.cjs`, with its reason beside it.
- Do not hide a violation in another form (a cast in a helper, state in a const object). If the rule seems to be in the way, the code is.
- Change existing tests before adding new ones: a behaviour that changes edits the test that names it. A bug fix starts with a test that fails for it.

## Layers

- The core is pure code on plain data: the files in `include` in `tsconfig.core.json`, the one list of it (the linter and the Claude hook, `tools/check_core.ts`, read it too). `claude-code` is not importable there.
- A core file imports only core files, each by its `.ts` path (`import { x } from './identity.ts'`; the `tools/*.ts` import `gitlab-documents.ts` and `decode.ts` under plain Node), and `../types`. Other files import the core, the engine and each other without extensions.
- New logic that can run on plain data goes in the core, with a test on plain data. The engine-facing files (`pane.tsx`, `card.tsx`, `poll.ts`, `choices.ts`, `data.ts`, `inbox.ts`, `register.tsx`) stay thin. A new file joins the core by being listed in `tsconfig.core.json`.
- No `x as T` anywhere (`as const` is fine). The only assertions: `decodeGraphql` in `decode.ts` (the GraphQL boundary: GitLab checked the answer against the schema the types came from) and the private `brand` of `markdown.ts` (it stamps `GitLabMarkdown` through `fromGitLab`, which only `gitlab.ts` calls), `model-text.ts` and `svg.ts`. Narrow with a type guard instead: an annotated `x is T` must test `x` in its body (`typeof`, `in`, `instanceof`, `Array.isArray`, or a call of another guard), a null check is left unannotated for the compiler to infer, and an overload implementation returns no more than its signatures. No `any`, no `!`, no `JSON.parse` outside the core (use `parseJson`).
- `fromGitLab` (markdown.ts) turns text into GitLab's Markdown to draw, so only `gitlab.ts` may import it (the lint rule `local/only-importers`); anything else gets such text from `cleanBody`.
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
- GitLab's types: documents are static strings in `gitlab-documents.ts`; `hooks/gitlab.generated.ts` is made from them and `tools/gitlab_schema.snapshot.json` by `npm run schema -- types` (never edit it; a stale one fails `npm run check`). `npm run schema -- snapshot` refreshes the snapshot from gitlab.com.
- The engine's declarations are not committed: `npm run setup` (or `node tools/engine_types.ts`) has the `claude` on PATH unpack them from its bundled plugin-authoring skill (no sign-in, no network) into the git-ignored `.claude-plugin/types/`, where the full `tsc -p tsconfig.json` and the type-aware lint over every file read them. `tsconfig.core.json` still has no engine types, which keeps the core from importing the engine. The Claude Code version is pinned in `check.yml`, `screens.yml` and `tools/pane_screens.ts`: change all three together, and the declarations follow.

## One toolchain: Node

- Every tool, check and hook is TypeScript run by Node (`node tools/<name>.ts`, or an `npm run` script); there is no bash or shell script and no Python in the repository. A new tool is a `tools/*.ts` file, held to the same lint as the rest. The only shell is a workflow's own `run:` lines. One `package.json` holds the dev dependencies and one `package-lock.json` pins them; the published tree leaves both out.
- `npm ci` then `npm run setup` once per clone (git hooks and the engine's declarations). The hooks run `npm run check:fast`, the commit-message check and `npm test`; they are written by `simple-git-hooks` from `package.json`, and no script lives in the repository.
- Gitleaks, actionlint and zizmor are not Node tools: CI runs them with their official actions, `npm run scan` runs whichever is installed and says which it skipped.

## Commits

- The author must be a GitHub noreply address (`<id>+<name>@users.noreply.github.com`); the committer the same, or `noreply@anthropic.com` for a commit Claude signs. CI fails any other. Set git's `author.*` and `committer.*` apart, not `user.*`, so a rebase keeps both right. In an agent container that means `author.*` is the human's GitHub noreply identity and `committer.*` is Claude (`Claude <noreply@anthropic.com>`).
- Conventional messages: `feat:`, `fix(jira):`, `docs:`, `test:`, `ci:`, `refactor:`, `chore:`; commitlint checks them in the commit-msg hook and in CI, on a pull request's title too. Releases are worked out from them. Do not edit `CHANGELOG.md`.

## Before you commit

Run all of these; CI runs the same and has gone red when a branch skipped one.

```bash
npm run check            # files, lint, all type-checks, GitLab types, release tree, plugin validate, scanners that are installed
npm test                 # claude plugin test .
```

`npm run check` includes the full `tsc` over every config (the core, the engine-facing files, `tools/store-probe`, `tools/*.ts`), the type-aware lint over every file, `claude plugin validate --strict` on the plugin and on the store probe, and the release-tree check. `.claude/settings.json` runs the core's `tsc` and `eslint` on a core file you edit; read what it says.

## Tests

- They live in `tests/*.test.ts` and import from `claude-code/testing`; shared data is in `tests/fixtures.ts`.
- A test name is a sentence that says what happens: `a pipeline that failed twice shows its latest failure`.
- Test pure logic on plain data, with no engine: see `tests/reconcile.test.ts`. A few engine-level tests (`tests/watch.test.ts`) stay as smoke tests that the whole pane draws and wakes.
- Fix the code, not the test, when they disagree. Do not weaken an assertion to go green.
