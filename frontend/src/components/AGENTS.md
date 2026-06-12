# frontend/src/components/ — UI components

One canonical component per object type. Before creating a new component for an object that already appears somewhere in the UI, reuse or extend the existing one.

## Canonical components

| Object | Component | Used in |
|---|---|---|
| User row / card | `user/UserPage.tsx` | PersonalPage, UserPreviewPanel |
| Group row / tag | `group/GroupTag.tsx` | UserPage, GroupPage, GroupRow |
| Group page | `group/GroupPage.tsx` | GroupDetailPage |
| Name freeze toggle | `user/NameFreezeToggle.tsx` | UserPage |
| Edit button (pencil icon) | `ui/EditButton.tsx` | UserPage, Section, GroupPage |

## Subdirectory guide

- `ui/` — generic primitives (Section, EditButton, CopyIcon, skeleton loaders, error cards)
- `group/` — group-specific components (GroupPage, GroupTag, GroupRow, etc.)
- `user/` — user-specific components (UserPage, NameFreezeToggle)
- `panels/` — slide-in preview panels (UserPreviewPanel, GroupDetailPanel, etc.)
- `dag/` — React Flow group DAG visualisation; layout backends in `dag/layouts/`
