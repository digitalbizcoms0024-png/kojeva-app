# Design rules

- Look follows the "Modernist" design from Claude Design (Kojeva Hub.dc.html): Archivo throughout, a light
  grey ground, one red accent (`--accent`), **square corners everywhere**, strong 2px dividers (`--divider`),
  big extra-bold numbers with tabular figures. Button labels sit flush left.
- Sidebar navigation on desktop; on phones it folds into a top bar with a Menu button.
- Every page starts with `PageHeader` (title, one line, date range + last sync on the right) and a 2px rule.
- Rankings: ranked cards left, detail panel right; stacks below `lg`.
- All colors are tokens in `src/index.css`, with light and dark values. Dark follows the OS until someone uses
  the sidebar toggle (stored per browser as `data-theme`).
- Accent text (links) uses `--accent-ink`; the bright accent only fills buttons and the selected range.
- Parts of the design that need data we don't have yet (AI insight, hook types, video
  player, thumbstop) are left out until they're built, not shown as placeholders.

## Pod colors
Harris blue `#2a78d6` · Dhia plum `#854494` · Shameer sky `#25afd2` · Ali rose `#d6809c` · Agency grey
(dark mode: `#3987e5` · `#8632b6` · `#028a9b` · `#a13958`). Blue and purple follow the design; the other two
were picked with the dataviz palette validator so they pass color-blind separation (adjacent pairs, worst
ΔE 9.5 light / ≥ 8 dark) and stay ≥ 15 ΔE from the good/amber/red status colors and the accent. Four hues
can't all be told apart pairwise in every case, so **a pod color is always shown with the pod name** (or its
code); never use color alone to identify a pod. Pods are always listed Harris, Dhia, Shameer, Ali.

## Status
Good / warn / bad colors are reserved for target bands and always carry an icon (✓ ! ✕); values are
colored text with the icon after them. Deltas use ▲/▼.
They are never reused as pod or series colors.

## Charts
- One y-axis per chart. Spend and CPA are two aligned charts, never a dual-axis chart.
- Thin marks: 2px lines, square bars (the design system has no rounded corners) with 2px gaps, recessive gridlines.
- Every chart has a hover tooltip; target lines are dashed in the accent and labelled ("Target $14").
- Pod cards carry a 7-day spend sparkline in the pod's color (one series each, hover shows the day).
- Days with no purchases break the CPA line instead of drawing through zero.
