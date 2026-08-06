import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || "BuildTrack <onboarding@resend.dev>";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("authorization") || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) return json({ error: "Missing Authorization header" }, 401);

  const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken);
  if (callerError || !callerData?.user) return json({ error: "Invalid session" }, 401);

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("id", callerData.user.id)
    .single();
  if (!callerProfile?.organization_id) {
    return json({ error: "Your account isn't linked to an organization yet" }, 400);
  }

  const body = await req.json().catch(() => null);
  const invitationId = body?.invitationId;
  if (!invitationId) return json({ error: "Missing invitationId" }, 400);

  // Re-derive the RFP/vendor from the invitation itself rather than trusting anything the
  // caller sent — the org check below is what stops one org's member from triggering an email
  // tied to another org's invitation, even if they guessed a valid invitation id.
  const { data: invitation, error: invErr } = await admin
    .from("rfp_invitations")
    .select("id,token,rfps(title,organization_id),vendors(name,contact_email)")
    .eq("id", invitationId)
    .single();
  if (invErr || !invitation) return json({ error: "Invitation not found" }, 404);
  if (invitation.rfps.organization_id !== callerProfile.organization_id) {
    return json({ error: "Invitation not found" }, 404);
  }

  const siteUrl = process.env.URL || "https://buildtrack-montego-platform.netlify.app";
  const link = `${siteUrl}/bid/${invitation.token}`;
  const vendorEmail = invitation.vendors?.contact_email;

  if (!vendorEmail) {
    return json({ success: true, emailSent: false, link, reason: "This vendor has no contact email on file." });
  }
  if (!RESEND_API_KEY) {
    return json({ success: true, emailSent: false, link, reason: "Email isn't configured yet — copy the link and send it manually." });
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: vendorEmail,
        subject: `Invitation to bid: ${invitation.rfps.title}`,
        html: `<p>You've been invited to submit a bid for <strong>${invitation.rfps.title}</strong>.</p><p><a href="${link}">Click here to view the scope and submit your bid</a>.</p><p>This link can only be used once — contact us if you need a new one.</p>`,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return json({ success: true, emailSent: false, link, reason: `Email send failed: ${errText}` });
    }
  } catch (e) {
    return json({ success: true, emailSent: false, link, reason: `Email send failed: ${e.message}` });
  }

  return json({ success: true, emailSent: true, link });
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export const config = {
  path: "/api/send-rfp-invite",
};
