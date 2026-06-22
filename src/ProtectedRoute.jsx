// ProtectedRoute.jsx
// Wraps any route that requires a logged-in user.
// If no role is found in localStorage, redirects to login page.
// If a role IS found but doesn't match the allowed role, also redirects.
//
// Usage in App.jsx:
//   <Route path="/admin"   element={<ProtectedRoute role="admin">  <AdminHomepage />  </ProtectedRoute>} />
//   <Route path="/teacher" element={<ProtectedRoute role="teacher"><TeacherHomepage /></ProtectedRoute>} />
//   <Route path="/parent"  element={<ProtectedRoute role="parent"> <ParentDashboard /></ProtectedRoute>} />

import { Navigate } from "react-router-dom";

function ProtectedRoute({ role, children }) {
  const storedRole = localStorage.getItem("role");

  // Not logged in at all → back to login
  if (!storedRole) {
    return <Navigate to="/" replace />;
  }

  // Logged in but wrong role (e.g. a parent trying /admin) → back to login
  if (role && storedRole !== role) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export default ProtectedRoute;
