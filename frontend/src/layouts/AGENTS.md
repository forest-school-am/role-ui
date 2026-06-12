# frontend/src/layouts/ — application shell layouts

Shell components that define the persistent chrome (nav, header) around
page content. Page components are rendered into the `<Outlet />` slot.

`AppShell` is the only layout. It provides:
- A fixed top bar (`h-12`) containing the global `SearchBar` and the
  superuser mode toggle (visible to superusers only).
- A left navigation sidebar (`w-40`) with `NavLink`s to Personal and
  Groups pages.
- A scrollable `<main>` area that renders the current route's page.
  Note: pages that host a full-viewport canvas (e.g. `StructurePage`)
  should add `overflow-hidden` to their root element to prevent the
  canvas measurement pass from creating a scrollable area.
