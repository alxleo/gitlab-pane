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
  pane-screens publish --branch main       commit docs/screens if it changed and push, even if the branch moved meanwhile

How it works, so nobody has to remember it:

\b
  1. tools/screens/scenes.ts runs under `claude plugin test`, in a scratch copy of the mod, with GitLab and mr-inbox
     answered by made-up data (acme-corp, alice, bob) and the clock held still. For each scene it prints the element
     tree the pane draws on the desktop surface, exactly as the engine validated it.
  2. This script turns that tree into a web page (tools/screens/pane.css) and Chromium photographs it, with the fonts
     in tools/screens/fonts, so a Mac and a CI runner draw the same letters.

`render` talks to no one: not GitLab, not Anthropic, nothing on the network, and it reads none of your Claude config. Only
`publish` reaches a remote, and only the one it is given. The page is this script's reading of the element tree, not the
desktop app's own paint: when the app's look changes, change pane.css.

Same commit, same machine kind: the same bytes. A Mac and a Linux runner agree on what is drawn, not on every pixel.
"""

from __future__ import annotations

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
from pydantic import BaseModel, ConfigDict, Field, ValidationError

ROOT = Path(__file__).resolve().parent.parent
SCREENS = Path(__file__).resolve().parent / "screens"
SCENES_FILE = SCREENS / "scenes.ts"
EXPECTED_CLAUDE = "2.1.318"
MARKER = "PANE-SCENE "
LISTED = "PANE-SCENES "

app = typer.Typer(add_completion=False, no_args_is_help=True, rich_markup_mode=None, help=__doc__)


@app.callback()
def main() -> None:
    """Keeps `render` a named command, beside any added later."""


class PaneScreensError(RuntimeError):
    pass


# ---- the tree the pane drew ------------------------------------------------------------------------------------------


class Node(BaseModel):
    """One element of a drawn tree, as the engine hands it over: a field it adds that is not named here stops the run."""

    model_config = ConfigDict(extra="forbid")

    type: str
    props: dict[str, Any] = Field(default_factory=dict)
    children: list[Node | str] = Field(default_factory=list)
    #: Style overrides while the pointer is over the element's keyed Box, or over its hover group (`scope`).
    hover: dict[str, Any] | None = None
    #: What the engine keeps for a press, a hover group and the plugin that drew a part. Nothing of it is drawn.
    press: dict[str, Any] | None = None
    group: dict[str, Any] | None = None
    part: dict[str, Any] | None = None


class Scene(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    title: str
    #: Hover groups lit, as if the pointer rested on them.
    hover: list[str] = Field(default_factory=list)
    #: Keys of the Boxes the pointer is inside; an element's hover with no group applies while its keyed Box is in this.
    hover_keys: list[str] = Field(default_factory=list, alias="hoverKeys")
    tree: Node


class Options(BaseModel):
    """What the command line asks for, checked before anything runs."""

    out: Path
    scenes: list[str]
    width: int | None = Field(default=None, gt=200, description="The pane's width in CSS pixels; None leaves pane.css's own")
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
WEIGHTS = {"regular", "medium", "semibold", "bold"}
BORDER_STYLES = {"single", "double", "round", "bold", "singleDouble", "doubleSingle", "classic", "arrow", "dashed", "quote"}
MARKDOWN = MarkdownIt("commonmark", {"html": False, "linkify": False}).enable("table")

# What each element may carry. A tree with any other prop stops the run, so a prop the pane starts to use is drawn on
# purpose or ignored on purpose, never dropped by accident. `DRAWN` is what the renderer draws; `KEPT` is accepted and not
# drawn (an address, a hotkey, a sandbox flag: nothing a photograph shows).
DRAWN = {
    "Box": {
        "flexDirection", "flexWrap", "alignItems", "alignSelf", "justifyContent", "overflow", "flexGrow", "flexShrink", "gap",
        "rowGap", "columnGap", "width", "minWidth", "height", "minHeight", "margin", "marginX", "marginY", "marginTop",
        "marginBottom", "marginLeft", "marginRight", "padding", "paddingX", "paddingY", "paddingTop", "paddingBottom",
        "paddingLeft", "paddingRight", "backgroundColor", "borderStyle", "borderColor", "borderDimColor", "position", "top",
        "bottom", "left", "right", "display",
    },
    "Text": {
        "color", "backgroundColor", "dimColor", "size", "weight", "bold", "mono", "tabular", "italic", "underline",
        "strikethrough", "inverse", "wrap",
    },
    "Button": {"label", "variant", "plain", "dimColor"},
    "Link": {"href", "label"},
    "Svg": {"source", "alt", "width", "height"},
    "Image": {"source", "alt", "columns", "rows"},
    "Markdown": {"text", "dimColor"},
}  # fmt: skip
KEPT = {
    "Box": {"key"},
    "Text": {"dir"},
    "Button": {"key", "hotkey", "action", "role", "autoFocus"},
    "Link": set(),
    "Svg": {"isInteractive"},
    "Image": {"key"},
    "Markdown": {"key", "pressableLinks"},
}
HOVER_PROPS = {
    "scope", "color", "backgroundColor", "dimColor", "bold", "italic", "underline", "strikethrough", "inverse", "borderStyle",
    "borderColor", "borderDimColor", "display", "top", "left", "right", "bottom",
}  # fmt: skip


class Lit(BaseModel):
    """What the pointer is on: the hover groups it lights, and the keyed Boxes it is inside."""

    scopes: frozenset[str] = frozenset()
    keys: frozenset[str] = frozenset()


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

    def box_style(self, props: dict[str, Any]) -> tuple[str, str, bool]:
        """A Box's classes, its inline style (layout the tree sets), and whether it is drawn `display: none`."""
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
        classes = ["box", self._border(props, css)]
        if props.get("position") == "absolute":
            css["position"] = "absolute"
            for side, axis in (("top", "y"), ("bottom", "y"), ("left", "x"), ("right", "x")):
                if isinstance(props.get(side), int | float) and (value := space(props[side], axis)) is not None:
                    css[side] = value
        return " ".join(c for c in classes if c), "; ".join(f"{k}: {v}" for k, v in css.items()), props.get("display") == "none"

    @staticmethod
    def _side(props: dict[str, Any], kind: str, side: str, axis: str) -> str | None:
        """The most specific of `paddingTop`, `paddingY` and `padding` that is set, as Ink resolves them."""
        pair = "Y" if axis == "y" else "X"
        for name in (f"{kind}{side}", f"{kind}{pair}", kind):
            if props.get(name) is not None:
                return space(props[name], axis)
        return None

    @staticmethod
    def _border(props: dict[str, Any], css: dict[str, str]) -> str:
        """The class that draws the border (its width, shape and radius are pane.css's); the colour rides along as --bc."""
        style = props.get("borderStyle")
        if not isinstance(style, str):
            return ""
        tone = colour(props.get("borderColor")) or "var(--c-subtle)"
        if props.get("borderDimColor") is True:
            tone = f"color-mix(in srgb, {tone} 50%, transparent)"
        css["--bc"] = tone
        return f"border-{style}" if style in BORDER_STYLES else "border-single"

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
            classes.append(f"w-{weight}")
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

    def check(self, node: Node) -> None:
        """Notes any prop or hover prop this renderer was not taught, under the name `Element.prop`."""
        known = DRAWN.get(node.type, set()) | KEPT.get(node.type, set())
        self.unknown.update(f"{node.type}.{name}" for name in node.props if node.type in DRAWN and name not in known)
        self.unknown.update(f"{node.type}.hover.{name}" for name in (node.hover or {}) if name not in HOVER_PROPS)

    @staticmethod
    def hovered(node: Node, key: str | None, lit: Lit) -> dict[str, Any]:
        """The hover props that apply now: a group's while the pointer is on the group, any other while it is in the keyed Box."""
        hover = node.hover or {}
        scope = hover.get("scope")
        applies = scope in lit.scopes if scope is not None else key is not None and key in lit.keys
        # A hover restyles a border the Box has; it adds none.
        return {k: v for k, v in hover.items() if k != "scope" and (not k.startswith("border") or "borderStyle" in node.props)} if applies else {}

    def draw(self, node: Node | str, lit: Lit, key: str | None = None) -> str:
        """`key` is the nearest keyed Box around this element, itself included."""
        if isinstance(node, str):
            return html.escape(node)
        self.check(node)
        if node.type == "Box" and isinstance(node.props.get("key"), str):
            key = node.props["key"]
        props = {**node.props, **self.hovered(node, key, lit)}
        inner = "".join(self.draw(child, lit, key) for child in node.children)
        match node.type:
            case "Box":
                classes, style, hidden = self.box_style(props)
                return f'<div class="{classes}"{" data-hidden" if hidden else ""} style="{html.escape(style)}">{inner}</div>'
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
                png = props.get("source", {}).get("png") if isinstance(props.get("source"), dict) else None
                if isinstance(png, str) and re.fullmatch(r"[A-Za-z0-9+/=]+", png):
                    size = f"width: {space(props.get('columns'), 'x')}; height: {space(props.get('rows'), 'y')}"
                    return f'<img class="svg" alt="{html.escape(str(props.get("alt", "")))}" style="{size}" src="data:image/png;base64,{png}">'
                return self.unknown_element(node)
            case "Markdown":
                dim = " dim" if props.get("dimColor") else ""
                return f'<div class="md{dim}">{MARKDOWN.render(str(props.get("text", "")))}</div>'
            case _:
                return self.unknown_element(node)

    def unknown_element(self, node: Node) -> str:
        self.unknown.add(node.type)
        return f'<div class="unknown">&lt;{html.escape(node.type)}&gt; is not drawn by this renderer</div>'


def page_html(scene: Scene, width: int | None) -> tuple[str, set[str]]:
    """The scene's page; `width` overrides pane.css's own only when the command line gave one."""
    page = Page()
    body = page.draw(scene.tree, Lit(scopes=frozenset(scene.hover), keys=frozenset(scene.hover_keys)))
    override = f"<style>:root {{ --pane-width: {width}px; }}</style>" if width else ""
    document = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>{html.escape(scene.title)}</title>
<link rel="stylesheet" href="pane.css">
{override}</head>
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


def said_without_trees(output: str) -> str:
    """What `claude plugin test` said, less the trees: they are nearly all of its output and never say why a test failed."""
    lines = [line for line in output.splitlines() if not line.startswith((MARKER, LISTED))]
    failed = [line.removeprefix("(fail) ") for line in lines if line.startswith("(fail)")]
    summary = "failed: " + "; ".join(failed) + "\n" if failed else ""
    return summary + "\n".join(lines)[-4000:]


def draw_scenes(claude: str, work: Path) -> list[Scene]:
    """Runs the scenes under the engine and reads the trees back, or says exactly which scene failed and why."""
    mod = stage_mod(work)
    home = work / "home"
    (home / "config").mkdir(parents=True)
    # One stream, so lines come back in the order they were written.
    ran = subprocess.run([claude, "plugin", "test", str(mod)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=clean_env(home), check=False)
    if ran.returncode != 0:
        raise PaneScreensError(f"`claude plugin test` failed ({ran.returncode}):\n{said_without_trees(ran.stdout)}")
    lines = ran.stdout.splitlines()
    try:
        listed = [json.loads(line[len(LISTED) :]) for line in lines if line.startswith(LISTED)]
        scenes = [Scene.model_validate_json(line[len(MARKER) :]) for line in lines if line.startswith(MARKER)]
    except (ValueError, ValidationError) as error:
        raise PaneScreensError(f"a scene did not read as this script expects (the engine's drawing changed?):\n{error}") from error
    if len(listed) != 1 or not all(isinstance(name, str) for name in listed[0]):
        raise PaneScreensError(f"scenes.ts did not say which scenes to expect, once:\n{said_without_trees(ran.stdout)}")
    lost = [name for name in listed[0] if name not in {scene.name for scene in scenes}]
    stray = sorted({scene.name for scene in scenes} - set(listed[0]))
    if lost or stray or len({scene.name for scene in scenes}) != len(scenes):
        raise PaneScreensError(
            f"the scenes drawn are not the scenes listed (listed {listed[0]}; lost {lost or 'none'}; unlisted {stray or 'none'}); the engine said:\n"
            f"{said_without_trees(ran.stdout)}"
        )
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
    """Draws the scenes with the engine and photographs each; only when every check has passed do the PNGs reach `out`."""
    version = claude_version(options.claude)
    if version != EXPECTED_CLAUDE:
        raise PaneScreensError(
            f"{options.claude} is Claude Code {version}; the pane is drawn by {EXPECTED_CLAUDE}, the version CI pins, and another version "
            f"may draw it differently. Install it (npm install --global @anthropic-ai/claude-code@{EXPECTED_CLAUDE}) or point --claude at it."
        )
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
        shots = work / "shots"
        photograph(pages, shots, options.scale)
        if options.keep:
            options.keep.mkdir(parents=True, exist_ok=True)
            for each in scenes:
                (options.keep / f"{each.name}.json").write_text(json.dumps(json.loads(each.model_dump_json()), indent=1), encoding="utf-8")
                shutil.copy(pages[each.name], options.keep / f"{each.name}.html")
        if undrawn and not options.allow_unknown:
            said = "; ".join(f"{name}: {', '.join(sorted(names))}" for name, names in undrawn.items())
            raise PaneScreensError(
                f"the pane draws what this renderer was not taught ({said}); an unknown element shows as a red dashed box and an unknown prop is "
                "dropped. Teach tools/pane_screens.py (DRAWN and KEPT list the props), or pass --allow-unknown. Nothing was written."
            )
        out.mkdir(parents=True, exist_ok=True)
        for each in scenes:
            shutil.copyfile(shots / f"{each.name}.png", out / f"{each.name}.png")
    return scenes


@app.command()
def render(
    out: Annotated[Path, typer.Option(help="Where the PNGs go, one per scene")] = ROOT / "docs" / "screens",
    scene: Annotated[list[str] | None, typer.Option(help="Only this scene; repeat for several")] = None,
    width: Annotated[int | None, typer.Option(help="The pane's width in CSS pixels (default: pane.css's --pane-width)")] = None,
    scale: Annotated[int, typer.Option(help="Device pixels per CSS pixel")] = 2,
    claude: Annotated[str, typer.Option(help="The Claude Code binary that draws the pane")] = "claude",
    keep: Annotated[Path | None, typer.Option(help="Also keep each scene's tree (JSON) and page (HTML) in this folder")] = None,
    verify: Annotated[bool, typer.Option("--verify", help="Draw everything a second time and fail unless every PNG is byte-identical")] = False,
    allow_unknown: Annotated[bool, typer.Option("--allow-unknown", help="Write the shots even when an element has no look here")] = False,
) -> None:
    """Write one PNG of the pane per scene. It writes only those, and deletes nothing: a PNG that is no scene is named, not removed."""
    options = Options(out=out, scenes=scene or [], width=width, scale=scale, claude=claude, keep=keep, allow_unknown=allow_unknown)
    try:
        scenes = produce(options, options.out)
        others = sorted(path.name for path in options.out.glob("*.png") if path.stem not in {s.name for s in scenes})
        if others and not options.scenes:
            typer.echo(f"note: {', '.join(others)} in {options.out} is no scene (any more); delete it if it is stale", err=True)
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


# ---- keeping the PNGs in the repository --------------------------------------------------------------------------------


class Publishing(BaseModel):
    """Where and as whom `publish` commits, checked before anything runs."""

    branch: str = Field(pattern=r"^[A-Za-z0-9_][A-Za-z0-9_./-]*$", description="The branch, as the remote names it")
    push_url: str = Field(min_length=1, description="Where the branch is fetched from and pushed to; may carry a token")
    path: Path
    author_name: str
    author_email: str
    message: str
    attempts: int = Field(ge=1, le=10)


def redact(text: str, push_url: str) -> str:
    """Git's words for a failure, shortened to one line and with the remote hidden: a token in it must not reach a log."""
    said = [line for line in text.splitlines() if line.strip() and not line.startswith("hint:")]
    return re.sub(r"://[^/@\s]*@", "://***@", " | ".join(said).replace(push_url, "<remote>"))


def git(plan: Publishing, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    import os

    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_AUTHOR_NAME": plan.author_name, "GIT_AUTHOR_EMAIL": plan.author_email,
           "GIT_COMMITTER_NAME": plan.author_name, "GIT_COMMITTER_EMAIL": plan.author_email}  # fmt: skip
    ran = subprocess.run(["git", *args], cwd=ROOT, env=env, capture_output=True, text=True, check=False)
    if check and ran.returncode != 0:
        said = redact((ran.stderr or ran.stdout).strip(), plan.push_url)
        raise PaneScreensError(f"`git {redact(' '.join(args), plan.push_url)}` failed ({ran.returncode}): {said}")
    return ran


@app.command()
def publish(
    branch: Annotated[str, typer.Option(help="The branch to commit to and push, as the remote names it (CI: its own ref name)")],
    push_url: Annotated[str, typer.Option(envvar="PANE_SCREENS_PUSH_URL", help="Where to fetch and push, token included; give it by the environment")],
    path: Annotated[Path, typer.Option(help="The folder of PNGs to commit")] = ROOT / "docs" / "screens",
    author_name: Annotated[str, typer.Option(help="Who the commit is by")] = "github-actions[bot]",
    author_email: Annotated[str, typer.Option(help="Their address")] = "41898282+github-actions[bot]@users.noreply.github.com",
    message: Annotated[str, typer.Option(help="The commit message; [skip ci] keeps it from starting more CI")] = "docs: regenerate the pane screenshots [skip ci]",
    attempts: Annotated[int, typer.Option(help="Tries at pushing when someone else pushed first")] = 3,
) -> None:
    """Commit the PNGs if they changed, and push them even when the branch moved while they were drawn.

    A push that finds the branch ahead is refused, and the PNGs would be lost, so each try first puts the commit on top of
    the branch as it is now. Only a clash on the PNGs themselves, or no remote to reach, ends in failure; the next push to
    the branch draws them afresh.
    """
    try:
        plan = Publishing(branch=branch, push_url=push_url, path=path, author_name=author_name, author_email=author_email,
                          message=message, attempts=attempts)  # fmt: skip
        git(plan, "add", "-A", "--", str(plan.path))
        if git(plan, "diff", "--cached", "--quiet", "--", str(plan.path), check=False).returncode == 0:
            typer.echo("The screenshots are unchanged.")
            return
        git(plan, "commit", "-q", "-m", plan.message, "--", str(plan.path))
        last = ""
        for attempt in range(1, plan.attempts + 1):
            pulled = git(plan, "pull", "--rebase", "--no-edit", plan.push_url, plan.branch, check=False)
            if pulled.returncode != 0:
                last = redact((pulled.stderr or pulled.stdout).strip(), plan.push_url)
                if git(plan, "rev-parse", "--verify", "-q", "REBASE_HEAD", check=False).returncode == 0:
                    git(plan, "rebase", "--abort", check=False)
                    raise PaneScreensError(f"the screenshots clash with what {plan.branch} gained meanwhile; not pushed ({last})")
                typer.echo(f"try {attempt}: could not bring in {plan.branch}: {last}", err=True)
                continue
            pushed = git(plan, "push", plan.push_url, f"HEAD:refs/heads/{plan.branch}", check=False)
            if pushed.returncode == 0:
                typer.echo(f"Pushed the screenshots to {plan.branch} ({git(plan, 'rev-parse', '--short', 'HEAD').stdout.strip()}), try {attempt}.")
                return
            last = redact((pushed.stderr or pushed.stdout).strip(), plan.push_url)
            typer.echo(f"try {attempt}: push refused: {last}", err=True)
        raise PaneScreensError(f"the screenshots were not pushed after {plan.attempts} tries; the last said: {last}")
    except PaneScreensError as error:
        typer.echo(f"pane-screens: {error}", err=True)
        raise typer.Exit(1) from error
    except ValidationError as error:
        # Only which options are wrong: pydantic would print their values, and one of them holds a token.
        typer.echo(f"pane-screens: bad option: {', '.join(str(e['loc'][0]) for e in error.errors())}", err=True)
        raise typer.Exit(2) from error


if __name__ == "__main__":
    app()
