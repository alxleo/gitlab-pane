# Fonts for the README screenshots

`tools/pane_screens.ts` photographs the pane with these files and nothing the machine has installed, so a Mac and a CI
runner draw the same letters. Each font keeps its own licence, in the file beside it; the repo's MIT licence does not
cover them.

| File | What it is | Where it came from | Licence |
|---|---|---|---|
| `InterVariable.woff2` | Inter 4.1, text | npm `inter-ui@4.1.0`, `variable/InterVariable.woff2` | `LICENSE-Inter.txt` (OFL 1.1) |
| `JetBrainsMono-Regular.woff2` | JetBrains Mono 400, code | npm `@fontsource/jetbrains-mono@5.2.8`, `files/jetbrains-mono-latin-400-normal.woff2` | `LICENSE-JetBrainsMono.txt` (OFL 1.1) |
| `DejaVuSans-Subset.woff2` | the arrows, triangles and ticks Inter has no glyph for | npm `dejavu-fonts-ttf@2.37.3`, `ttf/DejaVuSans.ttf`, cut down | `LICENSE-DejaVu.txt` (Bitstream Vera / DejaVu) |
| `NotoColorEmoji-Subset.woff2` | the emoji the pane draws | npm `@fontsource/noto-color-emoji@5.2.5`, `files/noto-color-emoji-emoji-400-normal.woff2`, cut down | `LICENSE-NotoColorEmoji.txt` (OFL 1.1) |

The two subsets were made once with fonttools (WOFF2 out, all layout features kept), keeping only:

- DejaVu Sans, U+00B7 U+2013 U+2026 U+2039 U+203A U+2191 U+2192 U+21BA U+21BB U+21C4 U+2212 U+2298 U+25A0 U+25B4 U+25B8
  U+25BE U+25C6 U+25C9 U+25CB U+25CF U+2605 U+2606 U+2610 U+2713 U+2715 U+2717 U+26A0
- Noto Color Emoji, U+1F3AB U+1F464 U+1F4AC U+1F4C1 U+1F500 U+1F6A6 U+1F916 U+26A0 U+270B U+23F8 U+2935 U+FE0F U+200D

With Inter, these cover every non-ASCII character `hooks/` writes. If `npm run screens -- render` stops, naming a font it
took from the machine, the pane has gained a glyph none of these have: re-cut a subset with it and list it here.
