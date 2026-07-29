import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";

const LAST_SEEN_KEY = "buildtrack_notifications_last_seen";

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase
      .from("notifications")
      .select("id,message,created_at,project_id,task_id")
      .order("created_at", { ascending: false })
      .limit(30);
    const list = data ?? [];
    setNotifications(list);

    const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
    const unseen = lastSeen ? list.filter((n) => n.created_at > lastSeen).length : list.length;
    setUnseenCount(unseen);
  }

  function handleToggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString());
      setUnseenCount(0);
    }
  }

  return (
    <div className="notif-wrap">
      <button className="notif-bell" onClick={handleToggle} title="Notifications">
        🔔
        {unseenCount > 0 && <span className="notif-badge">{unseenCount}</span>}
      </button>
      {open && (
        <div className="notif-dropdown">
          {notifications.length === 0 && <p className="notif-empty">No notifications yet.</p>}
          {notifications.map((n) => (
            <Link
              key={n.id}
              to={n.project_id && n.task_id ? `/projects/${n.project_id}/tasks/${n.task_id}` : "/"}
              className="notif-item"
              onClick={() => setOpen(false)}
            >
              <p>{n.message}</p>
              <span className="notif-time">{new Date(n.created_at).toLocaleString()}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
