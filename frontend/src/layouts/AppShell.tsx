import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import SearchBar from '../components/SearchBar';
import { useSuperuser } from '../auth/SuperuserContext';

export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isSuperuser, superuserModeActive, setSuperuserModeActive } = useSuperuser();
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <header className="flex-none h-12 border-b border-gray-200 bg-white flex items-center px-4 gap-4">
        <SearchBar onNavigate={(url) => navigate(url)} />
        {isSuperuser && (
          <button
            role="switch"
            aria-checked={superuserModeActive}
            onClick={() => setSuperuserModeActive(!superuserModeActive)}
            className="ml-auto flex flex-col items-center gap-0.5 focus:outline-none"
          >
            <div
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                superuserModeActive ? 'bg-red-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  superuserModeActive ? 'translate-x-4.5' : 'translate-x-0.5'
                }`}
              />
            </div>
            <span
              className={`text-[10px] font-semibold leading-none tracking-wide uppercase ${
                superuserModeActive ? 'text-red-600' : 'text-gray-400'
              }`}
            >
              superuser
            </span>
          </button>
        )}
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
