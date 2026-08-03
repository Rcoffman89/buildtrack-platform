import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import Layout from "./components/Layout.jsx";
import ProjectLayout from "./components/ProjectLayout.jsx";
import Login from "./pages/Login.jsx";
import SetPassword from "./pages/SetPassword.jsx";
import Projects from "./pages/Projects.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import TaskDetail from "./pages/TaskDetail.jsx";
import AuditLog from "./pages/AuditLog.jsx";
import Timeline from "./pages/Timeline.jsx";
import AdminUsers from "./pages/AdminUsers.jsx";
import WeeklyBriefing from "./pages/WeeklyBriefing.jsx";
import Vendors from "./pages/Vendors.jsx";
import Invoices from "./pages/Invoices.jsx";
import GlCodes from "./pages/GlCodes.jsx";
import Rfps from "./pages/Rfps.jsx";
import RfpDetail from "./pages/RfpDetail.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Projects />} />
            <Route path="briefing" element={<WeeklyBriefing />} />
            <Route path="vendors" element={<Vendors />} />
            <Route path="admin/users" element={<AdminUsers />} />
            <Route path="gl-codes" element={<GlCodes />} />
            <Route path="projects/:projectId" element={<ProjectLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="tasks/:id" element={<TaskDetail />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="rfps" element={<Rfps />} />
              <Route path="rfps/:id" element={<RfpDetail />} />
              <Route path="audit" element={<AuditLog />} />
              <Route path="timeline" element={<Timeline />} />
              <Route path="briefing" element={<WeeklyBriefing />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
