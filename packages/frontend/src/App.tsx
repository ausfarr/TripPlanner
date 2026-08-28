import { NavLink, Route, Routes } from "react-router-dom";
import PlanPage from "./pages/PlanPage.js";
import PreferencesPage from "./pages/PreferencesPage.js";
import SpotsPage from "./pages/SpotsPage.js";
import OutingsPage from "./pages/OutingsPage.js";

const navItems = [
  { to: "/", label: "Plan", end: true },
  { to: "/preferences", label: "Preferences" },
  { to: "/spots", label: "Spots" },
  { to: "/outings", label: "Outings" },
];

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold">Weekend Planner</h1>
          <nav className="flex gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium ${
                    isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Routes>
          <Route path="/" element={<PlanPage />} />
          <Route path="/preferences" element={<PreferencesPage />} />
          <Route path="/spots" element={<SpotsPage />} />
          <Route path="/outings" element={<OutingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
