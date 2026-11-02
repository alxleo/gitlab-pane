#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["typer>=0.12", "pydantic>=2"]
# ///
"""pane-rig — drive the GitLab pane through a real, headless Claude Code engine, standing in for the desktop app.

\b
  pane-rig flow                                       draw the pane once GitLab has answered
  pane-rig flow --press tab-mine --press scroll:25 --press open-42 --press read-42 --press back-top

Each run starts a fresh `claude -p` process, so it runs the mod as it is on disk: no
/reload-plugins. The rig answers the engine as the desktop does: it asks for a drawing when
told to redraw or after a press, and measures where pressable elements sit after each drawing
and scroll. Like the desktop, it hands the engine a new measurement only when the window's
offset changes, with a person's scroll or with its own ask after one; every other ask repeats
the measurement it last handed over. Row numbers are its own estimate; which keys are present,
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
    # The desktop measures only elements it can press (`[data-press-key]`), so a keyed Box is never reported.
    if props.get("key") and node.get("press"):
        keyed.append({"plugin": PLUGIN, "key": str(props["key"]), "top": top, "bottom": top + max(rows, 1) - 1})
    return rows


class Desktop:
    """The desktop's half of the protocol, as the app plays it."""

    def __init__(self, engine: Engine, body_rows: int) -> None:
        self.engine = engine
        self.body_rows = body_rows
        self.offset = 0
        self.tree: dict[str, Any] = {}
        self.rows = 0
        self.keyed: list[dict[str, Any]] = []
        # What every ask carries: the window and measurement as of the window's last move.
        self.handed: dict[str, Any] | None = None
        self.draws = 0
        self.scrolls: list[tuple[int, str]] = []

    def draw(self) -> None:
        handed = self.handed or {"offset": 0, "content_rows": 0, "keyed": []}
        request: dict[str, Any] = {
            "subtype": "ui_render", "surface": "desktop", "component": "Pane", "instance_id": PANE_ID,
            "props": {"scroll": {"offset": handed["offset"], "bodyRows": self.body_rows}},
            "content_rows": handed["content_rows"], "keyed": handed["keyed"],
        }  # fmt: skip
        self.tree = self.engine.ask(request).get("tree") or {}
        self.draws += 1
        self.measure()
        if self.handed is None:
            # The first measurement changes the window's width from its placeholder, which hands it over.
            self.hand_over()
        elif self.clamped(self.offset) != self.offset:
            # A shorter tree pulls the window up, and the browser's scroll event reports it as the person's.
            self.scroll_to(self.offset)

    def measure(self) -> None:
        self.keyed = []
        self.rows = place(self.tree, 0, self.keyed)

    def clamped(self, row: int) -> int:
        return max(0, min(row, self.rows - self.body_rows))

    def hand_over(self) -> None:
        """Hands the latest measurement to the engine with a new ask, as the desktop does once its window moved."""
        self.handed = {"offset": self.offset, "content_rows": self.rows, "keyed": self.keyed[:512]}
        self.draw()

    def moved(self) -> None:
        self.measure()
        self.offset = self.clamped(self.offset)
        if self.handed is None or self.handed["offset"] != self.offset:
            self.hand_over()

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
                self.scrolls.append((self.offset, self.landed_on(self.offset)))
                self.moved()

    def find(self, spec: str) -> dict[str, Any]:
        buttons = [element for element in walk(self.tree) if element.get("press")]
        for element in buttons:
            key = str((element.get("props") or {}).get("key", ""))
            if key == spec or key.startswith(f"{spec}-") or text_of(element) == spec:
                return element
        raise RigError(f"no button {spec!r} in the drawing; there are: {', '.join(text_of(b) for b in buttons[:30])}")

    def scroll_to(self, row: int) -> str:
        """Scrolls the window as the person's wheel does, which hands the engine a fresh measurement."""
        before = self.offset
        self.measure()
        self.offset = self.clamped(row)
        request = {
            "subtype": "ui_scroll", "component": "Pane", "instance_id": PANE_ID, "offset": self.offset,
            "by": self.offset - before, "body_rows": self.body_rows, "content_rows": self.rows,
            "keyed": self.keyed[:512], "surface": "desktop",
        }  # fmt: skip
        answer = self.engine.ask(request)
        self.offset = int(answer.get("offset", self.offset))
        self.moved()
        moved = "moved" if answer.get("moved") else answer.get("deny", answer)
        return f"scrolled to row {row}: {moved}, at {self.offset}, on {self.landed_on(self.offset)}"

    def press(self, spec: str) -> str:
        if spec.startswith("scroll:"):
            return self.scroll_to(int(spec.removeprefix("scroll:")))
        element = self.find(spec)
        key = str((element.get("props") or {}).get("key", ""))
        press = element["press"]
        self.engine.ask({"subtype": "ui_press", "plugin": press["plugin"], "handle": press["handle"], "key": key, "surface": "desktop"})
        return f"pressed {key}"

    def landed_on(self, offset: int) -> str:
        """The first pressable element the window shows, in the drawing on screen."""
        shown = [item for item in self.keyed if item["bottom"] >= offset]
        return min(shown, key=lambda item: (item["top"], item["bottom"]))["key"] if shown else "nothing pressable"

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
    lines = [f"  view {view} · title {title(engine)} · {desktop.draws} drawings · offset {desktop.offset} of {desktop.rows} rows"]
    for offset, landed in desktop.scrolls[scrolls_before:]:
        lines.append(f"  scrolled to row {offset}: lands on {landed}")
    lines += [f"  · {text[:110]}" for text in desktop.texts()[:show]]
    lines += [f"  log {line[:220]}" for line in engine.new_log_lines()]
    return lines


@app.command()
def flow(
    press: list[str] = typer.Option([], "--press", "-p", help="Each step in order: a button's key, key prefix or label, or scroll:<row> as the person's wheel."),
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
                step = desktop.press(spec)
                desktop.settle(options.settle_ms)
                typer.echo(step)
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
