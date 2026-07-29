import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";

export default function AuditLog() {
  const { projectId } = useParams();
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, [projectId]);

  async function load() {
    const { data: projectTasks, error: taskError } = await supabase
      .from("tasks")
      .select("id")
      .eq("project_id", projectId);
    if (taskError) {
      setError(taskError.message);
      return;
    }
    const taskIds = projectTasks.map((t) => t.id);
    if (taskIds.length === 0) {
      setEntries([]);
      return;
    }

    const { data, error } = await supabase
      .from("audit_log")
      .select("id,created_at,change_type,field_name,old_value,new_value,reason,task_id,tasks(title),profiles(email)")
      .in("task_id", taskIds)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      setError(error.message);
      return;
    }
    setEntries(data);
  }

  return (
    <div>
      <h1>Audit Log</h1>
      {error && <p className="auth-error">{error}</p>}
      {!entries && !error && <p>Loading…</p>}

      {entries && entries.length === 0 && <p>No changes logged yet.</p>}

      {entries && entries.length > 0 && (
        <table className="task-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Task</th>
              <th>Who</th>
              <th>Field</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td>
                  {e.tasks ? (
                    <Link to={`/projects/${projectId}/tasks/${e.task_id}`}>{e.tasks.title}</Link>
                  ) : (
                    <em>(deleted task)</em>
                  )}
                </td>
                <td>{e.profiles?.email ?? "system"}</td>
                <td>{e.field_name ?? e.change_type}</td>
                <td>
                  {e.old_value ?? "—"} → {e.new_value ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
