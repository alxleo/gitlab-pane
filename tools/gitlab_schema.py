#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["typer>=0.12", "pydantic>=2", "graphql-core>=3.2,<3.3"]
# ///
"""gitlab-schema — checks every query the pane sends GitLab against gitlab.com's live schema, and keeps the types of its answers.

\b
  gitlab-schema check                          fetch the schema, check the queries, the snapshot and the generated types
  gitlab-schema check --schema saved.json      check against an introspection answer saved earlier
  gitlab-schema check --save saved.json        keep the fetched schema, to compare later
  gitlab-schema snapshot                       fetch the schema and keep the part the queries use, in tools/
  gitlab-schema types                          write hooks/gitlab.generated.ts from the snapshot and the queries
  gitlab-schema types --check                  fail if that file differs from what the snapshot and queries give; no network

What it catches, before anyone sees an empty pane:

\b
  * a field, argument or enum value GitLab removed or renamed
  * one GitLab has deprecated, which it removes some releases later (fails too, so there is time to move)
  * one GitLab marks as an experiment, which may change without a deprecation (said, never failed)
  * the schema moving under the types: a field turning nullable, an enum gaining a value (the snapshot differs from live)

The tests cannot catch these: their GitLab answers are made up, in the shape the code expects. The queries come from
hooks/gitlab-documents.ts itself, printed by tools/gitlab_queries.ts under Node, so a changed query is checked as it is sent.
The documents an older self-managed GitLab needs (AuthoredPlain, PinnedPlain: no reviewState) and the Probe that picks
them are queries like the rest, so they are checked and typed here too; MergeStatus is simply not sent where
detailedMergeStatus is missing.
GitLab answers the schema without a sign-in, so this reads no token and sends nothing of yours.

The types are made by graphql-codegen (tools/codegen, versions locked there) from tools/gitlab_schema.snapshot.json: the
part of the schema the queries use, with its nullability, so a commit needs no network. `check` compares that snapshot
with the live schema, which is how a change in GitLab reaches the types.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from typing import Annotated, Any

import typer
from graphql import (
    GraphQLEnumType,
    GraphQLSchema,
    TypeInfo,
    TypeInfoVisitor,
    Visitor,
    build_client_schema,
    get_introspection_query,
    get_named_type,
    parse,
    validate,
    visit,
)
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
QUERIES_FILE = Path(__file__).resolve().parent / "gitlab_queries.ts"
CODEGEN = ROOT / "tools" / "codegen"
SNAPSHOT = ROOT / "tools" / "gitlab_schema.snapshot.json"
TYPES = ROOT / "hooks" / "gitlab.generated.ts"
ENDPOINT = "https://gitlab.com/api/graphql"
EXPERIMENT = "Status: Experiment"
# GitLab's own directives take its own types, which the queries never use.
STANDARD_DIRECTIVES = {"skip", "include", "deprecated", "specifiedBy", "oneOf"}

app = typer.Typer(add_completion=False, no_args_is_help=True, rich_markup_mode=None, help=__doc__)


@app.callback()
def main() -> None:
    """Keeps `check` a named command, beside any added later."""


class SchemaError(RuntimeError):
    """The check could not be made; exit 2, apart from the queries being wrong (exit 1)."""


class Finding(BaseModel):
    query: str
    problem: str
    fails: bool


def read_queries(node: str) -> dict[str, str]:
    try:
        ran = subprocess.run([node, str(QUERIES_FILE)], capture_output=True, text=True, cwd=ROOT, check=True)
    except (OSError, subprocess.CalledProcessError) as error:
        said = getattr(error, "stderr", "") or ""
        raise SchemaError(f"cannot print the queries with `{node} {QUERIES_FILE.name}` (Node 23.6 or newer runs .ts as is): {error}\n{said}") from error
    queries = json.loads(ran.stdout)
    if not isinstance(queries, dict) or not queries or not all(isinstance(name, str) and isinstance(text, str) for name, text in queries.items()):
        raise SchemaError(f"{QUERIES_FILE.name} printed no queries, or not as name to query:\n{ran.stdout[:500]}")
    return queries


def fetch_introspection() -> dict[str, Any]:
    body = json.dumps({"query": get_introspection_query(descriptions=True, input_value_deprecation=True)}).encode()
    request = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/json", "User-Agent": "gitlab-pane schema check"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            answer = json.load(response)
    except (OSError, ValueError) as error:
        raise SchemaError(f"cannot read GitLab's schema from {ENDPOINT}: {error}") from error
    if not isinstance(answer, dict) or "data" not in answer or answer.get("errors"):
        raise SchemaError(f"GitLab did not answer with its schema: {str(answer)[:500]}")
    return answer["data"]


def marks(schema: GraphQLSchema, name: str, document: Any) -> list[Finding]:
    """What the query uses that GitLab has deprecated or calls an experiment, from the schema's own notes."""
    found: list[Finding] = []
    info = TypeInfo(schema)

    # GitLab marks an experiment as deprecated too, its reason saying so: that one is told, not failed.
    def note(what: str, reason: str | None, description: str | None) -> None:
        if EXPERIMENT in (reason or "") or EXPERIMENT in (description or ""):
            found.append(Finding(query=name, problem=f"{what} is an experiment, so it may change without notice", fails=False))
        elif reason:
            found.append(Finding(query=name, problem=f"{what} is deprecated: {reason}", fails=True))

    class Marks(Visitor):
        def enter_field(self, node: Any, *_: Any) -> None:
            parent, field = info.get_parent_type(), info.get_field_def()
            if parent and field:
                note(f"{parent.name}.{node.name.value}", field.deprecation_reason, field.description)

        def enter_argument(self, node: Any, *_: Any) -> None:
            parent, field, argument = info.get_parent_type(), info.get_field_def(), info.get_argument()
            if parent and field and argument:
                # Introspection's own fields (`__type`) are in no type's field list, and GitLab does not deprecate them.
                key = next((key for key, value in parent.fields.items() if value is field), None)
                if key is not None:
                    note(f"{parent.name}.{key}({node.name.value}:)", argument.deprecation_reason, argument.description)

        def enter_enum_value(self, node: Any, *_: Any) -> None:
            kind = get_named_type(info.get_input_type())
            if isinstance(kind, GraphQLEnumType) and (value := kind.values.get(node.value)):
                note(f"{kind.name}.{node.value}", value.deprecation_reason, value.description)

    visit(document, TypeInfoVisitor(info, Marks()))
    return found


def check_queries(schema: GraphQLSchema, queries: dict[str, str]) -> list[Finding]:
    findings: list[Finding] = []
    for name, text in queries.items():
        document = parse(text)
        errors = validate(schema, document)
        findings += [Finding(query=name, problem=error.message, fails=True) for error in errors]
        if not errors:
            findings += marks(schema, name, document)
    return findings


def unwrap(ref: dict[str, Any]) -> str:
    """The name of the type an introspection type reference points at, under its list and non-null wrappers."""
    while ref.get("ofType"):
        ref = ref["ofType"]
    return ref["name"]


def used(schema: GraphQLSchema, queries: dict[str, str]) -> tuple[dict[str, set[str]], dict[tuple[str, str], set[str]], set[str]]:
    """What the queries use: fields by type, arguments by field, and the types of their variables."""
    fields: dict[str, set[str]] = {}
    arguments: dict[tuple[str, str], set[str]] = {}
    variables: set[str] = set()
    info = TypeInfo(schema)

    class Uses(Visitor):
        def enter_field(self, node: Any, *_: Any) -> None:
            parent = info.get_parent_type()
            if parent and not node.name.value.startswith("__"):
                fields.setdefault(parent.name, set()).add(node.name.value)

        def enter_argument(self, node: Any, *_: Any) -> None:
            parent, field = info.get_parent_type(), info.get_field_def()
            if parent and field and hasattr(parent, "fields"):
                owner = next((key for key, value in parent.fields.items() if value is field), None)
                if owner is not None:
                    arguments.setdefault((parent.name, owner), set()).add(node.name.value)

        def enter_variable_definition(self, node: Any, *_: Any) -> None:
            if kind := get_named_type(info.get_input_type()):
                variables.add(kind.name)

    for text in queries.values():
        visit(parse(text), TypeInfoVisitor(info, Uses()))
    return fields, arguments, variables


def prune(introspection: dict[str, Any], queries: dict[str, str]) -> dict[str, Any]:
    """The introspection answer cut to what the queries use: the fields they select, with their arguments and types in full
    (nullability is the point), every value of an enum and every field of an input. Descriptions go, so a note GitLab
    rewrites does not move the snapshot, and everything is sorted, so it moves only when the schema does."""
    full = introspection.get("data", introspection)["__schema"]
    by_name = {kind["name"]: kind for kind in full["types"]}
    fields, arguments, variables = used(build_client_schema({"__schema": full}), queries)
    keep: set[str] = set()
    todo = [full["queryType"]["name"], *variables]
    while todo:
        name = todo.pop()
        if name in keep:
            continue
        keep.add(name)
        kind = by_name[name]
        for field in kind.get("fields") or []:
            if field["name"] in fields.get(name, ()):
                todo += [unwrap(field["type"])]
                todo += [unwrap(arg["type"]) for arg in field["args"] if arg["name"] in arguments.get((name, field["name"]), ())]
        todo += [unwrap(field["type"]) for field in kind.get("inputFields") or []]
        todo += [possible["name"] for possible in kind.get("possibleTypes") or [] if possible["name"] in fields]

    def slim_argument(arg: dict[str, Any]) -> dict[str, Any]:
        return {**arg, "description": None}

    def slim(kind: dict[str, Any]) -> dict[str, Any]:
        name = kind["name"]
        chosen = [field for field in kind.get("fields") or [] if field["name"] in fields.get(name, ())]
        return {
            "kind": kind["kind"],
            "name": name,
            "description": None,
            "fields": sorted(
                (
                    {
                        **field,
                        "description": None,
                        "args": sorted(
                            (slim_argument(arg) for arg in field["args"] if arg["name"] in arguments.get((name, field["name"]), ())),
                            key=lambda arg: arg["name"],
                        ),
                    }
                    for field in chosen
                ),
                key=lambda field: field["name"],
            )
            if kind["kind"] in ("OBJECT", "INTERFACE")
            else None,
            "inputFields": sorted((slim_argument(field) for field in kind["inputFields"]), key=lambda field: field["name"]) if kind.get("inputFields") is not None else None,
            "interfaces": sorted((ref for ref in kind["interfaces"] if ref["name"] in keep), key=lambda ref: ref["name"]) if kind.get("interfaces") is not None else None,
            "enumValues": sorted(({**value, "description": None} for value in kind["enumValues"]), key=lambda value: value["name"]) if kind.get("enumValues") is not None else None,
            "possibleTypes": sorted((ref for ref in kind["possibleTypes"] if ref["name"] in keep), key=lambda ref: ref["name"]) if kind.get("possibleTypes") is not None else None,
        }

    return {
        "__schema": {
            "queryType": full["queryType"],
            "mutationType": None,
            "subscriptionType": None,
            "types": [slim(by_name[name]) for name in sorted(keep)],
            "directives": sorted(({**directive, "description": None, "args": [slim_argument(arg) for arg in directive["args"]]} for directive in full["directives"] if directive["name"] in STANDARD_DIRECTIVES), key=lambda directive: directive["name"]),
        }
    }


def dump(snapshot: dict[str, Any]) -> str:
    return json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n"


def generate(schema_file: Path, node: str) -> str:
    """What graphql-codegen writes for the queries in hooks/gitlab-documents.ts against the schema in the file."""
    npm = shutil.which("npm")
    if not npm:
        raise SchemaError("npm is needed to run graphql-codegen (tools/codegen)")
    modules = CODEGEN / "node_modules" / ".package-lock.json"
    if not modules.exists() or modules.stat().st_mtime < (CODEGEN / "package-lock.json").stat().st_mtime:
        ran = subprocess.run([npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline", "--prefix", str(CODEGEN)], capture_output=True, text=True)
        if ran.returncode:
            raise SchemaError(f"cannot install graphql-codegen with npm ci in tools/codegen:\n{ran.stderr[-800:]}")
    with tempfile.TemporaryDirectory() as scratch:
        out = Path(scratch) / "gitlab.generated.ts"
        env = {**os.environ, "GITLAB_SCHEMA": str(schema_file.resolve()), "GITLAB_DOCS": str(ROOT / "hooks" / "gitlab-documents.ts"), "GITLAB_TYPES": str(out)}
        ran = subprocess.run(
            [node, str(CODEGEN / "node_modules" / "@graphql-codegen" / "cli" / "esm" / "bin.js"), "--config", "codegen.yml", "--silent"],
            cwd=CODEGEN,
            env=env,
            capture_output=True,
            text=True,
        )
        if ran.returncode or not out.exists():
            raise SchemaError(f"graphql-codegen failed:\n{(ran.stdout + ran.stderr)[-1500:]}")
        return out.read_text()


def stale(what: Path, now: str) -> Finding | None:
    path = what.relative_to(ROOT)
    if what.exists() and what.read_text() == now:
        return None
    return Finding(query=str(path), problem=f"is not what the schema and queries give now; run `uv run tools/gitlab_schema.py {'snapshot' if what == SNAPSHOT else 'types'}` and commit it", fails=True)


@app.command()
def check(
    schema_file: Annotated[Path | None, typer.Option("--schema", help="An introspection answer saved earlier, instead of fetching gitlab.com's")] = None,
    save: Annotated[Path | None, typer.Option(help="Also write the fetched introspection answer here")] = None,
    node: Annotated[str, typer.Option(help="The Node that prints the queries")] = "node",
) -> None:
    """Check the pane's queries against GitLab's schema, then the snapshot and the types against what it gives now; exit 1 when one is wrong, deprecated or stale, 2 when no check could be made."""
    try:
        node = shutil.which(node) or node
        queries = read_queries(node)
        introspection = json.loads(schema_file.read_text()) if schema_file else fetch_introspection()
        if save:
            save.write_text(json.dumps(introspection))
        schema = build_client_schema(introspection.get("data", introspection))
        snapshot = dump(prune(introspection, queries))
        with tempfile.TemporaryDirectory() as scratch:
            live = Path(scratch) / "live.json"
            live.write_text(snapshot)
            types = generate(live, node)
    except (SchemaError, OSError, ValueError, TypeError, AttributeError) as error:
        typer.echo(f"gitlab-schema: {error}", err=True)
        raise typer.Exit(2) from error
    findings = check_queries(schema, queries)
    findings += [found for found in (stale(SNAPSHOT, snapshot), stale(TYPES, types)) if found]
    for finding in findings:
        typer.echo(f"{'✗' if finding.fails else '·'} {finding.query}: {finding.problem}")
    failed = [finding for finding in findings if finding.fails]
    typer.echo(f"{len(queries)} queries checked against GitLab's schema: {len(failed) or 'none'} wrong, deprecated or stale.")
    raise typer.Exit(1 if failed else 0)


@app.command()
def snapshot(
    schema_file: Annotated[Path | None, typer.Option("--schema", help="An introspection answer saved earlier, instead of fetching gitlab.com's")] = None,
    node: Annotated[str, typer.Option(help="The Node that prints the queries")] = "node",
) -> None:
    """Write tools/gitlab_schema.snapshot.json: the part of GitLab's schema the queries use."""
    try:
        queries = read_queries(shutil.which(node) or node)
        introspection = json.loads(schema_file.read_text()) if schema_file else fetch_introspection()
        SNAPSHOT.write_text(dump(prune(introspection, queries)))
    except (SchemaError, OSError, ValueError, TypeError, AttributeError) as error:
        typer.echo(f"gitlab-schema: {error}", err=True)
        raise typer.Exit(2) from error
    typer.echo(f"wrote {SNAPSHOT.relative_to(ROOT)}; now `types` for the types.")


@app.command()
def types(
    check: Annotated[bool, typer.Option("--check", help="Write nothing; fail if the file differs from what the snapshot and queries give")] = False,
    node: Annotated[str, typer.Option(help="The Node that runs graphql-codegen")] = "node",
) -> None:
    """Write hooks/gitlab.generated.ts, the types of every query and fragment in hooks/gitlab-documents.ts, from the snapshot. No network once npm has installed graphql-codegen."""
    try:
        made = generate(SNAPSHOT, shutil.which(node) or node)
    except (SchemaError, OSError) as error:
        typer.echo(f"gitlab-schema: {error}", err=True)
        raise typer.Exit(2) from error
    if not check:
        TYPES.write_text(made)
        typer.echo(f"wrote {TYPES.relative_to(ROOT)}")
        return
    if found := stale(TYPES, made):
        typer.echo(f"✗ {found.query}: {found.problem}")
        raise typer.Exit(1)
    typer.echo(f"{TYPES.relative_to(ROOT)} is what the snapshot and queries give.")


if __name__ == "__main__":
    app()
