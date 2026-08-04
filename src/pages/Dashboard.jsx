import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import StatusPill from "../components/StatusPill.jsx";
import TaskCreateForm from "../components/TaskCreateForm.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";

const STATUS_FILTERS = ["All", "Not Started", "In Progress", "Complete", "Blocked"];

export default function Dashboard() {
  const { projectId } = useParams();
  const { isAdmin } = useAuth();
  const [tasks, setTasks] = useState(null);
  const [filter, setFilter] = useState("All");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [targetBudget, setTargetBudget] = useState(null);
  const [actualCost, setActualCost] = useState(0);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [categoryTargets, setCategoryTargets] = useState({});
  const [categoryActuals, setCategoryActuals] = useState({});
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryInput, setCategoryInput] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryTarget, setNewCategoryTarget] = useState("");

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

    const { data: projectData } = await supabase.from("projects").select("target_budget").eq("id", projectId).single();
    setTargetBudget(projectData?.target_budget ?? null);

    const { data: invoiceData } = await supabase.from("invoices").select("amount,category").eq("project_id", projectId);
    setActualCost((invoiceData ?? []).reduce((sum, inv) => sum + Number(inv.amount), 0));

    const actuals = {};
    for (const inv of invoiceData ?? []) {
      const cat = inv.category || "Uncategorized";
      actuals[cat] = (actuals[cat] || 0) + Number(inv.amount);
    }
    setCategoryActuals(actuals);

    const { data: categoryBudgetData } = await supabase
      .from("project_category_budgets")
      .select("category,target_amount")
      .eq("project_id", projectId);
    setCategoryTargets(Object.fromEntries((categoryBudgetData ?? []).map((c) => [c.category, c.target_amount])));
  }

  async function handleSaveBudget(e) {
    e.preventDefault();
    const { error } = await supabase.from("projects").update({ target_budget: budgetInput || null }).eq("id", projectId);
    if (error) {
      setError(error.message);
      return;
    }
    setEditingBudget(false);
    load();
  }

  async function handleSaveCategoryTarget(category) {
    const value = (categoryInput || "").trim();

    let result;
    if (!value) {
      result = await supabase
        .from("project_category_budgets")
        .delete()
        .eq("project_id", projectId)
        .eq("category", category);
    } else {
      result = await supabase
        .from("project_category_budgets")
        .upsert({ project_id: projectId, category, target_amount: value }, { onConflict: "project_id,category" });
    }

    if (result.error) {
      setError(result.error.message);
      return;
    }
    setEditingCategory(null);
    load();
  }

  async function handleAddCategoryTarget(e) {
    e.preventDefault();
    const name = newCategoryName.trim();
    const value = newCategoryTarget.trim();
    if (!name || !value) return;

    const { error } = await supabase
      .from("project_category_budgets")
      .upsert({ project_id: projectId, category: name, target_amount: value }, { onConflict: "project_id,category" });

    if (error) {
      setError(error.message);
      return;
    }
    setAddingCategory(false);
    setNewCategoryName("");
    setNewCategoryTarget("");
    load();
  }

  const counts = tasks
    ? tasks.reduce((acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      }, {})
    : {};

  const visible = tasks?.filter((t) => filter === "All" || t.status === filter) ?? [];

  const categoryNames = [...new Set([...Object.keys(categoryTargets), ...Object.keys(categoryActuals)])].sort();

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

      <div className="budget-card">
        {editingBudget ? (
          <form onSubmit={handleSaveBudget} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label htmlFor="budget-edit" className="task-meta" style={{ margin: 0 }}>
              Target budget ($)
            </label>
            <input
              id="budget-edit"
              type="number"
              min="0"
              step="0.01"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              style={{ width: 140 }}
            />
            <button type="submit">Save</button>
            <button type="button" onClick={() => setEditingBudget(false)}>
              Cancel
            </button>
          </form>
        ) : targetBudget ? (
          <>
            <div className="budget-card-row">
              <span>
                ${actualCost.toLocaleString(undefined, { minimumFractionDigits: 2 })} spent of $
                {Number(targetBudget).toLocaleString(undefined, { minimumFractionDigits: 2 })} budget
              </span>
              {isAdmin && (
                <button
                  className="link-btn"
                  onClick={() => {
                    setBudgetInput(targetBudget);
                    setEditingBudget(true);
                  }}
                >
                  Edit
                </button>
              )}
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: `${Math.min((actualCost / Number(targetBudget)) * 100, 100)}%`,
                  background: actualCost > Number(targetBudget) ? "var(--blocked-fg)" : undefined,
                }}
              />
            </div>
          </>
        ) : (
          <p className="task-meta">
            ${actualCost.toLocaleString(undefined, { minimumFractionDigits: 2 })} spent so far. No target budget set.{" "}
            {isAdmin && (
              <button
                className="link-btn"
                onClick={() => {
                  setBudgetInput("");
                  setEditingBudget(true);
                }}
              >
                Set budget
              </button>
            )}
          </p>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 8px" }}>Budget by Category</h3>

        {categoryNames.length === 0 && <p className="task-meta">No categories tracked yet.</p>}

        {categoryNames.length > 0 && (
          <table className="task-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Target</th>
                <th>Actual</th>
                <th style={{ minWidth: 140 }}></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {categoryNames.map((cat) => {
                const target = categoryTargets[cat];
                const actual = categoryActuals[cat] || 0;
                const pct = target ? Math.min((actual / Number(target)) * 100, 100) : 0;
                const over = target && actual > Number(target);
                return (
                  <tr key={cat}>
                    <td data-label="Category">{cat}</td>
                    <td data-label="Target">
                      {editingCategory === cat ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={categoryInput}
                          onChange={(e) => setCategoryInput(e.target.value)}
                          style={{ width: 100 }}
                          autoFocus
                        />
                      ) : target ? (
                        `$${Number(target).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label="Actual">${actual.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td data-label="Progress">
                      {target && (
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{ width: `${pct}%`, background: over ? "var(--blocked-fg)" : undefined }}
                          />
                        </div>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {isAdmin &&
                        (editingCategory === cat ? (
                          <>
                            <button onClick={() => handleSaveCategoryTarget(cat)}>Save</button>
                            <button onClick={() => setEditingCategory(null)} style={{ marginLeft: 6 }}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="link-btn"
                            onClick={() => {
                              setCategoryInput(target ?? "");
                              setEditingCategory(cat);
                            }}
                          >
                            {target ? "Edit" : "Set target"}
                          </button>
                        ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {isAdmin &&
          (addingCategory ? (
            <form
              onSubmit={handleAddCategoryTarget}
              style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}
            >
              <input
                placeholder="Category name"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                style={{ width: 160 }}
                autoFocus
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Target ($)"
                value={newCategoryTarget}
                onChange={(e) => setNewCategoryTarget(e.target.value)}
                style={{ width: 120 }}
              />
              <button type="submit">Add</button>
              <button type="button" onClick={() => setAddingCategory(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button className="link-btn" style={{ marginTop: 8 }} onClick={() => setAddingCategory(true)}>
              + Add category budget
            </button>
          ))}
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
                <td data-label="Task">
                  <Link to={`/projects/${projectId}/tasks/${t.id}`}>
                    {t.milestone && <span className="milestone-flag">◆ </span>}
                    {t.title}
                  </Link>
                </td>
                <td data-label="Category">{t.category}</td>
                <td data-label="Status">
                  <StatusPill status={t.status} />
                </td>
                <td data-label="% Complete">{t.percent_complete}%</td>
                <td data-label="Assigned to">{t.assigned_to}</td>
                <td data-label="Due">{t.due_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
