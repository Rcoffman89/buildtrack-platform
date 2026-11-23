import { Fragment, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import StatusPill from "../components/StatusPill.jsx";
import TaskCreateForm from "../components/TaskCreateForm.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { CATEGORY_OPTIONS } from "../lib/categories.js";

const UNCATEGORIZED = "Uncategorized";

function money(n) {
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_FILTERS = ["All", "Not Started", "In Progress", "Complete", "Blocked"];

export default function Dashboard() {
  const { projectId } = useParams();
  const { isAdmin } = useAuth();
  const [tasks, setTasks] = useState(null);
  const [filter, setFilter] = useState("All");
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [actualCost, setActualCost] = useState(0);
  const [categoryTargets, setCategoryTargets] = useState({});
  const [categoryActuals, setCategoryActuals] = useState({});
  const [categoryInvoices, setCategoryInvoices] = useState({});
  const [openCategory, setOpenCategory] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryInput, setCategoryInput] = useState("");

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

    const { data: invoiceData } = await supabase
      .from("invoices")
      .select("id,amount,category,invoice_date,description,vendors(name)")
      .eq("project_id", projectId)
      .order("invoice_date", { ascending: false });
    setActualCost((invoiceData ?? []).reduce((sum, inv) => sum + Number(inv.amount), 0));

    // Invoices are the project's expenses: each carries its own category, so a category's
    // Actual is the sum of its invoices, and the same rows are listed when it is expanded.
    const actuals = {};
    const byCategory = {};
    for (const inv of invoiceData ?? []) {
      const cat = inv.category || UNCATEGORIZED;
      actuals[cat] = (actuals[cat] || 0) + Number(inv.amount);
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(inv);
    }
    setCategoryActuals(actuals);
    setCategoryInvoices(byCategory);

    const { data: categoryBudgetData } = await supabase
      .from("project_category_budgets")
      .select("category,target_amount")
      .eq("project_id", projectId);
    setCategoryTargets(Object.fromEntries((categoryBudgetData ?? []).map((c) => [c.category, c.target_amount])));
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

  const counts = tasks
    ? tasks.reduce((acc, t) => {
        acc[t.status] = (acc[t.status] || 0) + 1;
        return acc;
      }, {})
    : {};

  const visible = tasks?.filter((t) => filter === "All" || t.status === filter) ?? [];

  // Target budget is no longer a manually-entered number — it's the sum of whatever category
  // targets are set, exactly like actual cost is the sum of invoice amounts. Falls back to
  // null (not 0) when no category targets exist at all, so the empty state reads "no budget
  // set yet" instead of misleadingly showing "$0 target".
  const targetBudget =
    Object.keys(categoryTargets).length > 0
      ? Object.values(categoryTargets).reduce((sum, t) => sum + Number(t), 0)
      : null;

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
        {targetBudget ? (
          <>
            <div className="budget-card-row">
              <span>
                ${actualCost.toLocaleString(undefined, { minimumFractionDigits: 2 })} spent of $
                {Number(targetBudget).toLocaleString(undefined, { minimumFractionDigits: 2 })} budget
              </span>
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
            ${actualCost.toLocaleString(undefined, { minimumFractionDigits: 2 })} spent so far. No target budget set
            — set targets in the category breakdown below.
          </p>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: "0 0 8px" }}>Budget by Category</h3>

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
            {[...CATEGORY_OPTIONS, ...(categoryInvoices[UNCATEGORIZED] ? [UNCATEGORIZED] : [])].map((cat) => {
              const target = categoryTargets[cat];
              const actual = categoryActuals[cat] || 0;
              const pct = target ? Math.min((actual / Number(target)) * 100, 100) : 0;
              const over = target && actual > Number(target);
              const rows = categoryInvoices[cat] ?? [];
              const isOpen = openCategory === cat;
              const isUncategorized = cat === UNCATEGORIZED;
              return (
                <Fragment key={cat}>
                <tr>
                  <td data-label="Category">
                    <button
                      type="button"
                      className="link-btn category-toggle"
                      aria-expanded={isOpen}
                      onClick={() => setOpenCategory(isOpen ? null : cat)}
                    >
                      {isOpen ? "▾" : "▸"} {cat}
                      {rows.length > 0 && <span className="task-meta"> ({rows.length})</span>}
                    </button>
                  </td>
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
                  <td data-label="Actual">{money(actual)}</td>
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
                      !isUncategorized &&
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
                {isOpen && (
                  <tr className="category-detail">
                    <td colSpan={5}>
                      {rows.length === 0 ? (
                        <p className="task-meta" style={{ margin: "0 0 8px" }}>
                          No expenses logged under {cat} yet.
                        </p>
                      ) : (
                        <table className="task-table category-expenses">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Vendor</th>
                              <th>Description</th>
                              <th>Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((inv) => (
                              <tr key={inv.id}>
                                <td data-label="Date">{inv.invoice_date ?? "—"}</td>
                                <td data-label="Vendor">{inv.vendors?.name ?? "—"}</td>
                                <td data-label="Description">{inv.description || "—"}</td>
                                <td data-label="Amount">{money(inv.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <Link
                        to={`/projects/${projectId}/invoices${isUncategorized ? "?category=__none__" : `?category=${encodeURIComponent(cat)}`}`}
                      >
                        {isUncategorized ? "Assign categories on the Invoices tab" : `+ Add expense to ${cat}`}
                      </Link>
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
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
