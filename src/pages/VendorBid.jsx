import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export default function VendorBid() {
  const { token } = useParams();
  const [state, setState] = useState("loading"); // loading | ready | error | submitted
  const [errorMessage, setErrorMessage] = useState("");
  const [rfp, setRfp] = useState(null);
  const [vendor, setVendor] = useState(null);
  const [documents, setDocuments] = useState([]);

  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    load();
  }, [token]);

  async function load() {
    setState("loading");
    try {
      const res = await fetch("/api/vendor-bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lookup", token }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErrorMessage(body.error || "This link isn't valid.");
        setState("error");
        return;
      }
      setRfp(body.rfp);
      setVendor(body.vendor);
      setDocuments(body.documents ?? []);
      setState("ready");
    } catch {
      setErrorMessage("Something went wrong loading this page. Please try again.");
      setState("error");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    const form = new FormData();
    form.set("action", "submit");
    form.set("token", token);
    form.set("amount", amount);
    form.set("notes", notes);
    if (file) form.set("file", file);

    try {
      const res = await fetch("/api/vendor-bid", { method: "POST", body: form });
      const body = await res.json();
      setSubmitting(false);
      if (!res.ok) {
        setErrorMessage(body.error || "Something went wrong submitting your bid.");
        return;
      }
      setState("submitted");
    } catch {
      setSubmitting(false);
      setErrorMessage("Something went wrong submitting your bid. Please try again.");
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <h1>BuildTrack</h1>
        <p className="auth-subtitle">Vendor bid submission</p>

        {state === "loading" && <p>Loading…</p>}

        {state === "error" && <p className="auth-error">{errorMessage}</p>}

        {state === "submitted" && (
          <p className="task-meta">
            Your bid has been submitted — thank you. The project team will be in touch. This link has now been used
            and won't work again; contact the project team if you need to submit a correction.
          </p>
        )}

        {state === "ready" && rfp && (
          <>
            <h2 style={{ margin: "0 0 4px" }}>{rfp.title}</h2>
            <p className="task-meta">Submitting as: {vendor?.name}</p>
            {rfp.due_date && <p className="task-meta">Bids due: {rfp.due_date}</p>}
            {rfp.scope_description && <p>{rfp.scope_description}</p>}

            {documents.length > 0 && (
              <div style={{ margin: "16px 0" }}>
                <h3>Plans / Scope Documents</h3>
                <ul>
                  {documents.map((doc) => (
                    <li key={doc.id}>
                      {doc.url ? (
                        <a href={doc.url} target="_blank" rel="noopener noreferrer">
                          {doc.file_name}
                        </a>
                      ) : (
                        doc.file_name
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <form onSubmit={handleSubmit} className="task-form">
              <label htmlFor="bid-amount">Your bid amount ($)</label>
              <input
                id="bid-amount"
                type="number"
                required
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />

              <label htmlFor="bid-notes">Notes</label>
              <textarea id="bid-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />

              <label htmlFor="bid-file">Attach your quote (PDF or image, optional)</label>
              <input
                id="bid-file"
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setFile(e.target.files[0] ?? null)}
              />

              {errorMessage && <p className="auth-error">{errorMessage}</p>}

              <button type="submit" disabled={submitting}>
                {submitting ? "Submitting…" : "Submit bid"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
