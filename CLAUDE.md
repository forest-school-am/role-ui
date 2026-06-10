# Frontend component design

Before implementing new UI, discuss what components are needed and how they map to existing ones. Prefer extending or reusing existing components over creating new ones for the same object type. The goal is one canonical component per object (user row, group row, group tag, etc.) used everywhere that object appears in a list or card.

# Frontend/backend boundary

After adding or changing backend handlers, always regenerate the OpenAPI schema and the TypeScript client before touching frontend code. Do not hand-write fetch calls for new endpoints if they can be covered by the generated client.

# Attribute access pattern

All group and user attribute access goes through the typed structs in the `authentik-forest-school-attributes` crate:
- `GroupAttributes::from_raw(Option<RawAttrs>)` / `.into_raw()` — deserialize/serialize group attributes
- `UserAttributes::from_raw(Option<RawAttrs>)` / `.into_raw()` — same for user attributes
- Known namespaces are typed fields (`forest_school` on both, `google_sync` nested inside `ForestSchoolGroup`); unknown keys are preserved in `.other` at each level via `#[serde(flatten)]`

To add a new field or namespace: add it to the relevant struct in `authentik-forest-school-attributes/src/lib.rs` with `#[serde(default, skip_serializing_if = "...")]`.

# Backend API style (Axum / Rust)

Always use `FromRequestParts` extractors for handler arguments — never manually extract values from `Path(params): Path<HashMap<String, String>>`. The project already has:
- `User` — authenticated caller
- `UserFromPath<PP>` — full user looked up from a path param
- `GroupFromPath<PP>` — full group looked up from a path param
- `GroupAccess<R>` — group + caller + role check in one step
- `WriteLock` — serialises concurrent writes

If a new type of extraction is needed (e.g. a raw string from a path segment), add a new extractor to `extractors.rs` rather than parsing inline.
