# frontend/src/components/panels/ — slide-in preview panels

Panels are overlays that appear from the right edge of the screen when
the user clicks a group or user in the DAG canvas or search results.
They embed the full-detail components (`GroupPage`, `UserPage`) rather
than duplicating rendering logic.

## Panel components

| Panel | Trigger | Embeds |
|---|---|---|
| `GroupPreviewPanel` | Click a DAG node or group row | `GroupPage` (read-only preview) |
| `GroupDetailPanel` | Click "open full page" from preview | `GroupPage` (full edit) |
| `UserPreviewPanel` | Click a member in a group | `UserPage` |

## Notes

- `GroupModalsRenderer` renders the active modal (add member, create
  subgroup, etc.) as a portal. It is mounted once per page that shows
  groups and receives `activeModal` + `close` from `useGroupModals()`.
- Panels use absolute positioning (`fixed inset-y-0 right-0`) and are
  closed by an Escape key handler (`useEscapeKey`) or a close button.
