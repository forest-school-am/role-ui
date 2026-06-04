import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import SearchBar from '../components/SearchBar';

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top search bar */}
      <header className="flex-none h-12 border-b border-gray-200 bg-white flex items-center px-4">
        <SearchBar onNavigate={(url) => navigate(url)} />
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Left nav */}
        <nav className="flex-none w-40 border-r border-gray-200 bg-gray-50 flex flex-col gap-1 p-2 pt-4">
          <NavLink
            to="/me"
            className={({ isActive }) =>
              `rounded px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-gray-600 hover:bg-gray-100'
              }`
            }
          >
            Personal
          </NavLink>
          <NavLink
            to="/structure"
            className={({ isActive }) => {
              const active = isActive || location.pathname.startsWith('/groups/');
              return `rounded px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-indigo-50 text-indigo-700 font-semibold'
                  : 'text-gray-600 hover:bg-gray-100'
              }`;
            }}
          >
            Groups
          </NavLink>
        </nav>

        {/* Content */}
        <main className="flex-1 min-w-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
