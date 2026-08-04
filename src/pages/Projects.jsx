import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { computeProjectRisk } from "../lib/scheduling.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import StatusPill from "../components/StatusPill.jsx";

const STATUS_CLASS = {
  "On Track": "pill-done",
  "At Risk": "pill-blocked",
  Complete: "pill-done",
  "On Hold": "pill-none",
};

const TILE_FILTERS = {
  active: (p) => p.status !== "Complete" && p.status !== "On Hold",
  onTrack: (p) => p.status === "On Track",
  atRisk: (p) => p.status === "At Risk",
};

export default function Projects() {
  const { isAdmin, organizationId } = useAuth();
  const [projects, setProjects] = useState(null);
  const [riskCounts, setRiskCounts] = useState({});
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [targetBudget, setTargetBudget] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [tileFilter, setTileFilter] = useState(null); // null | 'active' | 'onTrack' | 'atRisk' | 'openItems'
  const [openItems, setOpenItems] = useState(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,client_name,status,target_date,tasks(id,status)")
      .order("created_at");
    if (error) {
      setError(error.message);
      return;
    }
    setProjects(data);

    // Critical-path float is per-project — run it once per project and collect just the count.
    // Each project's risk calc is isolated so one failing project can't zero out every card.
    const results = await Promise.all(
      data.map(async (p) => {
        try {
          const risk = await computeProjectRisk(p.id);
          return [p.id, risk.filter((r) => r.isAtRisk).length];
        } catch (riskError) {
          console.error(`Failed to compute risk for project ${p.id}:`, riskError);
          return [p.id, 0];
        }
      })
    );
    setRiskCounts(Object.fromEntries(results));
  }

  async function loadOpenItems() {
    if (openItems) return; // already fetched this session
    const { data } = await supabase
      .from("tasks")
      .select("id,title,status,due_date,project_id,projects(name)")
      .neq("status", "Complete")
      .order("due_date", { ascending: true });
    setOpenItems(data ?? []);
  }

  function handleTileClick(key) {
    if (key === "openItems") {
      loadOpenItems();
      setTileFilter((prev) => (prev === "openItems" ? null : "openItems"));
      return;
    }
    setTileFilter((prev) => (prev === key ? null : key));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.from("projects").insert({
      organization_id: organizationId,
      name,
      client_name: clientName || null,
      target_date: targetDate || null,
      target_budget: targetBudget || null,
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setName("");
    setClientName("");
    setTargetDate("");
    setTargetBudget("");
    setShowForm(false);
    load();
  }

  if (error) return <p className="auth-error">{error}</p>;
  if (!projects) return <p>Loading…</p>;

  const activeJobs = projects.filter(TILE_FILTERS.active).length;
  const onTrack = projects.filter(TILE_FILTERS.onTrack).length;
  const atRisk = projects.filter(TILE_FILTERS.atRisk).length;
  const openItemsCount = projects.reduce((sum, p) => sum + p.tasks.filter((t) => t.status !== "Complete").length, 0);

  const visibleProjects =
    tileFilter && tileFilter !== "openItems" ? projects.filter(TILE_FILTERS[tileFilter]) : projects;

  return (
    <div>
      <div className="dash-header">
        <h1>Projects</h1>
        {isAdmin && (
          <button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "+ New Project"}</button>
        )}
      </div>

      <div className="stat-tiles">
        <button
          className={`stat-tile ${tileFilter === "active" ? "active" : ""}`}
          onClick={() => handleTileClick("active")}
        >
          <span className="stat-tile-value">{activeJobs}</span>
          <span className="stat-tile-label">Active Jobs</span>
        </button>
        <button
          className={`stat-tile ${tileFilter === "onTrack" ? "active" : ""}`}
          onClick={() => handleTileClick("onTrack")}
        >
          <span className="stat-tile-value">{onTrack}</span>
          <span className="stat-tile-label">On Track</span>
        </button>
        <button
          className={`stat-tile ${tileFilter === "atRisk" ? "active" : ""}`}
          onClick={() => handleTileClick("atRisk")}
        >
          <span className="stat-tile-value">{atRisk}</span>
          <span className="stat-tile-label">At Risk</span>
        </button>
        <button
          className={`stat-tile ${tileFilter === "openItems" ? "active" : ""}`}
          onClick={() => handleTileClick("openItems")}
        >
          <span className="stat-tile-value">{openItemsCount}</span>
          <span className="stat-tile-label">Open Items</span>
        </button>
      </div>

      {tileFilter && (
        <p className="task-meta">
          Filtered by tile above — <button className="link-btn" onClick={() => setTileFilter(null)}>clear</button>
        </p>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="task-form" style={{ marginBottom: 24 }}>
          <label htmlFor="pname">Project name</label>
          <input id="pname" required value={name} onChange={(e) => setName(e.target.value)} />

          <label htmlFor="pclient">Client</label>
          <input id="pclient" value={clientName} onChange={(e) => setClientName(e.target.value)} />

          <label htmlFor="ptarget">Target completion date</label>
          <input id="ptarget" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />

          <label htmlFor="pbudget">Target budget ($)</label>
          <input
            id="pbudget"
            type="number"
            min="0"
            step="0.01"
            value={targetBudget}
            onChange={(e) => setTargetBudget(e.target.value)}
          />

          <button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create project"}
          </button>
        </form>
      )}

      {tileFilter === "openItems" ? (
        <table className="task-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Project</th>
              <th>Status</th>
              <th>Due</th>
            </tr>
          </thead>
          <tbody>
            {(openItems ?? []).map((t) => (
              <tr key={t.id}>
                <td data-label="Task">
                  <Link to={`/projects/${t.project_id}/tasks/${t.id}`}>{t.title}</Link>
                </td>
                <td data-label="Project">{t.projects?.name}</td>
                <td data-label="Status">
                  <StatusPill status={t.status} />
                </td>
                <td data-label="Due">{t.due_date}</td>
              </tr>
            ))}
            {openItems && openItems.length === 0 && (
              <tr>
                <td colSpan={4}>Nothing open — everything's complete.</td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <div className="project-cards">
          {visibleProjects.map((p) => {
            const total = p.tasks.length;
            const complete = p.tasks.filter((t) => t.status === "Complete").length;
            const pct = total > 0 ? Math.round((complete / total) * 100) : 0;
            const open = total - complete;
            const riskCount = riskCounts[p.id] ?? 0;

            return (
              <Link to={`/projects/${p.id}`} className="project-card" key={p.id}>
                <div className="project-card-head">
                  <h3>{p.name}</h3>
                  <span className={`pill ${STATUS_CLASS[p.status] || "pill-none"}`}>{p.status}</span>
                </div>
                {p.client_name && <p className="task-meta">{p.client_name}</p>}
                <div className="project-card-progress">
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span>{pct}% complete</span>
                </div>
                <div className="project-card-footer">
                  {p.target_date && <span>🎯 {p.target_date}</span>}
                  <span>
                    {open} open item{open === 1 ? "" : "s"}
                  </span>
                </div>
                {riskCount > 0 && (
                  <p className="project-card-risk">
                    ⚠ {riskCount} task{riskCount === 1 ? "" : "s"} at risk (critical path, behind schedule)
                  </p>
                )}
              </Link>
            );
          })}
          {visibleProjects.length === 0 && <p>No projects match this filter.</p>}
        </div>
      )}
    </div>
  );
}
