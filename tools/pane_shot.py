#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["typer>=0.12", "pydantic>=2", "pyobjc-framework-Quartz", "pyobjc-framework-Vision"]
# ///
"""pane-shot — screenshot a mod's pane in the running Claude desktop app, as the person sees it.

\b
  pane-shot windows                                  the app's windows on screen
  pane-shot capture --pane GitLab -o pane.png        the pane as it is now
  pane-shot capture --pane GitLab --to bottom -o b.png
  pane-shot tour --pane GitLab -o shots/             top to bottom, a page per file
  pane-shot press "read whole" "Mine" -o after.png   click buttons by what they read, then capture

The pane is found by reading its title off the window (macOS text recognition), and found
again before every scroll, so a pane that moved or a session that changed is never scrolled
or cropped by mistake. Every session's pane sits in the same place, so the result names the
session the window showed: each session runs the mod as of its own last reload. Scrolling goes through Hammerspoon, which holds the Accessibility
grant: the pointer is moved over the pane for the scroll, since macOS gives a wheel to what
is under the pointer, and put back before the capture. A scroll that leaves the pane as it
was is reported, not passed off as the page asked for.

Run it when the person says the pane is in front, never on a timer. Only the pane is
written: the whole-window frames it reads, which show other sessions, stay in a temporary
folder that is deleted when it exits.
"""

from __future__ import annotations

import difflib
import json
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Annotated, Literal

import Quartz
import typer
import Vision
from Foundation import NSURL
from pydantic import BaseModel

app = typer.Typer(add_completion=False, help=__doc__, no_args_is_help=True, rich_markup_mode=None)


class Rect(BaseModel):
    """Screen points, origin top-left, as the window server reports them."""

    x: float
    y: float
    w: float
    h: float


class Window(BaseModel):
    id: int
    owner: str
    title: str
    bounds: Rect


class Found(BaseModel):
    window: Window
    pane: Rect
    title_at: Rect
    #: The session the window shows, as its header reads: every session's pane sits in the same place.
    session: str


class Shot(BaseModel):
    path: str
    pane: Rect
    window_id: int
    session: str


class PaneShotError(Exception):
    pass


def windows(owner: str) -> list[Window]:
    infos = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
    out = []
    for w in infos:
        if w.get("kCGWindowOwnerName") != owner or w.get("kCGWindowLayer") != 0:
            continue
        b = w["kCGWindowBounds"]
        out.append(Window(id=w["kCGWindowNumber"], owner=owner, title=w.get("kCGWindowName") or "",
                          bounds=Rect(x=b["X"], y=b["Y"], w=b["Width"], h=b["Height"])))
    return sorted(out, key=lambda win: win.bounds.w * win.bounds.h, reverse=True)


def grab(window: Window, path: Path) -> None:
    subprocess.run(["screencapture", "-x", "-o", "-l", str(window.id), str(path)], check=True)


def load(path: Path):
    source = Quartz.CGImageSourceCreateWithURL(NSURL.fileURLWithPath_(str(path)), None)
    return Quartz.CGImageSourceCreateImageAtIndex(source, 0, None)


def recognise(image) -> list[tuple[str, float, float, float, float]]:
    """Each line of text Vision reads, with its box in image pixels, origin top-left."""
    width, height = Quartz.CGImageGetWidth(image), Quartz.CGImageGetHeight(image)
    request = Vision.VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    request.setUsesLanguageCorrection_(False)
    handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(image, None)
    ok, error = handler.performRequests_error_([request], None)
    if not ok:
        raise PaneShotError(f"text recognition failed: {error}")
    lines = []
    for result in request.results() or []:
        text = result.topCandidates_(1)[0].string()
        box = result.boundingBox()
        x, y = box.origin.x * width, (1 - box.origin.y - box.size.height) * height
        lines.append((text, x, y, box.size.width * width, box.size.height * height))
    return lines


def find_pane(owner: str, title: str, scratch: Path) -> Found:
    """The docked pane whose header reads `title`, in the largest window of the app."""
    wins = windows(owner)
    if not wins:
        raise PaneShotError(f"no {owner!r} window on screen")
    window = wins[0]
    shot = scratch / "find.png"
    grab(window, shot)
    image = load(shot)
    scale = Quartz.CGImageGetWidth(image) / window.bounds.w
    lines = recognise(image)
    # A docked pane's header sits in the window's top band on its right; the same word in a transcript never does. The
    # header may go on past the title ("GitLab • Mine" names the open tab).
    def is_title(text: str) -> bool:
        return text.strip() == title or text.strip().startswith(f"{title} ")

    hits = [line for line in lines if is_title(line[0]) and line[1] / scale > window.bounds.w * 0.35 and line[2] / scale < 80]
    if not hits:
        raise PaneShotError(f"no pane titled {title!r} is showing in the {owner!r} window")
    _, x, y, w, h = min(hits, key=lambda line: line[2])
    left, top = x / scale - 14, y / scale - 12
    pane = Rect(x=window.bounds.x + left, y=window.bounds.y + top, w=window.bounds.w - left - 4, h=window.bounds.h - top - 4)
    title_at = Rect(x=window.bounds.x + x / scale, y=window.bounds.y + y / scale, w=w / scale, h=h / scale)
    # The session's name is the longest line in the window's top band, left of the pane.
    header = [line[0].strip() for line in lines if line[2] / scale < 35 and line[1] / scale < left]
    session = max(header, key=len, default="")
    return Found(window=window, pane=pane, title_at=title_at, session=session)


def crop(window: Window, pane: Rect, out: Path, scratch: Path) -> None:
    """Writes only the pane; the whole-window frame it is cut from stays in `scratch`."""
    full = scratch / "window.png"
    grab(window, full)
    image = load(full)
    scale = Quartz.CGImageGetWidth(image) / window.bounds.w
    rect = Quartz.CGRectMake((pane.x - window.bounds.x) * scale, (pane.y - window.bounds.y) * scale, pane.w * scale, pane.h * scale)
    part = Quartz.CGImageCreateWithImageInRect(image, rect)
    dest = Quartz.CGImageDestinationCreateWithURL(NSURL.fileURLWithPath_(str(out)), "public.png", 1, None)
    Quartz.CGImageDestinationAddImage(dest, part, None)
    if not Quartz.CGImageDestinationFinalize(dest):
        raise PaneShotError(f"could not write {out}")
    full.unlink(missing_ok=True)


def hammerspoon(lua: str) -> str:
    try:
        run = subprocess.run(["hs", "-c", lua], capture_output=True, text=True, timeout=30, check=False)
    except FileNotFoundError as exc:
        raise PaneShotError("Hammerspoon's `hs` command is not installed") from exc
    except subprocess.TimeoutExpired as exc:
        raise PaneShotError("Hammerspoon did not answer; is it running? (open -g -a Hammerspoon)") from exc
    if run.returncode != 0:
        raise PaneShotError(f"Hammerspoon refused: {run.stderr.strip() or run.stdout.strip()}")
    return run.stdout


#: One wheel event's distance: 400 pixels moved a session's transcript when tried by hand; 2,000 never moved the pane.
STEP_PIXELS = 400
#: Far enough to reach either end of any pane drawn so far.
TO_THE_END = 20_000


def scroll(pane: Rect, pixels: int) -> None:
    """Scrolls the pane by `pixels` (negative is down) with the pointer over its middle, then puts the pointer back."""
    x, y = pane.x + pane.w / 2, pane.y + pane.h / 2
    count = max(1, abs(pixels) // STEP_PIXELS)
    step = -STEP_PIXELS if pixels < 0 else STEP_PIXELS
    # Events posted with only a location of their own came back with the pane unmoved; with the pointer over the pane,
    # the wheel goes where a person's would.
    hammerspoon(
        f"local was = hs.mouse.absolutePosition(); hs.mouse.absolutePosition({{x = {x:.0f}, y = {y:.0f}}}); "
        "hs.timer.usleep(50000); "
        f"for i = 1, {count} do local e = hs.eventtap.event.newScrollEvent({{0, {step}}}, {{}}, 'pixel'); "
        f"e:location({{x = {x:.0f}, y = {y:.0f}}}); e:post(); hs.timer.usleep(10000) end; "
        "hs.timer.usleep(150000); hs.mouse.absolutePosition(was)"
    )
    time.sleep(0.6)


def plain(text: str) -> str:
    """Letters and digits only, lower case: what reading text off the screen gets right."""
    return "".join(char for char in text.lower() if char.isalnum())


def click_text(found: Found, text: str, scratch: Path) -> str:
    """Clicks the topmost line in the pane that reads `text`, then puts the pointer back; returns the line clicked."""
    shot = scratch / "press.png"
    grab(found.window, shot)
    image = load(shot)
    scale = Quartz.CGImageGetWidth(image) / found.window.bounds.w
    wanted = plain(text)
    inside = []
    for line, x, y, w, h in recognise(image):
        left, top = found.window.bounds.x + x / scale, found.window.bounds.y + y / scale
        below_header = top > found.title_at.y + found.title_at.h + 4
        if found.pane.x <= left <= found.pane.x + found.pane.w and below_header and wanted and wanted in plain(line):
            inside.append((plain(line) != wanted, top, line, left + w / scale / 2, top + h / scale / 2))
    shot.unlink(missing_ok=True)
    if not inside:
        raise PaneShotError(f"nothing in the pane reads {text!r}")
    _, _, line, x, y = min(inside)
    hammerspoon(
        f"local was = hs.mouse.absolutePosition(); hs.eventtap.leftClick({{x = {x:.0f}, y = {y:.0f}}}); "
        "hs.timer.usleep(150000); hs.mouse.absolutePosition(was)"
    )
    time.sleep(1.5)
    return line


def guarded_scroll(owner: str, title: str, expected: Found, pixels: int, scratch: Path) -> Found:
    """Finds the pane again and scrolls only if it is still where it was."""
    again = find_pane(owner, title, scratch)
    if abs(again.title_at.x - expected.title_at.x) > 4 or abs(again.title_at.y - expected.title_at.y) > 4:
        raise PaneShotError("the pane moved or the window changed; not scrolling")
    # Read twice, a header can differ by a glyph (its ▾ came back as "V", then "v"), so near enough is the same session.
    if difflib.SequenceMatcher(None, again.session.lower(), expected.session.lower()).ratio() < 0.9:
        raise PaneShotError(f"the window now shows another session ({again.session!r}, was {expected.session!r}); not scrolling")
    scroll(again.pane, pixels)
    return again


Owner = Annotated[str, typer.Option(help="The app whose window holds the pane.")]
Title = Annotated[str, typer.Option("--pane", help="The pane's title as its header reads.")]


def fail(exc: Exception) -> typer.Exit:
    typer.echo(f"pane-shot: {exc}", err=True)
    return typer.Exit(1)


@app.command("windows")
def windows_cmd(owner: Owner = "Claude Work") -> None:
    """The app's windows on screen, largest first."""
    for w in windows(owner):
        typer.echo(f"{w.id}  {w.bounds.w:.0f}x{w.bounds.h:.0f} at {w.bounds.x:.0f},{w.bounds.y:.0f}  {w.title}")


@app.command()
def capture(
    out: Annotated[Path, typer.Option("-o", "--out", help="PNG to write.")],
    title: Title = "GitLab",
    to: Annotated[Literal["here", "top", "bottom"], typer.Option(help="Scroll the pane first.")] = "here",
    owner: Owner = "Claude Work",
) -> None:
    """The pane as it is now, or after scrolling it to its top or bottom."""
    with tempfile.TemporaryDirectory() as tmp:
        try:
            found = find_pane(owner, title, Path(tmp))
            before = Path(tmp) / "before.png"
            if to != "here":
                crop(found.window, found.pane, before, Path(tmp))
                found = guarded_scroll(owner, title, found, TO_THE_END if to == "top" else -TO_THE_END, Path(tmp))
            crop(found.window, found.pane, out, Path(tmp))
            if to != "here" and before.read_bytes() == out.read_bytes():
                typer.echo(f"pane-shot: the pane did not move: it was at its {to} already, or the scroll missed it", err=True)
        except PaneShotError as exc:
            raise fail(exc) from exc
    typer.echo(Shot(path=str(out), pane=found.pane, window_id=found.window.id, session=found.session).model_dump_json())


@app.command()
def press(
    text: Annotated[list[str], typer.Argument(help="What each button reads, pressed in order; an exact read wins over a partial one.")],
    out: Annotated[Path | None, typer.Option("-o", "--out", help="PNG of the pane once the last press settles.")] = None,
    title: Title = "GitLab",
    owner: Owner = "Claude Work",
) -> None:
    """Clicks buttons in the pane by what they read, the topmost first, as a person would, then captures it.

    Only text inside the pane, below its header, is ever clicked, and the window must still show the session it showed
    at the first press.
    """
    with tempfile.TemporaryDirectory() as tmp:
        try:
            first = find_pane(owner, title, Path(tmp))
            pressed = []
            for each in text:
                # The title changes with the view ("GitLab · !57"), so the pane is found by its first word.
                found = find_pane(owner, title, Path(tmp))
                if difflib.SequenceMatcher(None, found.session.lower(), first.session.lower()).ratio() < 0.9:
                    raise PaneShotError(f"the window now shows another session ({found.session!r}); not pressing")
                pressed.append(click_text(found, each, Path(tmp)))
            if out:
                crop(found.window, find_pane(owner, title, Path(tmp)).pane, out, Path(tmp))
        except PaneShotError as exc:
            raise fail(exc) from exc
    typer.echo(json.dumps({"session": first.session, "pressed": pressed, **({"path": str(out)} if out else {})}))


@app.command()
def tour(
    out: Annotated[Path, typer.Option("-o", "--out", help="Folder for page-01.png, page-02.png, …")],
    title: Title = "GitLab",
    pages: Annotated[int, typer.Option(help="Stop after this many pages.")] = 12,
    owner: Owner = "Claude Work",
) -> None:
    """Scrolls the pane to its top, then a page at a time to its end, a screenshot per page, then back to its top."""
    out.mkdir(parents=True, exist_ok=True)
    shots: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        try:
            found = guarded_scroll(owner, title, find_pane(owner, title, Path(tmp)), TO_THE_END, Path(tmp))
            previous = b""
            for page in range(1, pages + 1):
                path = out / f"page-{page:02d}.png"
                crop(found.window, found.pane, path, Path(tmp))
                data = path.read_bytes()
                if data == previous:
                    path.unlink()
                    break
                shots.append(str(path))
                previous = data
                found = guarded_scroll(owner, title, found, -int(found.pane.h * 0.8), Path(tmp))
            guarded_scroll(owner, title, found, TO_THE_END, Path(tmp))
        except PaneShotError as exc:
            raise fail(exc) from exc
    if len(shots) == 1:
        typer.echo("pane-shot: one page only: the pane fits on one screen, or the scroll missed it", err=True)
    typer.echo(json.dumps({"session": found.session, "pages": shots}))


if __name__ == "__main__":
    app()
