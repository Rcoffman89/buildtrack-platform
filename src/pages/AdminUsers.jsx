import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { logAudit } from "../lib/audit.js";

export default function AdminUsers() {
  const { user, isAdmin, loading, organizationId } = useAuth();
  const [users, setUsers] = useState(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [roleError, setRoleError] = useState("");

  useEffect(() => {
    if (isAdmin) loadUsers();
  }, [isAdmin]);

  async function loadUsers() {
    const { data } = await supabase.from("profiles").select("id,email,role,created_at").order("created_at");
    setUsers(data ?? []);
  }

  async function handleInvite(e) {
    e.preventDefault();
    setStatus("");
    setSubmitting(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const res = await fetch("/api/invite-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ email, role }),
    });
    const body = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setStatus(`Error: ${body.error}`);
      return;
    }
    setStatus(`Invited ${body.email} as ${body.role}. They'll get an email to set their password.`);
    setEmail("");
    setRole("member");
    loadUsers();
  }

  async function handleRoleChange(targetUser, newRole) {
    setRoleError("");
    const { error } = await supabase.from("profiles").update({ role: newRole }).eq("id", targetUser.id);
    if (error) {
      setRoleError(error.message);
      return;
    }
    await logAudit({
      taskId: null,
      organizationId,
      changeType: "role_change",
      fieldName: "role",
      oldValue: targetUser.role,
      newValue: newRole,
      reason: `Role changed for ${targetUser.email}`,
    });
    loadUsers();
  }

  if (loading) return <p>Loading…</p>;
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div>
      <h1>Manage Users</h1>

      <form onSubmit={handleInvite} className="task-form" style={{ marginBottom: 28 }}>
        <label htmlFor="email">Email to invite</label>
        <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />

        <label htmlFor="role">Role</label>
        <select id="role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>

        {status && <p className={status.startsWith("Error") ? "auth-error" : "task-meta"}>{status}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Sending invite…" : "Send invite"}
        </button>
      </form>

      {roleError && <p className="auth-error">{roleError}</p>}

      {users && (
        <table className="task-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  <select
                    value={u.role}
                    disabled={u.id === user.id}
                    title={u.id === user.id ? "You can't change your own role here" : undefined}
                    onChange={(e) => handleRoleChange(u, e.target.value)}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
