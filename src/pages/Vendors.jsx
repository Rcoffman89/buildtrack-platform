import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";

export const TRADE_OPTIONS = [
  "General Contractor",
  "Electrical",
  "Plumbing",
  "HVAC",
  "Structural/Steel",
  "Concrete",
  "Roofing",
  "Elevator",
  "Fire/Life Safety",
  "Landscaping",
  "Glazing/Curtain Wall",
  "Painting",
  "Flooring",
  "Low Voltage/IT",
  "Other",
];

export default function Vendors() {
  const { organizationId } = useAuth();
  const [vendors, setVendors] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState({});

  const [name, setName] = useState("");
  const [trade, setTrade] = useState(TRADE_OPTIONS[0]);
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data, error } = await supabase.from("vendors").select("*").order("name");
    if (error) setError(error.message);
    else setVendors(data);
  }

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setError("");

    const { error } = await supabase.from("vendors").insert({
      organization_id: organizationId,
      name,
      trade,
      contact_email: contactEmail || null,
      contact_phone: contactPhone || null,
      notes: notes || null,
    });

    setCreating(false);
    if (error) {
      setError(error.message);
      return;
    }
    setName("");
    setTrade(TRADE_OPTIONS[0]);
    setContactEmail("");
    setContactPhone("");
    setNotes("");
    load();
  }

  function startEdit(vendor) {
    setEditing({ ...editing, [vendor.id]: { ...vendor } });
  }

  function cancelEdit(id) {
    const next = { ...editing };
    delete next[id];
    setEditing(next);
  }

  function updateField(id, field, value) {
    setEditing({ ...editing, [id]: { ...editing[id], [field]: value } });
  }

  async function saveEdit(id) {
    const draft = editing[id];
    const { error } = await supabase
      .from("vendors")
      .update({
        name: draft.name,
        trade: draft.trade,
        contact_email: draft.contact_email || null,
        contact_phone: draft.contact_phone || null,
        notes: draft.notes || null,
      })
      .eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    cancelEdit(id);
    load();
  }

  async function handleDelete(vendor) {
    if (!window.confirm(`Delete "${vendor.name}"? Tasks assigned to this vendor will keep their record but lose the vendor link.`)) return;
    const { error } = await supabase.from("vendors").delete().eq("id", vendor.id);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  return (
    <div>
      <h1>Vendors</h1>

      <form onSubmit={handleCreate} className="task-form" style={{ marginBottom: 28 }}>
        <label htmlFor="v-name">Name</label>
        <input id="v-name" required value={name} onChange={(e) => setName(e.target.value)} />

        <label htmlFor="v-trade">Trade</label>
        <select id="v-trade" value={trade} onChange={(e) => setTrade(e.target.value)}>
          {TRADE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <label htmlFor="v-email">Contact email</label>
        <input id="v-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />

        <label htmlFor="v-phone">Contact phone</label>
        <input id="v-phone" type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />

        <label htmlFor="v-notes">Notes</label>
        <textarea id="v-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" disabled={creating}>
          {creating ? "Adding…" : "Add vendor"}
        </button>
      </form>

      {!vendors && !error && <p>Loading…</p>}

      {vendors && vendors.length === 0 && <p className="task-meta">No vendors yet — add one above.</p>}

      {vendors && vendors.length > 0 && (
        <table className="task-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Trade</th>
              <th>Contact email</th>
              <th>Contact phone</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {vendors.map((v) => {
              const draft = editing[v.id];
              if (draft) {
                return (
                  <tr key={v.id}>
                    <td data-label="Name">
                      <input value={draft.name} onChange={(e) => updateField(v.id, "name", e.target.value)} />
                    </td>
                    <td data-label="Trade">
                      <select value={draft.trade} onChange={(e) => updateField(v.id, "trade", e.target.value)}>
                        {TRADE_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Contact email">
                      <input
                        type="email"
                        value={draft.contact_email || ""}
                        onChange={(e) => updateField(v.id, "contact_email", e.target.value)}
                      />
                    </td>
                    <td data-label="Contact phone">
                      <input
                        type="tel"
                        value={draft.contact_phone || ""}
                        onChange={(e) => updateField(v.id, "contact_phone", e.target.value)}
                      />
                    </td>
                    <td data-label="Notes">
                      <input value={draft.notes || ""} onChange={(e) => updateField(v.id, "notes", e.target.value)} />
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button onClick={() => saveEdit(v.id)}>Save</button>
                      <button onClick={() => cancelEdit(v.id)} style={{ marginLeft: 6 }}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={v.id}>
                  <td data-label="Name">{v.name}</td>
                  <td data-label="Trade">{v.trade}</td>
                  <td data-label="Contact email">{v.contact_email}</td>
                  <td data-label="Contact phone">{v.contact_phone}</td>
                  <td data-label="Notes">{v.notes}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button onClick={() => startEdit(v)}>Edit</button>
                    <button onClick={() => handleDelete(v)} style={{ marginLeft: 6 }}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
