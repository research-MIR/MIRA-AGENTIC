import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "./SessionContextProvider";

const ProtectedRoute = () => {
  const { session } = useSession();

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;