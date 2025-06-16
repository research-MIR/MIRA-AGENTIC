import { NavLink, useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { MessageSquare, Image, GalleryHorizontal, LogOut, HelpCircle, LogIn, Shirt, Code, Wand2, PencilRuler } from "lucide-react";
import { useSession } from "./Auth/SessionContextProvider";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "./ui/skeleton";
import { useLanguage } from "@/context/LanguageContext";
import { useOnboardingTour } from "@/context/OnboardingTourContext";
import { ActiveJobsTracker } from "./ActiveJobsTracker";

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
      .or("context->>source.eq.agent,context->>source.is.null,context->>source.eq.agent_branch")
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

  const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 p-2 rounded-md text-sidebar-foreground ${
      isActive
        ? 'bg-sidebar-primary text-sidebar-primary-foreground'
        : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
    }`;
  
  const historyLinkClasses = ({ isActive }: { isActive: boolean }) =>
    `block p-2 rounded-md text-sm truncate text-sidebar-foreground ${
      isActive
        ? 'bg-sidebar-primary text-sidebar-primary-foreground font-semibold'
        : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
    }`;

  return (
    <aside className="w-64 bg-sidebar border-r flex flex-col">
      <div className="p-4 border-b">
        <h1 className="text-2xl font-bold">MIRA</h1>
      </div>
      <nav className="p-4 space-y-2">
        <NavLink id="chat-nav-link" to="/chat" className={navLinkClasses}>
          <MessageSquare size={20} />
          {t.agentChat}
        </NavLink>
        <NavLink id="generator-nav-link" to="/generator" className={navLinkClasses}>
          <Image size={20} />
          {t.generator}
        </NavLink>
        <NavLink id="refine-nav-link" to="/refine" className={navLinkClasses}>
          <Wand2 size={20} />
          {t.refineAndUpscale}
        </NavLink>
        <NavLink id="editor-nav-link" to="/editor" className={navLinkClasses}>
          <PencilRuler size={20} />
          {t.imageEditor}
        </NavLink>
        <NavLink id="virtual-try-on-nav-link" to="/virtual-try-on" className={navLinkClasses}>
          <Shirt size={20} />
          {t.virtualTryOn}
        </NavLink>
        <NavLink id="gallery-nav-link" to="/gallery" className={navLinkClasses}>
          <GalleryHorizontal size={20} />
          {t.gallery}
        </NavLink>
        <NavLink id="developer-nav-link" to="/developer" className={navLinkClasses}>
          <Code size={20} />
          {t.developer}
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
            <NavLink key={job.id} to={`/chat/${job.id}`} className={historyLinkClasses}>
              {job.original_prompt || "Untitled Chat"}
            </NavLink>
          ))
        )}
      </div>
      <div className="p-4 border-t space-y-2">
        <ActiveJobsTracker />
        <Button variant="ghost" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={handleRestartTour}>
          <HelpCircle size={20} />
          {t.restartOnboarding}
        </Button>
        {session ? (
          <Button variant="ghost" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={handleLogout}>
            <LogOut size={20} />
            {t.logout}
          </Button>
        ) : (
          <Button variant="ghost" className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={() => navigate("/login")}>
            <LogIn size={20} />
            {t.login}
          </Button>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;