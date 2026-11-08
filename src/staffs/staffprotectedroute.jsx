import { Navigate } from "react-router-dom";
import { getSessionUser } from "../api";

export default function ProtectedRoute({ children }) {
  const user = getSessionUser();

  // Not logged in at all → redirect to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Logged in but not a staff member → redirect to login
  if (user.role !== "staff") {
    return <Navigate to="/login" replace />;
  }

  return children;
}
