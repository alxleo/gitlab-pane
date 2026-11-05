#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""release-tree — the files the plugin ships, copied out of the repository and checked.

\b
  release_tree.py build DIR    copy the files named in release/files into DIR (made empty first), then check them
  release_tree.py check        build into a scratch directory and check, leaving nothing behind

Installing the plugin copies its whole source, and the repository holds far more than runs: tools, tests, screenshots,
fonts. The release job publishes the tree this builds, to the `release` branch, and the marketplace installs from there.

The check starts at the modules named in hooks/hooks.json and follows every import that survives type-stripping (not
`import type`, not `export type`), in the built tree and not in the repository, so a file the allowlist forgot is found
as a file that is missing. It fails when:

\b
  - a listed file is missing, listed twice, or a directory
  - a module that loads imports a relative path the tree does not hold, or a package other than 'claude-code'
    (the mod cannot load npm packages)
  - a .ts or .tsx file under hooks/ is shipped and nothing loads it
  - plugin.json names a `types` file the tree does not hold
  - the README links or shows a relative path (the tree holds no docs/ or CONTRIBUTING.md): links there are absolute
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "release" / "files"
SUFFIXES = (".ts", ".tsx", ".js", ".mjs")
ENGINE = "claude-code"

COMMENTS = re.compile(r"/\*.*?\*/|^[ \t]*//[^\n]*", re.S | re.M)
# `import x from 'm'`, `import {…} from 'm'`, `export {…} from 'm'`, `export * from 'm'`; the clause may span lines.
FROM = re.compile(r"^[ \t]*(?:import|export)(?P<clause>[^;'\"`]*?)\bfrom\s*['\"](?P<spec>[^'\"]+)['\"]", re.M)
SIDE_EFFECT = re.compile(r"^[ \t]*import\s*['\"](?P<spec>[^'\"]+)['\"]", re.M)
DYNAMIC = re.compile(r"\bimport\(\s*['\"](?P<spec>[^'\"]+)['\"]\s*\)")
LINK = re.compile(r"\]\((?P<md>[^)\s]+)|\b(?:src|href)=[\"'](?P<html>[^\"']+)")


def entries() -> list[tuple[str, str]]:
    """(source, destination) for each line of the allowlist."""
    out: list[tuple[str, str]] = []
    for number, raw in enumerate(MANIFEST.read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) > 2 or any(c in line for c in "*?[]"):
            raise SystemExit(f"{MANIFEST.relative_to(ROOT)}:{number}: one path, or a source and a destination; no patterns")
        out.append((parts[0], parts[-1]))
    return out


def build(dest: Path) -> list[str]:
    problems: list[str] = []
    seen: set[str] = set()
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    for src, dst in entries():
        if dst in seen:
            problems.append(f"{dst} is listed twice")
            continue
        seen.add(dst)
        source = ROOT / src
        if not source.is_file():
            problems.append(f"{src} is listed but is not a file")
            continue
        (dest / dst).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest / dst)
    return problems


def survivors(source: str) -> list[str]:
    """The module specifiers a type-stripped file still loads."""
    code = COMMENTS.sub("", source)
    found = [m["spec"] for m in SIDE_EFFECT.finditer(code)] + [m["spec"] for m in DYNAMIC.finditer(code)]
    for m in FROM.finditer(code):
        # `import type {…}` and `export type {…}` are erased whole; `import { type A }` still loads the module.
        if not re.match(r"\s+type\b(?!\s+from\b)", m["clause"]):
            found.append(m["spec"])
    return found


def resolve(tree: Path, importer: Path, spec: str) -> Path | None:
    base = (importer.parent / spec).resolve()
    candidates = [base] if base.suffix in SUFFIXES else []
    candidates += [Path(f"{base}{s}") for s in SUFFIXES] + [base / f"index{s}" for s in SUFFIXES]
    return next((c for c in candidates if c.is_file() and c.is_relative_to(tree)), None)


def closure(tree: Path) -> tuple[set[Path], list[str]]:
    problems: list[str] = []
    hooks = tree / "hooks" / "hooks.json"
    if not hooks.is_file():
        return set(), ["hooks/hooks.json is not in the tree"]
    pending = [(hooks, (hooks.parent / m).resolve()) for m in json.loads(hooks.read_text()).get("modules", [])]
    loaded: set[Path] = set()
    while pending:
        importer, module = pending.pop()
        if not module.is_file() or not module.is_relative_to(tree):
            problems.append(f"{importer.relative_to(tree)} loads {module}, which the tree does not hold")
            continue
        if module in loaded:
            continue
        loaded.add(module)
        for spec in survivors(module.read_text()):
            if spec == ENGINE or spec.startswith("node:"):
                continue
            if not spec.startswith("."):
                problems.append(f"{module.relative_to(tree)} imports '{spec}': the mod cannot load packages")
                continue
            target = resolve(tree, module, spec)
            if target is None:
                problems.append(f"{module.relative_to(tree)} imports '{spec}', which the tree does not hold: add it to release/files")
            else:
                pending.append((module, target))
    return loaded, problems


def verify(tree: Path) -> list[str]:
    loaded, problems = closure(tree)
    for file in sorted((tree / "hooks").glob("*.ts*")):
        if file.suffix in (".ts", ".tsx") and file.resolve() not in loaded:
            problems.append(f"hooks/{file.name} ships but nothing loads it: take it out of release/files")
    readme = tree / "README.md"
    if readme.is_file():
        for m in LINK.finditer(readme.read_text()):
            target = m["md"] or m["html"]
            if not target.startswith(("https://", "#")):
                problems.append(f"README.md links to {target}: make it an absolute https:// link, the tree does not hold that path")
    plugin = tree / ".claude-plugin" / "plugin.json"
    if not plugin.is_file():
        problems.append(".claude-plugin/plugin.json is not in the tree")
    else:
        types = json.loads(plugin.read_text()).get("types")
        if types and not (tree / types).resolve().is_file():
            problems.append(f"plugin.json names types {types}, which the tree does not hold")
    return problems


def report(tree: Path, problems: list[str]) -> int:
    if problems:
        print("The release tree is not self-contained:", file=sys.stderr)
        for p in problems:
            print(f"  {p}", file=sys.stderr)
        return 1
    files = sorted(p for p in tree.rglob("*") if p.is_file())
    size = sum(p.stat().st_size for p in files)
    print(f"{len(files)} files, {size} bytes; every module that loads resolves inside the tree")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[1] == "build":
        tree = Path(argv[2]).resolve()
        return report(tree, build(tree) + verify(tree))
    if len(argv) == 2 and argv[1] == "check":
        with tempfile.TemporaryDirectory() as scratch:
            tree = Path(scratch).resolve() / "tree"
            return report(tree, build(tree) + verify(tree))
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
