# frontend/src/components/group/ — group-specific components

## Canonical components

| Use case | Component |
|---|---|
| Full group detail view | `GroupPage.tsx` |
| Compact group row in a list | `GroupRow.tsx` |
| Inline group badge / tag | `GroupTag.tsx` |
| DAG node content (inside React Flow) | `GroupNodeContent.tsx` |
| DAG node wrapper (React Flow node type) | `GroupNode.tsx` |
| Google Workspace sync section | `GoogleSyncSection.tsx` |

## Notes

- `GroupNode` / `GroupNodeContent` exist only for the DAG canvas.
  `GroupNode` is the React Flow node wrapper; `GroupNodeContent` renders
  the visible card including sorted member lists.
- `GroupPage` is the heavyweight component — all group operations
  (rename, add/remove members, create subgroups, etc.) live here.
  It is used as the page body in `pages/GroupPage.tsx` and also
  embedded inside `GroupDetailPanel` for the slide-in panel view.
- Member lists are always sorted: leaders/managers/members each
  alphabetically by username; subgroups and peers alphabetically by name.
