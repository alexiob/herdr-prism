# Terminal design gallery

This is the **design preview**, using synthetic fixtures. It does not replace
the live plugin, collect telemetry, launch a reference editor, or persist the
Notes example. It lets us review layout and navigation before changing the
running interface.

Print every design in a terminal:

```sh
npm run ui:preview
```

Browse interactively:

```sh
npm run ui:preview -- --browse --width 80
```

The gallery includes Overview, Agents, Processes, Messages, Refs, To-do, Git,
Notes, Notes editor, native sidebar content, contextual help and full detail.
Use Tab/Shift+Tab to browse; up/down selects; left/right moves between Overview
columns; Enter opens a destination or full content; `?` explains the selected
entry; Escape returns; `q` closes the preview. Notes editing is a layout example,
not the persistent editor implementation.

Examples for comparing terminal sizes and colors:

```sh
npm run ui:preview -- --width 50 --theme dark
npm run ui:preview -- --width 80 --theme light
npm run ui:preview -- --width 36 --ascii --theme mono
npm run ui:preview -- --view Processes --plain
npm run ui:preview -- --width 50 --save artifacts/ui-design/50
```

The `--save` option creates both plain `.txt` and colored `.ansi` files for
every design. Use `cat` to print a saved design. The frame reserves space for
tabs, context and footer; selected entries scroll into view. Long entries show
their meaningful summary with a right arrow and retain complete detail.

In the current local Herdr session, the preview is in the pane named
**Prism UI Gallery** (`w2:pN`), beside the agent's original pane. These IDs are
session-specific, not installation instructions.

The [design brief](superpowers/specs/2026-10-06-prism-ui-design.md) records the
requested interaction rules and implementation scope. The live sidebar remains
subject to Herdr's rendering and navigation APIs; this gallery does not certify
native focus indices or native pixel rendering.
