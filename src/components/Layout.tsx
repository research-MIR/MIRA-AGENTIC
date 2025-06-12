import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import { OnboardingTour } from "./OnboardingTour";

const Layout = () => {
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
      <OnboardingTour />
    </div>
  );
};

export default Layout;