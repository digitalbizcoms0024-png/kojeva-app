# Design rules

- Layout modeled on the reference "Ad Rankings" tool: ranked list left, detail panel right; stacks below `lg`.
- Warm neutral surfaces, one accent (`--accent`, mauve), tabular monospace for numbers.
- All colors are tokens in `src/index.css`, with light and dark values (dark follows the OS, or `data-theme`).

## Pod colors
Harris blue · Dhia orange · Shameer aqua · Ali yellow (the first four slots of a categorical palette
validated for color-blind separation). Four hues can't all be told apart pairwise in every case, so
**a pod color is always shown with the pod name**; never use color alone to identify a pod.

## Status
Good / warn / bad colors are reserved for target bands and always carry an icon (✓ ! ✕).
They are never reused as pod or series colors.

## Charts
- One y-axis per chart. Spend and CPA are two aligned charts, never a dual-axis chart.
- Thin marks: 2px lines, bars with 4px rounded tops and 2px gaps, recessive gridlines.
- Every chart has a hover tooltip; the CPA chart shows the target as a dashed line.
- Days with no purchases break the CPA line instead of drawing through zero.
