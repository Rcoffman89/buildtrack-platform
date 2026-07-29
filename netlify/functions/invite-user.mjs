import { createClient } from "@supabase/supabase-js";

// Runs server-side only — this is the one place in the platform allowed to hold the
// service_role key. The browser never sees it; the client calls this function instead.
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("authorization") || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) {
    return json({ error: "Missing Authorization header" }, 401);
  }

  const { data: callerData, error: callerError } = await admin.auth.getUser(callerToken);
  if (callerError || !callerData?.user) {
    return json({ error: "Invalid session" }, 401);
  }

  const { data: callerProfile, error: profileError } = await admin
    .from("profiles")
    .select("role,organization_id")
    .eq("id", callerData.user.id)
    .single();

  if (profileError || callerProfile?.role !== "admin") {
    return json({ error: "Only admins can invite users" }, 403);
  }
  if (!callerProfile.organization_id) {
    return json({ error: "Your account isn't linked to an organization yet" }, 400);
  }

  const body = await req.json().catch(() => null);
  const email = body?.email?.trim().toLowerCase();
  const role = body?.role === "admin" ? "admin" : "member";

  if (!email || !email.includes("@")) {
    return json({ error: "A valid email is required" }, 400);
  }

  const siteUrl = process.env.URL || "https://buildtrack-montego-platform.netlify.app";
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl}/set-password`,
  });

  if (inviteError) {
    return json({ error: inviteError.message }, 400);
  }

  // New invitees join the inviting admin's organization — this is the boundary that keeps
  // one client's data invisible to another's.
  const { error: profileUpdateError } = await admin
    .from("profiles")
    .update({ role, organization_id: callerProfile.organization_id })
    .eq("id", invited.user.id);
  if (profileUpdateError) {
    return json({ warning: `Invited, but failed to set org/role: ${profileUpdateError.message}` }, 200);
  }

  return json({ success: true, email, role });
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const config = {
  path: "/api/invite-user",
};
