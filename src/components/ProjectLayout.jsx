import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient.js";

export default function ProjectLayout() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);

  useEffect(() => {
    supabase
      .from("projects")
      .select("id,name,client_name")
      .eq("id", projectId)
      .single()
      .then(({ data }) => setProject(data));
  }, [projectId]);

  return (
    <div>
      <Link to="/" className="back-link">
        ← All projects
      </Link>
      <div className="project-header">
        <h1>{project?.name ?? "…"}</h1>
        {project?.client_name && <p className="task-meta">{project.client_name}</p>}
      </div>

      <nav className="sub-nav">
        <NavLink to={`/projects/${projectId}`} end>
          Dashboard
        </NavLink>
        <NavLink to={`/projects/${projectId}/timeline`}>Timeline</NavLink>
        <NavLink to={`/projects/${projectId}/invoices`}>Invoices</NavLink>
        <NavLink to={`/projects/${projectId}/rfps`}>RFPs</NavLink>
        <NavLink to={`/projects/${projectId}/audit`}>Audit Log</NavLink>
        <NavLink to={`/projects/${projectId}/briefing`}>Briefing</NavLink>
      </nav>

      <Outlet context={{ projectId }} />
    </div>
  );
}
