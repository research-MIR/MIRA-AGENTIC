import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Home, GalleryHorizontal, User, Bot, LogOut, MessageSquare, Sparkles, RefreshCw } from "lucide-react";
import { useSession } from "./Auth/SessionContextProvider";
import { ScrollArea } from "./ui/scroll-area";
import { Skeleton } from "./ui/skeleton";
import { useOnboardingTour } from "@/context/OnboardingTourContext";

interface ChatHistoryItem {
  id: string;
  original_prompt: string;
  created_at: string;
}

const Sidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, supabase } = useSession();
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const { startTour } = useOnboardingTour();

  useEffect(() => {
    if (!session?.user) return;

    const fetchHistory = async () => {
      setIsLoadingHistory(true);
      try {
        const { data, error } = await supabase
          .from("mira-agent-jobs")
          .select("id, original_prompt, created_at")
          .eq("user_id", session.user.id)
          .or('context->>source.neq.direct_generator,context->>source.is.null')
          .order("created_at", { ascending: false })
          .limit(20);

        if (error) throw error;
        setChatHistory(data || []);
      } catch (error) {
        console.error("Failed to fetch chat history:", error);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchHistory();

    const channel = supabase
      .channel('mira-agent-jobs-sidebar')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-jobs', filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          const newJob = payload.new as any;
          if (newJob.context?.source === 'direct_generator') {
            return;
          }
          if (payload.eventType === 'INSERT') {
            setChatHistory(prev => [newJob, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setChatHistory(prev => prev.map(chat => chat.id === newJob.id ? newJob : chat));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };

  }, [session, supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const navLinks = [
    { href: "/chat", label: "Agent Chat", icon: MessageSquare, id: "chat-nav-link" },
    { href: "/generator", label: "Generator", icon: Sparkles, id: "generator-nav-link" },
    { href: "/gallery", label: "Gallery", icon: GalleryHorizontal, id: "gallery-nav-link" },
  ];

  return (
    <aside className="hidden md:flex flex-col w-64 h-screen p-4 bg-background border-r">
      <div className="flex items-center mb-8">
        <Bot className="h-8 w-8 mr-2" />
        <h1 className="text-2xl font-bold">Mira</h1>
      </div>
      <nav className="space-y-2">
        {navLinks.map((link) => (
          <NavLink key={link.href} to={link.href} end={link.href === "/chat"} id={link.id}>
            {({ isActive }) => (
              <Button
                variant={isActive ? "default" : "ghost"}
                className="w-full justify-start"
              >
                <link.icon className="mr-2 h-4 w-4" />
                {link.label}
              </Button>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="mt-4 pt-4 border-t flex-1 flex flex-col min-h-0">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase mb-2 px-2">Chat History</h2>
        <ScrollArea className="flex-1">
          <div className="space-y-1 pr-2">
            {isLoadingHistory ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
            ) : (
              chatHistory.map((chat) => (
                <NavLink key={chat.id} to={`/chat/${chat.id}`}>
                  {({ isActive }) => (
                    <Button
                      variant={isActive ? "default" : "ghost"}
                      className="w-full justify-start text-left h-auto py-1.5"
                    >
                      <MessageSquare className="mr-2 h-4 w-4 flex-shrink-0" />
                      <span className="truncate text-sm">{chat.original_prompt || "Untitled Chat"}</span>
                    </Button>
                  )}
                </NavLink>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
      <div className="mt-auto pt-4 border-t space-y-2">
        <Button variant="ghost" className="w-full justify-start" onClick={startTour}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Restart Onboarding
        </Button>
        {session ? (
          <Button variant="outline" className="w-full justify-start" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </Button>
        ) : (
          <Link to="/login">
            <Button variant="outline" className="w-full justify-start">
              <User className="mr-2 h-4 w-4" />
              Login
            </Button>
          </Link>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;