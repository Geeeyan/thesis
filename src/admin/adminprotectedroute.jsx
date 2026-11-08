import { Navigate } from "react-router-dom";
import { getSessionUser } from "../api";

export default function AdminProtectedRoute({ children }) {
  const user = getSessionUser();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== "admin") {
    return <Navigate to="/login" replace />;
  }

  return children;
}
