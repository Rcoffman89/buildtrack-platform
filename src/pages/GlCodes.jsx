import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";
import { TRADE_OPTIONS } from "./Vendors.jsx";

export default function GlCodes() {
  const { organizationId } = useAuth();
  const [mappings, setMappings] = useState(null);
  const [codes, setCodes] = useState({});
  const [saving, setSaving] = useState({});
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data, error } = await supabase.from("gl_mappings").select("id,vendor_trade,gl_code");
    if (error) {
      setError(error.message);
      return;
    }
    setMappings(data);
    setCodes(Object.fromEntries(data.map((m) => [m.vendor_trade, m.gl_code])));
  }

  async function handleSave(trade) {
    setSaving({ ...saving, [trade]: true });
    setError("");

    const code = (codes[trade] || "").trim();
    const existing = mappings.find((m) => m.vendor_trade === trade);

    let result;
    if (!code && existing) {
      result = await supabase.from("gl_mappings").delete().eq("id", existing.id);
    } else if (existing) {
      result = await supabase.from("gl_mappings").update({ gl_code: code }).eq("id", existing.id);
    } else if (code) {
      result = await supabase.from("gl_mappings").insert({ organization_id: organizationId, vendor_trade: trade, gl_code: code });
    } else {
      result = { error: null };
    }

    setSaving({ ...saving, [trade]: false });
    if (result.error) {
      setError(result.error.message);
      return;
    }
    load();
  }

  if (!mappings && !error) return <p>Loading…</p>;

  return (
    <div>
      <h1>GL Codes</h1>
      <p className="task-meta">
        Maps each vendor trade to an accounting GL code, used by the invoice export on each project's Invoices tab.
        Leave blank for trades you don't need mapped.
      </p>

      {error && <p className="auth-error">{error}</p>}

      <table className="task-table">
        <thead>
          <tr>
            <th>Trade</th>
            <th>GL Code</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {TRADE_OPTIONS.map((trade) => (
            <tr key={trade}>
              <td data-label="Trade">{trade}</td>
              <td data-label="GL Code">
                <input
                  value={codes[trade] ?? ""}
                  onChange={(e) => setCodes({ ...codes, [trade]: e.target.value })}
                  placeholder="e.g. 5010"
                  style={{ maxWidth: 160 }}
                />
              </td>
              <td>
                <button onClick={() => handleSave(trade)} disabled={saving[trade]}>
                  {saving[trade] ? "Saving…" : "Save"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
