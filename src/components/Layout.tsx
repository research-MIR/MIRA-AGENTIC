import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { OnboardingTour } from "./OnboardingTour";

const Layout = () => {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1">
        <Outlet />
      </main>
      <OnboardingTour />
    </div>
  );
};

export default Layout;