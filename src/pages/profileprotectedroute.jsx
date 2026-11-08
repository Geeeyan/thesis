import { Navigate } from "react-router-dom";
import { getSessionUser } from "../api";

export default function ProfileProtectedRoute({ children }) {
  const user = getSessionUser();
  if (!user || !["guest", "staff", "admin"].includes(user.role)) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
