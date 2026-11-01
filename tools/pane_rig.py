#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["typer>=0.12", "pydantic>=2"]
# ///
"""pane-rig — drive the GitLab pane through a real, headless Claude Code engine, standing in for the desktop app.

\b
  pane-rig flow                                       draw the pane once GitLab has answered
  pane-rig flow --press open-1394 --press read-1394 --press back-top

Each run starts a fresh `claude -p` process, so it runs the mod as it is on disk: no
/reload-plugins. The rig answers the engine as the desktop does: it asks for a drawing when
told to redraw or after a press, reports where keyed elements sat one drawing late (the
desktop's report rides its next ask and describes the screen before), and carries each scroll
the engine sends into its next ask. Row numbers are its own estimate; which keys are present,
and the order of the asks, are what it gets right. A step prints what was drawn, the scrolls
the engine sent and which element each landed on, the pane's title, and the engine's own log
lines about the mod.

It checks behaviour, not looks: the README's screenshots show how the terminal draws it. It speaks the
engine's internal control protocol of the build it runs against, and stops with the engine's
own error when a shape changes. It never sends a message to the model, and stops at once if a
model turn begins.
"""

from __future__ import annotations

import json
import math
import queue
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

import typer
from pydantic import BaseModel, Field

PANE_ID = "gitlab-ci"
PLUGIN = "gitlab-ci"
WIDTH = 90
"""Characters a row holds, for estimating how many rows text takes."""

app = typer.Typer(add_completion=False, no_args_is_help=True, help=__doc__)


@app.callback()
def main() -> None:
    """Keeps `flow` a named command, beside any added later."""


class Options(BaseModel):
    presses: list[str] = Field(description="Buttons to press in order: a key, a key's prefix before its hash, or a label")
    wait_rows_s: float = Field(gt=0, description="How long to wait for GitLab's first answer")
    settle_ms: int = Field(gt=0, description="Quiet time that ends a step")
    body_rows: int = Field(gt=0, description="Rows the pane's window shows")
    show: int = Field(ge=0, description="Texts of each drawing to print")


class RigError(RuntimeError):
    pass


class Engine:
    """A headless claude process spoken to over its stream-json control protocol."""

    def __init__(self, cwd: Path, debug_file: Path) -> None:
        self.debug_file = debug_file
        self.proc = subprocess.Popen(
            [
                "claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
                "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--debug-file", str(debug_file),
            ],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, cwd=cwd,
        )  # fmt: skip
        self.events: queue.Queue[dict[str, Any]] = queue.Queue()
        self.responses: dict[str, dict[str, Any]] = {}
        self.ids = 0
        self.debug_seen = 0
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        assert self.proc.stdout
        for line in self.proc.stdout:
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if message.get("type") == "control_response":
                response = message.get("response", {})
                self.responses[response.get("request_id", "")] = response
            else:
                self.events.put(message)

    def ask(self, request: dict[str, Any], wait_s: float = 60) -> dict[str, Any]:
        self.ids += 1
        request_id = f"rig-{self.ids}"
        assert self.proc.stdin
        self.proc.stdin.write(json.dumps({"type": "control_request", "request_id": request_id, "request": request}) + "\n")
        self.proc.stdin.flush()
        end = time.monotonic() + wait_s
        while time.monotonic() < end:
            if request_id in self.responses:
                response = self.responses.pop(request_id)
                if response.get("subtype") != "success":
                    raise RigError(f"{request['subtype']}: {response.get('error', response)}")
                return response.get("response") or {}
            if self.proc.poll() is not None:
                raise RigError(f"the engine exited ({self.proc.returncode}) during {request['subtype']}")
            time.sleep(0.02)
        raise RigError(f"{request['subtype']}: no answer in {wait_s:.0f}s")

    def next_event(self, timeout_s: float) -> dict[str, Any] | None:
        try:
            event = self.events.get(timeout=timeout_s)
        except queue.Empty:
            return None
        if event.get("type") in ("assistant", "user", "result"):
            raise RigError(f"a model turn began ({event.get('type')}); the rig never asks for one")
        return event

    def new_log_lines(self) -> list[str]:
        if not self.debug_file.exists():
            return []
        lines = self.debug_file.read_text(errors="replace").splitlines()
        fresh, self.debug_seen = lines[self.debug_seen :], len(lines)
        trouble = ("refused", "fail", "skipped", "denied", "threw", "error", "warn")
        return [
            line
            for line in fresh
            if "ui.scroll " in line or ("gitlab-ci" in line and any(word in line.lower() for word in trouble))
        ]

    def close(self) -> None:
        self.proc.kill()


def text_of(node: dict[str, Any]) -> str:
    props = node.get("props") or {}
    if "label" in props:
        return str(props["label"])
    if "text" in props:
        return str(props["text"])
    return "".join(child for child in node.get("children") or [] if isinstance(child, str))


def walk(node: Any) -> list[dict[str, Any]]:
    if not isinstance(node, dict):
        return []
    return [node, *(element for child in node.get("children") or [] for element in walk(child))]


def place(node: Any, top: int, keyed: list[dict[str, Any]]) -> int:
    """Rows `node` takes when drawn from row `top`, noting where each keyed element sits."""
    if isinstance(node, str):
        return max(1, math.ceil(len(node) / WIDTH))
    if not isinstance(node, dict):
        return 0
    props = node.get("props") or {}
    if props.get("display") == "none" or props.get("position") == "absolute":
        return 0
    kind = node.get("type")
    if kind == "Markdown":
        rows = sum(max(1, math.ceil(len(line) / WIDTH)) for line in str(props.get("text", "")).splitlines()) or 1
    elif kind in ("Text", "Button", "Link", "Svg", "Image"):
        rows = max(1, math.ceil(len(text_of(node)) / WIDTH))
    else:
        children = [child for child in node.get("children") or [] if child is not None and child is not False]
        border = 2 if props.get("borderStyle") else 0
        pad = (props.get("paddingY") or 0) * 2 + (props.get("paddingTop") or 0) + (props.get("paddingBottom") or 0)
        inner = top + border // 2 + (props.get("paddingY") or props.get("paddingTop") or 0) + (props.get("marginTop") or 0)
        if props.get("flexDirection") == "column":
            gap = props.get("rowGap", props.get("gap", 0)) or 0
            used = 0
            for i, child in enumerate(children):
                used += place(child, inner + used, keyed) + (gap if i < len(children) - 1 else 0)
        else:
            used = max((place(child, inner, keyed) for child in children), default=0)
        rows = used + border + pad + (props.get("marginTop") or 0)
    if props.get("key"):
        keyed.append({"plugin": PLUGIN, "key": str(props["key"]), "top": top, "bottom": top + max(rows, 1) - 1})
    return rows


class Desktop:
    """The desktop's half of the protocol, as the app plays it."""

    def __init__(self, engine: Engine, body_rows: int) -> None:
        self.engine = engine
        self.body_rows = body_rows
        self.offset = 0
        self.tree: dict[str, Any] = {}
        self.report: dict[str, Any] = {}
        self.draws = 0
        self.scrolls: list[int] = []

    def draw(self) -> None:
        request: dict[str, Any] = {
            "subtype": "ui_render", "surface": "desktop", "component": "Pane", "instance_id": PANE_ID,
            "props": {"scroll": {"offset": self.offset, "bodyRows": self.body_rows}}, **self.report,
        }  # fmt: skip
        self.tree = self.engine.ask(request).get("tree") or {}
        self.draws += 1
        keyed: list[dict[str, Any]] = []
        rows = place(self.tree, 0, keyed)
        # Reported with the next ask, as the desktop reports the screen it showed before.
        self.report = {"content_rows": rows, "keyed": keyed[:512]}

    def settle(self, quiet_ms: int, most_s: float = 30) -> None:
        """Answers the engine's redraws and scrolls until it is quiet for `quiet_ms`."""
        end = time.monotonic() + most_s
        while time.monotonic() < end:
            event = self.engine.next_event(quiet_ms / 1000)
            if event is None:
                return
            if event.get("type") != "system":
                continue
            if event.get("subtype") == "ui_invalidate" and event.get("event") == "ui.render":
                self.draw()
            elif event.get("subtype") == "ui_scroll" and event.get("instance_id") == PANE_ID:
                self.offset = int(event.get("offset", 0))
                self.scrolls.append(self.offset)

    def find(self, spec: str) -> dict[str, Any]:
        buttons = [element for element in walk(self.tree) if element.get("press")]
        for element in buttons:
            key = str((element.get("props") or {}).get("key", ""))
            if key == spec or key.startswith(f"{spec}-") or text_of(element) == spec:
                return element
        raise RigError(f"no button {spec!r} in the drawing; there are: {', '.join(text_of(b) for b in buttons[:30])}")

    def press(self, spec: str) -> str:
        element = self.find(spec)
        key = str((element.get("props") or {}).get("key", ""))
        press = element["press"]
        self.engine.ask({"subtype": "ui_press", "plugin": press["plugin"], "handle": press["handle"], "key": key, "surface": "desktop"})
        return key

    def landed_on(self, offset: int) -> str:
        at = [item for item in self.report.get("keyed", []) if item["top"] <= offset <= item["bottom"]]
        return min(at, key=lambda item: item["bottom"] - item["top"])["key"] if at else "nothing keyed"

    def texts(self) -> list[str]:
        return [text for text in (text_of(element) for element in walk(self.tree)) if text.strip()]


def title(engine: Engine) -> str:
    try:
        panes = engine.ask({"subtype": "ui_panes"}, wait_s=10).get("panes") or []
    except RigError as error:
        return f"(unread: {error})"
    return next((str(pane.get("title")) for pane in panes if pane.get("id") == PANE_ID), "(not open)")


def describe(desktop: Desktop, engine: Engine, show: int, scrolls_before: int) -> list[str]:
    keys = {str((element.get("props") or {}).get("key", "")) for element in walk(desktop.tree)}
    view = "page" if "back-top" in keys else "inbox" if any(k.startswith("inbox") for k in keys) else "list"
    lines = [f"  view {view} · title {title(engine)} · {desktop.draws} drawings · offset {desktop.offset}"]
    for offset in desktop.scrolls[scrolls_before:]:
        lines.append(f"  scrolled to row {offset}: lands on {desktop.landed_on(offset)}")
    lines += [f"  · {text[:110]}" for text in desktop.texts()[:show]]
    lines += [f"  log {line[:220]}" for line in engine.new_log_lines()]
    return lines


@app.command()
def flow(
    press: list[str] = typer.Option([], "--press", "-p", help="A button to press, in order: key, key prefix or label."),
    wait_rows: float = typer.Option(120, help="Seconds to wait for GitLab's first answer."),
    settle_ms: int = typer.Option(1500, help="Quiet milliseconds that end a step."),
    body_rows: int = typer.Option(40, help="Rows the pane's window shows."),
    show: int = typer.Option(6, help="Texts of each drawing to print."),
    log: Path | None = typer.Option(None, help="Keep the engine's whole debug log here; by default it goes with the run."),
) -> None:
    """Draws the pane once GitLab has answered, then presses each button in turn, saying what followed."""
    options = Options(presses=press, wait_rows_s=wait_rows, settle_ms=settle_ms, body_rows=body_rows, show=show)
    with tempfile.TemporaryDirectory(prefix="pane-rig-") as folder:
        engine = Engine(Path(folder), log or Path(folder) / "debug.log")
        try:
            engine.ask({"subtype": "initialize"})
            desktop = Desktop(engine, options.body_rows)
            desktop.draw()
            end = time.monotonic() + options.wait_rows_s
            while any("reading GitLab" in text for text in desktop.texts()):
                if time.monotonic() > end:
                    raise RigError("GitLab never answered")
                desktop.settle(options.settle_ms, most_s=5)
            desktop.settle(options.settle_ms)
            typer.echo("ready")
            typer.echo("\n".join(describe(desktop, engine, options.show, 0)))
            for spec in options.presses:
                before = len(desktop.scrolls)
                key = desktop.press(spec)
                desktop.settle(options.settle_ms)
                typer.echo(f"pressed {key}")
                typer.echo("\n".join(describe(desktop, engine, options.show, before)))
        except RigError as error:
            typer.echo(f"stopped: {error}", err=True)
            for line in engine.new_log_lines()[-15:]:
                typer.echo(f"  log {line[:220]}", err=True)
            raise typer.Exit(1) from error
        finally:
            engine.close()


if __name__ == "__main__":
    app()
