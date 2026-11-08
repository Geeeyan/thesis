import { Navigate } from "react-router-dom";
import { getSessionUser } from "../api";

export default function UserProtectedRoute({ children }) {
  const user = getSessionUser();

  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "guest") {
    return <Navigate to={user.role === "admin" ? "/admin/dashboard" : "/staff/dashboard"} replace />;
  }

  return children;
}
