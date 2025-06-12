import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "./SessionContextProvider";

const ProtectedRoute = () => {
  const { session } = useSession();
  const location = useLocation();

  // Temporary workaround: Allow access to the developer page during the auth outage.
  if (location.pathname.startsWith('/developer')) {
    return <Outlet />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;