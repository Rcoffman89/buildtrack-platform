import { createClient } from "@supabase/supabase-js";

// The entire unauthenticated attack surface for the vendor RFP portal is contained to this one
// file. A vendor visiting their link has no Supabase session at all, so none of the normal
// RLS-gated client queries the rest of the app uses are available to them — this function uses
// service_role (bypassing RLS by design) but every query below is scoped by ids derived from
// the validated invitation row, never anything broader. No other code path in the app grants
// the anon role access to rfps/rfp_bids/rfp_documents/rfp-files.
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ALLOWED_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"];

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const contentType = req.headers.get("content-type") || "";
  let action, token, amount, notes, file;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    action = form.get("action");
    token = form.get("token");
    amount = form.get("amount");
    notes = form.get("notes");
    file = form.get("file");
  } else {
    const body = await req.json().catch(() => null);
    action = body?.action;
    token = body?.token;
  }

  if (!token || typeof token !== "string") {
    return json({ error: "Missing token" }, 400);
  }

  // This lookup is the entire authorization boundary. Every subsequent query in this function
  // is scoped by ids that come from this row — never from anything else in the request.
  const { data: invitation, error: invErr } = await admin
    .from("rfp_invitations")
    .select("id,rfp_id,vendor_id,expires_at,used_at")
    .eq("token", token)
    .maybeSingle();

  if (invErr || !invitation) {
    return json({ error: "This link is invalid." }, 404);
  }
  if (invitation.used_at) {
    return json(
      { error: "This link has already been used to submit a bid. Contact the project team for a new link if you need to make changes." },
      410
    );
  }
  if (new Date(invitation.expires_at) < new Date()) {
    return json({ error: "This link has expired." }, 410);
  }

  const { data: rfp, error: rfpErr } = await admin
    .from("rfps")
    .select("id,organization_id,title,scope_description,due_date,status")
    .eq("id", invitation.rfp_id)
    .single();
  if (rfpErr || !rfp) {
    return json({ error: "This RFP could not be found." }, 404);
  }
  if (rfp.status === "Awarded" || rfp.status === "Cancelled") {
    return json({ error: "This RFP is no longer accepting bids." }, 410);
  }

  if (action === "lookup") {
    const { data: vendor } = await admin.from("vendors").select("name").eq("id", invitation.vendor_id).single();
    const { data: documents } = await admin
      .from("rfp_documents")
      .select("id,file_name,file_path")
      .eq("rfp_id", rfp.id);

    const withUrls = await Promise.all(
      (documents ?? []).map(async (doc) => {
        const { data: signed } = await admin.storage.from("rfp-files").createSignedUrl(doc.file_path, 300);
        return { id: doc.id, file_name: doc.file_name, url: signed?.signedUrl ?? null };
      })
    );

    return json({
      rfp: { title: rfp.title, scope_description: rfp.scope_description, due_date: rfp.due_date },
      vendor: { name: vendor?.name ?? "" },
      documents: withUrls,
    });
  }

  if (action === "submit") {
    const numericAmount = Number(amount);
    if (!amount || Number.isNaN(numericAmount) || numericAmount < 0) {
      return json({ error: "A valid bid amount is required." }, 400);
    }

    let filePath = null;
    if (file && typeof file === "object" && file.size > 0) {
      if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        return json({ error: "File must be a PDF or image." }, 400);
      }
      const path = `${rfp.organization_id}/${rfp.id}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await admin.storage.from("rfp-files").upload(path, file);
      if (uploadError) {
        return json({ error: `File upload failed: ${uploadError.message}` }, 400);
      }
      filePath = path;
    }

    const { error: insertError } = await admin.from("rfp_bids").insert({
      rfp_id: rfp.id,
      vendor_id: invitation.vendor_id,
      amount: numericAmount,
      notes: notes || null,
      file_path: filePath,
      submitted_at: new Date().toISOString().slice(0, 10),
      invitation_id: invitation.id,
    });
    if (insertError) {
      return json({ error: insertError.message }, 400);
    }

    // Consume the token the instant a bid is recorded — a one-shot credential, regardless of
    // what happens after, never leaves a usable token sitting behind a submitted bid.
    await admin.from("rfp_invitations").update({ used_at: new Date().toISOString() }).eq("id", invitation.id);

    return json({ success: true });
  }

  return json({ error: "Unknown action" }, 400);
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export const config = {
  path: "/api/vendor-bid",
};
