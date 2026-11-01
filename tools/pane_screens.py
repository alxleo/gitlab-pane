#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["typer>=0.12", "pydantic>=2", "playwright==1.64.1", "markdown-it-py==4.2.0"]
# ///
"""pane-screens — the README's screenshots of the GitLab pane, drawn by the mod's own code and photographed headless.

\b
  pane-screens render                      write docs/screens/<scene>.png for every scene
  pane-screens render --scene inbox        one scene
  pane-screens render --out /tmp/shots     somewhere else, to compare two runs
  pane-screens render --verify             draw twice, fail unless both are byte-identical
  pane-screens setup                       fetch the Chromium it photographs with (once per Playwright version)

How it works, so nobody has to remember it:

\b
  1. tools/screens/scenes.ts runs under `claude plugin test`, in a scratch copy of the mod, with GitLab and mr-inbox
     answered by made-up data (acme-corp, alice, bob) and the clock held still. For each scene it prints the element
     tree the pane draws on the desktop surface, exactly as the engine validated it.
  2. This script turns that tree into a web page (tools/screens/pane.css) and Chromium photographs it, with the fonts
     in tools/screens/fonts, so a Mac and a CI runner draw the same letters.

Nothing here talks to GitLab, Anthropic or the network, and nothing reads your Claude config. The page is this script's
reading of the element tree, not the desktop app's own paint: when the app's look changes, change pane.css.

Same commit, same machine kind: the same bytes. A Mac and a Linux runner agree on what is drawn, not on every pixel.
"""

from __future__ import annotations

import base64
import html
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Annotated, Any

import typer
from markdown_it import MarkdownIt
from pydantic import BaseModel, ConfigDict, Field

ROOT = Path(__file__).resolve().parent.parent
SCREENS = Path(__file__).resolve().parent / "screens"
SCENES_FILE = SCREENS / "scenes.ts"
EXPECTED_CLAUDE = "2.1.308"
MARKER = "PANE-SCENE "

app = typer.Typer(add_completion=False, no_args_is_help=True, rich_markup_mode=None, help=__doc__)


@app.callback()
def main() -> None:
    """Keeps `render` a named command, beside any added later."""


class PaneScreensError(RuntimeError):
    pass


# ---- the tree the pane drew ------------------------------------------------------------------------------------------


class Node(BaseModel):
    """One element of a drawn tree: its type, props, children (strings or elements) and the engine's own extras."""

    model_config = ConfigDict(extra="ignore")

    type: str
    props: dict[str, Any] = Field(default_factory=dict)
    children: list[Node | str] = Field(default_factory=list)
    hover: dict[str, Any] | None = None


class Scene(BaseModel):
    name: str
    title: str
    #: Hover groups lit, as if the pointer rested on them.
    hover: list[str] = Field(default_factory=list)
    tree: Node


class Options(BaseModel):
    """What the command line asks for, checked before anything runs."""

    out: Path
    scenes: list[str]
    width: int = Field(gt=200, description="The pane's width in CSS pixels")
    scale: int = Field(ge=1, le=4, description="Device pixels per CSS pixel")
    claude: str
    keep: Path | None
    allow_unknown: bool = False


# ---- element tree to HTML --------------------------------------------------------------------------------------------

THEME_KEYS = {
    "text", "inverseText", "inactive", "subtle", "suggestion", "remember", "success", "error", "warning", "merged",
    "claude", "permission",
}  # fmt: skip
STEPS = {"xs": 0.5, "sm": 1, "md": 2, "lg": 3, "xl": 4}
SAFE_COLOUR = re.compile(r"^[#\w\s(),.%/-]+$")
SAFE_LENGTH = re.compile(r"^-?\d+(\.\d+)?(%|px)?$")
SIZES = {"caption", "footnote", "body", "heading", "title"}
WEIGHTS = {"regular": 400, "medium": 500, "semibold": 600, "bold": 700}
MARKDOWN = MarkdownIt("commonmark", {"html": False, "linkify": False}).enable("table")


def colour(value: Any) -> str | None:
    """A theme key becomes the theme's variable; any other string is a raw colour, kept only if it looks like one."""
    if not isinstance(value, str):
        return None
    if value in THEME_KEYS:
        return f"var(--c-{value})"
    return value if SAFE_COLOUR.match(value) else None


def space(value: Any, axis: str) -> str | None:
    """A number of cells across (`x`) or down (`y`), or a step name, in the page's own unit."""
    if isinstance(value, bool) or value is None:
        return None
    cells = STEPS.get(value) if isinstance(value, str) else value
    if cells is None:
        return None
    return f"calc(var(--u{axis}) * {cells})"


def length(value: Any, axis: str) -> str | None:
    """A width or height: cells when a number, as written when a percentage or pixels."""
    if isinstance(value, str) and SAFE_LENGTH.match(value):
        return value if value.endswith(("%", "px")) else f"{value}px"
    return space(value, axis)


class Page:
    """Turns one scene's tree into HTML; remembers what it could not draw, so the run can say so."""

    def __init__(self) -> None:
        self.unknown: set[str] = set()

    # -- boxes --

    def box_style(self, props: dict[str, Any]) -> tuple[str, bool]:
        css: dict[str, str] = {}
        for prop, name in (("flexDirection", "flex-direction"), ("flexWrap", "flex-wrap"), ("alignItems", "align-items"),
                           ("alignSelf", "align-self"), ("justifyContent", "justify-content"), ("overflow", "overflow")):  # fmt: skip
            if isinstance(props.get(prop), str) and re.fullmatch(r"[\w-]+", props[prop]):
                css[name] = props[prop]
        for prop, name in (("flexGrow", "flex-grow"), ("flexShrink", "flex-shrink")):
            if isinstance(props.get(prop), int | float):
                css[name] = str(props[prop])
        gap = space(props.get("gap"), "x")
        row_gap = space(props.get("rowGap", props.get("gap")), "y")
        col_gap = space(props.get("columnGap", props.get("gap")), "x")
        if row_gap or gap:
            css["row-gap"] = row_gap or gap or "0"
        if col_gap or gap:
            css["column-gap"] = col_gap or gap or "0"
        for prop in ("width", "minWidth"):
            if (value := length(props.get(prop), "x")) is not None:
                css[re.sub(r"([A-Z])", r"-\1", prop).lower()] = value
        for prop in ("height", "minHeight"):
            if (value := length(props.get(prop), "y")) is not None:
                css[re.sub(r"([A-Z])", r"-\1", prop).lower()] = value
        for kind in ("margin", "padding"):
            for side, axis, names in (("Top", "y", ("top",)), ("Bottom", "y", ("bottom",)), ("Left", "x", ("left",)),
                                      ("Right", "x", ("right",))):  # fmt: skip
                value = self._side(props, kind, side, axis)
                if value is not None:
                    css[f"{kind}-{names[0]}"] = value
        if (value := colour(props.get("backgroundColor"))) is not None:
            css["background-color"] = value
        self._border(props, css)
        if props.get("position") == "absolute":
            css["position"] = "absolute"
            for side, axis in (("top", "y"), ("bottom", "y"), ("left", "x"), ("right", "x")):
                if isinstance(props.get(side), int | float) and (value := space(props[side], axis)) is not None:
                    css[side] = value
        return "; ".join(f"{k}: {v}" for k, v in css.items()), props.get("display") == "none"

    @staticmethod
    def _side(props: dict[str, Any], kind: str, side: str, axis: str) -> str | None:
        """The most specific of `paddingTop`, `paddingY` and `padding` that is set, as Ink resolves them."""
        pair = "Y" if axis == "y" else "X"
        for name in (f"{kind}{side}", f"{kind}{pair}", kind):
            if props.get(name) is not None:
                return space(props[name], axis)
        return None

    @staticmethod
    def _border(props: dict[str, Any], css: dict[str, str]) -> None:
        style = props.get("borderStyle")
        if not isinstance(style, str):
            return
        tone = colour(props.get("borderColor")) or "var(--c-subtle)"
        if props.get("borderDimColor") is True:
            tone = f"color-mix(in srgb, {tone} 50%, transparent)"
        match style:
            case "bold":
                css.update({"border": f"2px solid {tone}", "border-radius": "10px"})
            case "round":
                css.update({"border": f"1px solid {tone}", "border-radius": "10px"})
            case "double" | "doubleSingle":
                css.update({"border": f"3px double {tone}"})
            case "dashed":
                css.update({"border": f"1px dashed {tone}"})
            case "quote":
                css.update({"border-left": f"3px solid {tone}"})
            case _:
                css.update({"border": f"1px solid {tone}"})

    # -- text --

    def text_classes(self, props: dict[str, Any]) -> tuple[str, str]:
        classes = ["text"]
        css: dict[str, str] = {}
        if (value := colour(props.get("color"))) is not None:
            css["color"] = value
        if (value := colour(props.get("backgroundColor"))) is not None:
            css["background-color"] = value
        if props.get("dimColor") is True:
            classes.append("dim")
        size = props.get("size")
        if size in SIZES:
            classes.append(size)
        weight = props.get("weight") or ("semibold" if props.get("bold") is True else None)
        if weight in WEIGHTS:
            css["font-weight"] = str(WEIGHTS[weight])
        for flag, cls in (("mono", "mono"), ("tabular", "tabular")):
            if props.get(flag) is True:
                classes.append(cls)
        if props.get("italic") is True:
            css["font-style"] = "italic"
        decorations = [d for flag, d in (("underline", "underline"), ("strikethrough", "line-through")) if props.get(flag) is True]
        if decorations:
            css["text-decoration"] = " ".join(decorations)
        if props.get("inverse") is True:
            css["color"], css["background-color"] = "var(--surface)", css.get("color", "var(--ink)")
        wrap = props.get("wrap")
        if isinstance(wrap, str) and wrap.startswith("truncate") or wrap in ("end", "middle"):
            classes.append("cut")
            if wrap == "truncate-start":
                classes.append("cut-start")
        return " ".join(classes), "; ".join(f"{k}: {v}" for k, v in css.items())

    # -- elements --

    def draw(self, node: Node | str, hovered: frozenset[str]) -> str:
        if isinstance(node, str):
            return html.escape(node)
        props = dict(node.props)
        hover = node.hover or {}
        if hover.get("scope") in hovered:
            props.update({k: v for k, v in hover.items() if k != "scope"})
        inner = "".join(self.draw(child, hovered) for child in node.children)
        match node.type:
            case "Box":
                style, hidden = self.box_style(props)
                return f'<div class="box"{" data-hidden" if hidden else ""} style="{html.escape(style)}">{inner}</div>'
            case "Text":
                classes, style = self.text_classes(props)
                return f'<span class="{classes}" style="{html.escape(style)}">{inner}</span>'
            case "Link":
                label = inner or html.escape(str(props.get("label") or props.get("href") or ""))
                return f'<a class="link" href="{html.escape(str(props.get("href", "")))}">{label}</a>'
            case "Button":
                variant = props.get("variant")
                classes = " ".join(["btn", "plain" if props.get("plain") else "", variant if variant in ("primary", "secondary") else "",
                                    "dim" if props.get("dimColor") else ""]).split()  # fmt: skip
                label = inner or html.escape(str(props.get("label") or ""))
                return f'<button class="{" ".join(classes)}">{label}</button>'
            case "Svg":
                # An Svg's size is CSS pixels, not cells.
                size = "".join([f"width: {int(props['width'])}px; " if isinstance(props.get("width"), int | float) else "",
                                f"height: {int(props['height'])}px" if isinstance(props.get("height"), int | float) else ""])  # fmt: skip
                return f'<div class="svg" role="img" aria-label="{html.escape(str(props.get("alt", "")))}" style="{size}">{props.get("source", "")}</div>'
            case "Image":
                source = props.get("source") or props.get("src")
                if isinstance(source, str) and source.startswith("data:image/"):
                    return f'<img class="svg" alt="{html.escape(str(props.get("alt", "")))}" src="{html.escape(source)}">'
                return self.unknown_element(node)
            case "Markdown":
                dim = " dim" if props.get("dimColor") else ""
                return f'<div class="md{dim}">{MARKDOWN.render(str(props.get("text", "")))}</div>'
            case _:
                return self.unknown_element(node)

    def unknown_element(self, node: Node) -> str:
        self.unknown.add(node.type)
        return f'<div class="unknown">&lt;{html.escape(node.type)}&gt; is not drawn by this renderer</div>'


def page_html(scene: Scene, width: int) -> tuple[str, set[str]]:
    page = Page()
    body = page.draw(scene.tree, frozenset(scene.hover))
    document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{html.escape(scene.title)}</title>
<link rel="stylesheet" href="pane.css">
<style>:root {{ --pane-width: {width}px; }}</style></head>
<body><div id="pane"><header><span>{html.escape(scene.title)}</span><span class="close">×</span></header><main>{body}</main></div></body></html>
"""
    return document, page.unknown


# ---- the scenes, from the engine ---------------------------------------------------------------------------------------


def stage_mod(into: Path) -> Path:
    """A scratch copy of the mod with the scenes as its only test, so `claude plugin test` never sees the real ones."""
    mod = into / "mod"
    (mod / ".claude-plugin").mkdir(parents=True)
    shutil.copy(ROOT / ".claude-plugin" / "plugin.json", mod / ".claude-plugin" / "plugin.json")
    shutil.copytree(ROOT / "hooks", mod / "hooks")
    shutil.copytree(ROOT / "types", mod / "types")
    (mod / "tests").mkdir()
    shutil.copy(ROOT / "tests" / "fixtures.ts", mod / "tests" / "fixtures.ts")
    (mod / "tools" / "screens").mkdir(parents=True)
    shutil.copy(SCENES_FILE, mod / "tools" / "screens" / "scenes.test.ts")
    return mod


def clean_env(home: Path) -> dict[str, str]:
    """Only what `claude plugin test` needs: no token, base URL or session of the caller's reaches it."""
    import os

    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(home), "CLAUDE_CONFIG_DIR": str(home / "config"),
           "NO_COLOR": "1", "TZ": "UTC", "LANG": "C.UTF-8"}  # fmt: skip
    return env


def draw_scenes(claude: str, work: Path) -> list[Scene]:
    mod = stage_mod(work)
    home = work / "home"
    (home / "config").mkdir(parents=True)
    ran = subprocess.run([claude, "plugin", "test", str(mod)], capture_output=True, text=True, env=clean_env(home), check=False)
    output = ran.stdout + ran.stderr
    if ran.returncode != 0:
        raise PaneScreensError(f"`claude plugin test` failed ({ran.returncode}):\n{output[-4000:]}")
    scenes = [Scene.model_validate_json(line[len(MARKER) :]) for line in output.splitlines() if line.startswith(MARKER)]
    if not scenes:
        raise PaneScreensError(f"the scenes drew nothing; the engine said:\n{output[-4000:]}")
    return scenes


def claude_version(claude: str) -> str:
    try:
        return subprocess.run([claude, "--version"], capture_output=True, text=True, check=True).stdout.split()[0]
    except (OSError, subprocess.CalledProcessError, IndexError) as error:
        raise PaneScreensError(f"cannot run `{claude} --version`: {error}") from error


# ---- the photograph ----------------------------------------------------------------------------------------------------


def photograph(pages: dict[str, Path], out: Path, scale: int) -> None:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright

    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(args=["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb"])
        except PlaywrightError as error:
            raise PaneScreensError(f"Chromium would not start ({error}); install it with: uv run tools/pane_screens.py setup") from error
        context = browser.new_context(viewport={"width": 700, "height": 900}, device_scale_factor=scale, color_scheme="light", locale="en-GB",
                                      timezone_id="UTC", reduced_motion="reduce")  # fmt: skip
        for name, path in pages.items():
            page = context.new_page()
            page.goto(path.as_uri())
            page.evaluate("document.fonts.ready.then(() => true)")
            borrowed = fonts_borrowed(context, page)
            if borrowed:
                raise PaneScreensError(
                    f"scene {name} drew with fonts of this machine, not the bundled ones: {', '.join(sorted(borrowed))}. "
                    "Add the missing glyph to tools/screens/fonts (see SOURCES.md), or the shot changes from machine to machine."
                )
            page.locator("#pane").screenshot(path=out / f"{name}.png", animations="disabled", omit_background=False)
            page.close()
        browser.close()


def fonts_borrowed(context: Any, page: Any) -> set[str]:
    """Fonts Chromium took from the machine for any text on the page: every glyph should come from tools/screens/fonts."""
    session = context.new_cdp_session(page)
    session.send("DOM.enable")
    session.send("CSS.enable")
    root = session.send("DOM.getDocument", {"depth": 0})["root"]["nodeId"]
    nodes = session.send("DOM.querySelectorAll", {"nodeId": root, "selector": "#pane *"})["nodeIds"]
    borrowed: set[str] = set()
    for node in nodes:
        for font in session.send("CSS.getPlatformFontsForNode", {"nodeId": node})["fonts"]:
            if not font["isCustomFont"] and font["glyphCount"] > 0:
                borrowed.add(font["familyName"])
    session.detach()
    return borrowed


@app.command()
def setup(
    with_deps: Annotated[bool, typer.Option("--with-deps", help="Also install the system libraries Chromium needs (Linux; asks for root)")] = False,
) -> None:
    """Download the Chromium this script's Playwright version photographs with (about 100 MB, kept by Playwright)."""
    command = [sys.executable, "-m", "playwright", "install", *(["--with-deps"] if with_deps else []), "chromium"]
    raise typer.Exit(subprocess.run(command, check=False).returncode)


def produce(options: Options, out: Path) -> list[Scene]:
    """Draws the scenes with the engine, then photographs each into `out`; returns the scenes it wrote."""
    version = claude_version(options.claude)
    if version != EXPECTED_CLAUDE:
        typer.echo(f"warning: Claude Code {version} draws these, CI pins {EXPECTED_CLAUDE}; the shots may differ", err=True)
    with tempfile.TemporaryDirectory(prefix="pane-screens-") as scratch:
        work = Path(scratch)
        scenes = draw_scenes(options.claude, work)
        if options.scenes:
            missing = sorted(set(options.scenes) - {s.name for s in scenes})
            if missing:
                raise PaneScreensError(f"no such scene: {', '.join(missing)}; there are {', '.join(s.name for s in scenes)}")
            scenes = [s for s in scenes if s.name in options.scenes]
        site = work / "site"
        shutil.copytree(SCREENS / "fonts", site / "fonts")
        shutil.copy(SCREENS / "pane.css", site / "pane.css")
        pages: dict[str, Path] = {}
        undrawn: dict[str, set[str]] = {}
        for each in scenes:
            document, unknown_types = page_html(each, options.width)
            if unknown_types:
                undrawn[each.name] = unknown_types
            pages[each.name] = site / f"{each.name}.html"
            pages[each.name].write_text(document, encoding="utf-8")
        photograph(pages, out, options.scale)
        if options.keep:
            options.keep.mkdir(parents=True, exist_ok=True)
            for each in scenes:
                (options.keep / f"{each.name}.json").write_text(json.dumps(json.loads(each.model_dump_json()), indent=1), encoding="utf-8")
                shutil.copy(pages[each.name], options.keep / f"{each.name}.html")
    if undrawn and not options.allow_unknown:
        said = "; ".join(f"{name}: {', '.join(sorted(types))}" for name, types in undrawn.items())
        raise PaneScreensError(f"the pane draws elements this renderer has no look for, shown as red dashed boxes in the shots ({said}). Teach tools/pane_screens.py, or pass --allow-unknown.")
    return scenes


@app.command()
def render(
    out: Annotated[Path, typer.Option(help="Where the PNGs go, one per scene")] = ROOT / "docs" / "screens",
    scene: Annotated[list[str] | None, typer.Option(help="Only this scene; repeat for several")] = None,
    width: Annotated[int, typer.Option(help="The pane's width in CSS pixels")] = 460,
    scale: Annotated[int, typer.Option(help="Device pixels per CSS pixel")] = 2,
    claude: Annotated[str, typer.Option(help="The Claude Code binary that draws the pane")] = "claude",
    keep: Annotated[Path | None, typer.Option(help="Also keep each scene's tree (JSON) and page (HTML) in this folder")] = None,
    verify: Annotated[bool, typer.Option("--verify", help="Draw everything a second time and fail unless every PNG is byte-identical")] = False,
    allow_unknown: Annotated[bool, typer.Option("--allow-unknown", help="Write the shots even when an element has no look here")] = False,
) -> None:
    """Write one PNG of the pane per scene, and remove the PNGs of scenes that no longer exist."""
    options = Options(out=out, scenes=scene or [], width=width, scale=scale, claude=claude, keep=keep, allow_unknown=allow_unknown)
    try:
        scenes = produce(options, options.out)
        if not options.scenes:
            for stale in sorted(set(options.out.glob("*.png")) - {options.out / f"{s.name}.png" for s in scenes}):
                stale.unlink()
        if verify:
            with tempfile.TemporaryDirectory(prefix="pane-screens-again-") as again:
                produce(options.model_copy(update={"keep": None}), Path(again))
                differing = [s.name for s in scenes if (options.out / f"{s.name}.png").read_bytes() != (Path(again) / f"{s.name}.png").read_bytes()]
            if differing:
                raise PaneScreensError(f"two draws of the same commit gave different PNGs: {', '.join(differing)}")
            typer.echo(f"verified: two draws, {len(scenes)} identical PNGs", err=True)
    except PaneScreensError as error:
        typer.echo(f"pane-screens: {error}", err=True)
        raise typer.Exit(1) from error
    for each in scenes:
        typer.echo(str(options.out / f"{each.name}.png"))


if __name__ == "__main__":
    app()
