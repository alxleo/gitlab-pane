#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["typer>=0.12", "pydantic>=2", "graphql-core>=3.2,<3.3"]
# ///
"""gitlab-schema — checks every query the pane sends GitLab against gitlab.com's live schema.

\b
  gitlab-schema check                          fetch the schema, check the queries, say what is wrong
  gitlab-schema check --schema saved.json      check against an introspection answer saved earlier
  gitlab-schema check --save saved.json        keep the fetched schema, to compare later

What it catches, before anyone sees an empty pane:

\b
  * a field, argument or enum value GitLab removed or renamed
  * one GitLab has deprecated, which it removes some releases later (fails too, so there is time to move)
  * one GitLab marks as an experiment, which may change without a deprecation (said, never failed)

The tests cannot catch these: their GitLab answers are made up, in the shape the code expects. The queries come from
hooks/gitlab.ts itself, printed by tools/gitlab_queries.ts under Node, so a changed query is checked as it is sent.
GitLab answers the schema without a sign-in, so this reads no token and sends nothing of yours.
"""

from __future__ import annotations

import json
import shutil
import subprocess
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
ENDPOINT = "https://gitlab.com/api/graphql"
EXPERIMENT = "Status: Experiment"

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
                owner = f"{parent.name}.{next(key for key, value in parent.fields.items() if value is field)}"
                note(f"{owner}({node.name.value}:)", argument.deprecation_reason, argument.description)

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


@app.command()
def check(
    schema_file: Annotated[Path | None, typer.Option("--schema", help="An introspection answer saved earlier, instead of fetching gitlab.com's")] = None,
    save: Annotated[Path | None, typer.Option(help="Also write the fetched introspection answer here")] = None,
    node: Annotated[str, typer.Option(help="The Node that prints the queries")] = "node",
) -> None:
    """Check the pane's queries against GitLab's schema; exit 1 when one is wrong or deprecated, 2 when no check could be made."""
    try:
        queries = read_queries(shutil.which(node) or node)
        introspection = json.loads(schema_file.read_text()) if schema_file else fetch_introspection()
        if save:
            save.write_text(json.dumps(introspection))
        schema = build_client_schema(introspection.get("data", introspection))
    except (SchemaError, OSError, ValueError, TypeError, AttributeError) as error:
        typer.echo(f"gitlab-schema: {error}", err=True)
        raise typer.Exit(2) from error
    findings = check_queries(schema, queries)
    for finding in findings:
        typer.echo(f"{'✗' if finding.fails else '·'} {finding.query}: {finding.problem}")
    failed = [finding for finding in findings if finding.fails]
    typer.echo(f"{len(queries)} queries checked against GitLab's schema: {len(failed) or 'none'} wrong or deprecated.")
    raise typer.Exit(1 if failed else 0)


if __name__ == "__main__":
    app()
