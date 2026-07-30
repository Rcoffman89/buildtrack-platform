import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext.jsx";
import NotificationBell from "./NotificationBell.jsx";

export default function Layout() {
  const { user, isAdmin, signOut } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-nav">
        <div className="app-nav-brand">BuildTrack</div>
        <nav>
          <NavLink to="/" end>
            Projects
          </NavLink>
          <NavLink to="/briefing">Weekly Briefing</NavLink>
          <NavLink to="/vendors">Vendors</NavLink>
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
