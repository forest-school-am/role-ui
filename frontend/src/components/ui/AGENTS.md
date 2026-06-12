# frontend/src/components/ui/ — generic UI primitives

Domain-agnostic building blocks used across the app. No component here
should import anything from `group/`, `user/`, `panels/`, or `dag/`.

## When to add here

Add a component here when it has no knowledge of the application domain
(groups, users, roles) and could in principle be dropped into any other
project. Anything domain-specific belongs in `group/` or `user/`.

## Key primitives

| Component | Purpose |
|---|---|
| `Section.tsx` | Labelled section with optional "add" button — used on every detail page |
| `EditButton.tsx` | Pencil icon button, appears on hover via `group` Tailwind class |
| `ModalShell.tsx` | Base modal wrapper (backdrop + card + close button) |
| `ModalActions.tsx` | Confirm / Cancel button row for modals |
| `MutationErrorBanner.tsx` | Red inline error strip shown when a mutation fails |
| `PageLoadingSkeleton.tsx` | Full-page skeleton shown while data is loading |
| `PanelLoadingSkeleton.tsx` | Skeleton for panel overlays |
| `PageErrorCard.tsx` | Full-page error card for query failures |
| `EmptyNote.tsx` | "Nothing here" placeholder for empty lists |
| `DashedButton.tsx` | Dashed-border "add" button for empty states |
| `CopyIcon.tsx` | Click-to-copy icon button |
| `OverflowHint.tsx` | "+N more" truncation indicator |
