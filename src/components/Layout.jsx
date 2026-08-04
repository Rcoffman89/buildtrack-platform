import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import NotificationBell from "./NotificationBell.jsx";

export default function Layout() {
  const { user, isAdmin, signOut } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Collapse the mobile nav drawer automatically whenever the route changes, so picking a
  // link doesn't leave the drawer sitting open over the new page.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <header className="app-nav">
        <div className="app-nav-brand">BuildTrack</div>
        <button className="nav-toggle" onClick={() => setNavOpen((v) => !v)} aria-label="Toggle navigation">
          {navOpen ? "✕" : "☰"}
        </button>
        <nav className={navOpen ? "open" : ""}>
          <NavLink to="/" end>
            Projects
          </NavLink>
          <NavLink to="/briefing">Weekly Briefing</NavLink>
          <NavLink to="/vendors">Vendors</NavLink>
          <NavLink to="/gl-codes">GL Codes</NavLink>
          {isAdmin && <NavLink to="/admin/users">Manage Users</NavLink>}
        </nav>
        <div className="app-nav-user">
          <NotificationBell />
          <span>{user?.email}</span>
          <button onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
