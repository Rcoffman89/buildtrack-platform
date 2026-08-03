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
                  <td>{bid.vendors?.name}</td>
                  <td>${Number(bid.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td>{bid.submitted_at ?? "—"}</td>
                  <td>{bid.notes}</td>
                  <td>
                    {bid.file_path ? (
                      <button className="link-btn" onClick={() => handleViewFile(bid.file_path)}>
                        View
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{bid.status}</td>
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
