import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function RfpDetail() {
  const { projectId, id } = useParams();
  const { organizationId } = useAuth();
  const [rfp, setRfp] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [bids, setBids] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [error, setError] = useState("");

  const [extraFiles, setExtraFiles] = useState([]);
  const [uploadingDocs, setUploadingDocs] = useState(false);

  const [bidVendorId, setBidVendorId] = useState("");
  const [bidAmount, setBidAmount] = useState("");
  const [bidNotes, setBidNotes] = useState("");
  const [bidSubmittedAt, setBidSubmittedAt] = useState("");
  const [bidFile, setBidFile] = useState(null);
  const [submittingBid, setSubmittingBid] = useState(false);

  const [invitations, setInvitations] = useState([]);
  const [inviteVendorId, setInviteVendorId] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteResults, setInviteResults] = useState({});

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    const { data: rfpData, error: rfpError } = await supabase
      .from("rfps")
      .select("*, tasks(id,title)")
      .eq("id", id)
      .single();
    if (rfpError) {
      setError(rfpError.message);
      return;
    }
    setRfp(rfpData);

    const { data: docData } = await supabase.from("rfp_documents").select("*").eq("rfp_id", id).order("uploaded_at");
    setDocuments(docData ?? []);

    const { data: bidData } = await supabase
      .from("rfp_bids")
      .select("*, vendors(name,trade)")
      .eq("rfp_id", id)
      .order("amount", { ascending: true });
    setBids(bidData ?? []);

    const { data: vendorData } = await supabase.from("vendors").select("id,name,trade").order("name");
    setVendors(vendorData ?? []);

    const { data: invitationData } = await supabase
      .from("rfp_invitations")
      .select("id,vendor_id,token,expires_at,used_at,created_at,vendors(name)")
      .eq("rfp_id", id)
      .order("created_at", { ascending: false });
    setInvitations(invitationData ?? []);
  }

  function generateToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function computeExpiresAt(rfpData) {
    if (rfpData.due_date) {
      return new Date(`${rfpData.due_date}T23:59:59`).toISOString();
    }
    const d = new Date();
    d.setDate(d.getDate() + 90);
    return d.toISOString();
  }

  async function handleInviteVendor(e) {
    e.preventDefault();
    if (!inviteVendorId) return;
    setInviting(true);
    setError("");

    // Regenerate semantics: at most one active (unused) link per vendor on this RFP — clear
    // any prior one first so an old link can never coexist with a fresh one.
    await supabase.from("rfp_invitations").delete().eq("rfp_id", id).eq("vendor_id", inviteVendorId).is("used_at", null);

    const token = generateToken();
    const expiresAt = computeExpiresAt(rfp);

    const { data: created, error: insertError } = await supabase
      .from("rfp_invitations")
      .insert({ rfp_id: id, vendor_id: inviteVendorId, token, expires_at: expiresAt })
      .select("id")
      .single();

    if (insertError) {
      setInviting(false);
      setError(insertError.message);
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const res = await fetch("/api/send-rfp-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ invitationId: created.id }),
    });
    const body = await res.json();

    setInviting(false);
    if (!res.ok) {
      setError(body.error || "Failed to send invite");
      load();
      return;
    }
    setInviteResults((prev) => ({ ...prev, [created.id]: body }));
    setInviteVendorId("");
    load();
  }

  async function handleUploadDocs(e) {
    e.preventDefault();
    if (extraFiles.length === 0) return;
    setUploadingDocs(true);
    setError("");

    for (const file of extraFiles) {
      const path = `${organizationId}/${id}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("rfp-files").upload(path, file);
      if (uploadError) {
        setError(`"${file.name}" failed to upload: ${uploadError.message}`);
        continue;
      }
      await supabase.from("rfp_documents").insert({ rfp_id: id, file_path: path, file_name: file.name });
    }

    setUploadingDocs(false);
    setExtraFiles([]);
    load();
  }

  async function handleViewFile(filePath) {
    const { data, error } = await supabase.storage.from("rfp-files").createSignedUrl(filePath, 60);
    if (error) {
      setError(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function handleDeleteDoc(doc) {
    if (!window.confirm(`Delete "${doc.file_name}"?`)) return;
    await supabase.storage.from("rfp-files").remove([doc.file_path]);
    const { error } = await supabase.from("rfp_documents").delete().eq("id", doc.id);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  async function handleAddBid(e) {
    e.preventDefault();
    setSubmittingBid(true);
    setError("");

    let filePath = null;
    if (bidFile) {
      const path = `${organizationId}/${id}/${crypto.randomUUID()}-${bidFile.name}`;
      const { error: uploadError } = await supabase.storage.from("rfp-files").upload(path, bidFile);
      if (uploadError) {
        setSubmittingBid(false);
        setError(uploadError.message);
        return;
      }
      filePath = path;
    }

    const { error: insertError } = await supabase.from("rfp_bids").insert({
      rfp_id: id,
      vendor_id: bidVendorId,
      amount: bidAmount,
      notes: bidNotes || null,
      submitted_at: bidSubmittedAt || null,
      file_path: filePath,
    });

    setSubmittingBid(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setBidVendorId("");
    setBidAmount("");
    setBidNotes("");
    setBidSubmittedAt("");
    setBidFile(null);
    load();
  }

  async function handleDeleteBid(bid) {
    if (!window.confirm("Delete this bid? This can't be undone.")) return;
    if (bid.file_path) {
      await supabase.storage.from("rfp-files").remove([bid.file_path]);
    }
    const { error } = await supabase.from("rfp_bids").delete().eq("id", bid.id);
    if (error) {
      setError(error.message);
      return;
    }
    load();
  }

  async function handleAward(bid) {
    const confirmed = window.confirm(
      `Award this bid from ${bid.vendors?.name}? This marks all other bids as Rejected and the RFP as Awarded.`
    );
    if (!confirmed) return;

    const setTaskVendor =
      rfp.task_id && window.confirm(`Also set "${rfp.tasks?.title}" task's vendor to ${bid.vendors?.name}?`);

    const { error: awardError } = await supabase.from("rfp_bids").update({ status: "Awarded" }).eq("id", bid.id);
    if (awardError) {
      setError(awardError.message);
      return;
    }
    await supabase.from("rfp_bids").update({ status: "Rejected" }).eq("rfp_id", id).neq("id", bid.id);
    await supabase.from("rfps").update({ status: "Awarded" }).eq("id", id);

    if (rfp.task_id && setTaskVendor) {
      await supabase.from("tasks").update({ vendor_id: bid.vendor_id }).eq("id", rfp.task_id);
    }

    load();
  }

  if (error && !rfp) return <p className="auth-error">{error}</p>;
  if (!rfp) return <p>Loading…</p>;

  return (
    <div>
      <Link to={`/projects/${projectId}/rfps`} className="back-link">
        ← Back to RFPs
      </Link>

      <div className="task-detail-header">
        <h1>{rfp.title}</h1>
        <span className="pill pill-none">{rfp.status}</span>
      </div>

      {rfp.tasks?.title && <p className="task-meta">Related task: {rfp.tasks.title}</p>}
      {rfp.trade && <p className="task-meta">Trade: {rfp.trade}</p>}
      {rfp.due_date && <p className="task-meta">Bid due: {rfp.due_date}</p>}
      {rfp.scope_description && <p>{rfp.scope_description}</p>}

      <div className="predecessors">
        <h3>Plans / Scope Documents</h3>
        {documents.length === 0 && <p className="task-meta">No documents uploaded yet.</p>}
        {documents.length > 0 && (
          <ul>
            {documents.map((doc) => (
              <li key={doc.id}>
                <button className="link-btn" onClick={() => handleViewFile(doc.file_path)}>
                  {doc.file_name}
                </button>{" "}
                <button className="link-btn" onClick={() => handleDeleteDoc(doc)} style={{ marginLeft: 8 }}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={handleUploadDocs} style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
          <input type="file" multiple accept="application/pdf,image/*" onChange={(e) => setExtraFiles([...e.target.files])} />
          <button type="submit" disabled={uploadingDocs || extraFiles.length === 0}>
            {uploadingDocs ? "Uploading…" : "Upload"}
          </button>
        </form>
      </div>

      <div className="predecessors">
        <h3>Vendor Invitations</h3>
        <p className="task-meta">
          Each vendor gets a one-time link to view this RFP and submit their own bid directly — the link stops
          working the moment they submit. If a vendor needs to correct a mistake, send them a new invite; it
          replaces their old link.
        </p>

        {invitations.length > 0 && (
          <table className="task-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Status</th>
                <th>Expires</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => {
                const isUsed = !!inv.used_at;
                const isExpired = !isUsed && new Date(inv.expires_at) < new Date();
                const status = isUsed ? "Submitted" : isExpired ? "Expired" : "Pending";
                const result = inviteResults[inv.id];
                const link = result?.link ?? `${window.location.origin}/bid/${inv.token}`;
                return (
                  <tr key={inv.id}>
                    <td data-label="Vendor">{inv.vendors?.name}</td>
                    <td data-label="Status">{status}</td>
                    <td data-label="Expires">{new Date(inv.expires_at).toLocaleDateString()}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {status === "Pending" && (
                        <button className="link-btn" onClick={() => navigator.clipboard.writeText(link)}>
                          Copy link
                        </button>
                      )}
                      {result && (
                        <div className="task-meta" style={{ marginTop: 4 }}>
                          {result.emailSent ? "Emailed to vendor." : result.reason || "Email not sent — copy the link above."}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <form onSubmit={handleInviteVendor} style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
          <select value={inviteVendorId} onChange={(e) => setInviteVendorId(e.target.value)} required>
            <option value="">— Select a vendor to invite —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.trade})
              </option>
            ))}
          </select>
          <button type="submit" disabled={inviting || !inviteVendorId}>
            {inviting ? "Sending…" : "Send invite"}
          </button>
        </form>
      </div>

      <div className="predecessors">
        <h3>Bids</h3>
        {error && <p className="auth-error">{error}</p>}
        {bids.length === 0 && <p className="task-meta">No bids logged yet.</p>}
        {bids.length > 0 && (
          <table className="task-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Amount</th>
                <th>Submitted</th>
                <th>Notes</th>
                <th>File</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bids.map((bid) => (
                <tr key={bid.id}>
                  <td data-label="Vendor">{bid.vendors?.name}</td>
                  <td data-label="Amount">${Number(bid.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td data-label="Submitted">{bid.submitted_at ?? "—"}</td>
                  <td data-label="Notes">{bid.notes}</td>
                  <td data-label="File">
                    {bid.file_path ? (
                      <button className="link-btn" onClick={() => handleViewFile(bid.file_path)}>
                        View
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="Status">{bid.status}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {bid.status === "Pending" && rfp.status !== "Awarded" && (
                      <button onClick={() => handleAward(bid)}>Award</button>
                    )}
                    <button onClick={() => handleDeleteBid(bid)} style={{ marginLeft: 6 }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <form onSubmit={handleAddBid} className="task-form" style={{ marginTop: 16 }}>
          <label htmlFor="bid-vendor">Vendor</label>
          <select id="bid-vendor" required value={bidVendorId} onChange={(e) => setBidVendorId(e.target.value)}>
            <option value="">— Select a vendor —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.trade})
              </option>
            ))}
          </select>

          <label htmlFor="bid-amount">Amount ($)</label>
          <input
            id="bid-amount"
            type="number"
            required
            min="0"
            step="0.01"
            value={bidAmount}
            onChange={(e) => setBidAmount(e.target.value)}
          />

          <label htmlFor="bid-submitted">Date received</label>
          <input id="bid-submitted" type="date" value={bidSubmittedAt} onChange={(e) => setBidSubmittedAt(e.target.value)} />

          <label htmlFor="bid-notes">Notes</label>
          <input id="bid-notes" value={bidNotes} onChange={(e) => setBidNotes(e.target.value)} />

          <label htmlFor="bid-file">Bid / quote file (optional)</label>
          <input id="bid-file" type="file" accept="application/pdf,image/*" onChange={(e) => setBidFile(e.target.files[0] ?? null)} />

          <button type="submit" disabled={submittingBid} style={{ marginTop: 12 }}>
            {submittingBid ? "Adding…" : "Log bid"}
          </button>
        </form>
      </div>
    </div>
  );
}
