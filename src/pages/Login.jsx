import { useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function Login() {
  const { user } = useAuth();
  const [mode, setMode] = useState("signin"); // 'signin' | 'reset'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) setError(error.message);
  }

  async function handleReset(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    // Supabase doesn't reveal whether the email is actually registered here (and neither
    // should this UI) — the same message covers both outcomes so a login page can't be used
    // to probe for valid accounts.
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/set-password`,
    });
    setSubmitting(false);
    setResetMessage("If an account exists for that email, a password reset link is on its way.");
  }

  if (mode === "reset") {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={handleReset}>
          <h1>Reset password</h1>
          <p className="auth-subtitle">We'll email you a link to set a new password.</p>

          <label htmlFor="reset-email">Email</label>
          <input
            id="reset-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {resetMessage && <p className="task-meta">{resetMessage}</p>}
          {error && <p className="auth-error">{error}</p>}

          <button type="submit" disabled={submitting}>
            {submitting ? "Sending…" : "Send reset link"}
          </button>

          <button
            type="button"
            className="link-btn"
            style={{ marginTop: 12 }}
            onClick={() => {
              setMode("signin");
              setResetMessage("");
              setError("");
            }}
          >
            ← Back to sign in
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>BuildTrack</h1>
        <p className="auth-subtitle">Montego Venue schedule</p>

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>

        <button
          type="button"
          className="link-btn"
          style={{ marginTop: 12 }}
          onClick={() => {
            setMode("reset");
            setError("");
          }}
        >
          Forgot password?
        </button>
      </form>
    </div>
  );
}
