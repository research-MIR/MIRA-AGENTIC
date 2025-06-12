import { NavLink, useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { MessageSquare, Image, GalleryHorizontal, LogOut, HelpCircle, LogIn, Shirt } from "lucide-react";
import { useSession } from "./Auth/SessionContextProvider";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "./ui/skeleton";
import { useLanguage } from "@/context/LanguageContext";
import { useOnboardingTour } from "@/context/OnboardingTourContext";

interface JobHistory {
  id: string;
  original_prompt: string;
}

export const Sidebar = () => {
  const { session, supabase } = useSession();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { startTour } = useOnboardingTour();

  const fetchJobHistory = async () => {
    if (!session?.user) return [];
    const { data, error } = await supabase
      .from("mira-agent-jobs")
      .select("id, original_prompt")
      .eq("user_id", session.user.id)
      .or("context->>source.eq.agent,context->>source.is.null")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data as JobHistory[];
  };

  const { data: jobHistory, isLoading } = useQuery<JobHistory[]>({
    queryKey: ["jobHistory", session?.user?.id],
    queryFn: fetchJobHistory,
    enabled: !!session?.user,
    refetchOnWindowFocus: true,
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const handleRestartTour = () => {
    navigate('/chat');
    startTour();
  };

  return (
    <aside className="w-64 bg-background border-r flex flex-col">
      <div className="p-4 border-b">
        <h1 className="text-2xl font-bold">MIRA</h1>
      </div>
      <nav className="p-4 space-y-2">
        <NavLink id="chat-nav-link" to="/chat" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
          <MessageSquare size={20} />
          {t.agentChat}
        </NavLink>
        <NavLink id="generator-nav-link" to="/generator" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
          <Image size={20} />
          {t.generator}
        </NavLink>
        <NavLink id="virtual-try-on-nav-link" to="/virtual-try-on" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
          <Shirt size={20} />
          {t.virtualTryOn}
        </NavLink>
        <NavLink id="gallery-nav-link" to="/gallery" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
          <GalleryHorizontal size={20} />
          {t.gallery}
        </NavLink>
      </nav>
      <div className="flex-1 p-4 space-y-2 overflow-y-auto">
        <h2 className="text-sm font-semibold text-muted-foreground">{t.chatHistory}</h2>
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : (
          jobHistory?.map(job => (
            <NavLink key={job.id} to={`/chat/${job.id}`} className={({ isActive }) => `block p-2 rounded-md text-sm truncate ${isActive ? 'bg-muted font-semibold' : 'hover:bg-muted'}`}>
              {job.original_prompt || "Untitled Chat"}
            </NavLink>
          ))
        )}
      </div>
      <div className="p-4 border-t space-y-2">
        <Button variant="ghost" className="w-full justify-start gap-2" onClick={handleRestartTour}>
          <HelpCircle size={20} />
          {t.restartOnboarding}
        </Button>
        {session ? (
          <Button variant="ghost" className="w-full justify-start gap-2" onClick={handleLogout}>
            <LogOut size={20} />
            {t.logout}
          </Button>
        ) : (
          <Button variant="ghost" className="w-full justify-start gap-2" onClick={() => navigate("/login")}>
            <LogIn size={20} />
            {t.login}
          </Button>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;