import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import StatusPill from "../components/StatusPill.jsx";
import TaskCreateForm from "../components/TaskCreateForm.jsx";

const STATUS_FILTERS = ["All", "Not Started", "In Progress", "Complete", "Blocked"];

export default function Dashboard() {
  const { projectId } = useParams();
  const [tasks, setTasks] = useState(null);
  const [filter, setFilter] = useState("All");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    load();
  }, [projectId]);

  async function load() {
    const { data, error } = await supabase
      .from("tasks")
      .select("id,title,category,status,percent_complete,assigned_to,due_date,milestone")
      .eq("project_id", projectId)
      .order("due_date", { ascending: true });
    if (error) setError(error.message);
    else setTasks(data);
  }

  const counts = tasks
    ? tasks.reduce((acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      }, {})
    : {};

  const visible = tasks?.filter((t) => filter === "All" || t.status === filter) ?? [];

  return (
    <div>
      <div className="dash-header">
        <div className="dash-summary">
          {Object.entries(counts).map(([status, count]) => (
            <div className="dash-stat" key={status}>
              <StatusPill status={status} />
              <span className="dash-stat-count">{count}</span>
            </div>
          ))}
        </div>
        <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ New Task"}</button>
      </div>

      {showForm && (
        <TaskCreateForm
          projectId={projectId}
          existingTasks={tasks}
          onCreated={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="dash-filters">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            className={filter === s ? "filter-btn active" : "filter-btn"}
            onClick={() => setFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p className="auth-error">{error}</p>}
      {!tasks && !error && <p>Loading…</p>}

      {tasks && (
        <table className="task-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Category</th>
              <th>Status</th>
              <th>% Complete</th>
              <th>Assigned to</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link to={`/projects/${projectId}/tasks/${t.id}`}>
                    {t.milestone && <span className="milestone-flag">◆ </span>}
                    {t.title}
                  </Link>
                </td>
                <td>{t.category}</td>
                <td>
                  <StatusPill status={t.status} />
                </td>
                <td>{t.percent_complete}%</td>
                <td>{t.assigned_to}</td>
                <td>{t.due_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
