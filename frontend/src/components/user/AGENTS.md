# frontend/src/components/user/ — user-specific components

## Canonical components

| Use case | Component |
|---|---|
| Full user detail view | `UserPage.tsx` |
| Compact user row in a list | `UserRow.tsx` |
| Name-freeze toggle | `NameFreezeToggle.tsx` |

## Notes

- `UserPage` is the canonical full-detail view. It is used as the page
  body in `pages/PersonalPage.tsx` and also embedded inside
  `UserPreviewPanel`. Do not duplicate user-detail rendering elsewhere.
- `NameFreezeToggle` isolates the freeze/unfreeze mutation so `UserPage`
  stays declarative. It takes a `username` prop and handles its own
  mutation + query invalidation.
