import { useState, useRef } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { Button } from "./ui/button";
import { MessageSquare, Image, GalleryHorizontal, LogOut, HelpCircle, LogIn, Shirt, Code, Wand2, PencilRuler, Edit, Trash2, Settings, FolderPlus, Move, LayoutGrid } from "lucide-react";
import { useSession } from "./Auth/SessionContextProvider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "./ui/skeleton";
import { useLanguage } from "@/context/LanguageContext";
import { useOnboardingTour } from "@/context/OnboardingTourContext";
import { ActiveJobsTracker } from "@/components/Jobs/ActiveJobsTracker";
import { ProjectFolders } from "./ProjectFolders";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import { AddToProjectDialog } from "./Jobs/AddToProjectDialog";
import { cn } from "@/lib/utils";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";

interface JobHistory {
  id: string;
  original_prompt: string;
  project_id: string | null;
}

interface Project {
  id: string;
  name: string;
}

export const Sidebar = () => {
  const { session, supabase } = useSession();
  const navigate = useNavigate();
  const { jobId: activeJobId } = useParams();
  const { t } = useLanguage();
  const { startTour } = useOnboardingTour();
  const queryClient = useQueryClient();

  const [renamingJob, setRenamingJob] = useState<JobHistory | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [movingJob, setMovingJob] = useState<JobHistory | null>(null);
  const [newName, setNewName] = useState("");
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<'created_at' | 'updated_at'>('updated_at');
  const [draggingOverProjectId, setDraggingOverProjectId] = useState<string | null>(null);

  const { data: projects, isLoading: isLoadingProjects } = useQuery<Project[]>({
    queryKey: ['projects', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('projects').select('id, name').eq('user_id', session.user.id).order('name', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const { data: jobHistory, isLoading: isLoadingJobs } = useQuery<JobHistory[]>({
    queryKey: ["jobHistory", session?.user?.id, sortOrder],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from("mira-agent-jobs")
        .select("id, original_prompt, project_id, context")
        .eq("user_id", session.user.id)
        .or('context->>source.eq.agent,context->>source.eq.agent_branch,context->>source.is.null')
        .order(sortOrder, { ascending: false });
      if (error) throw new Error(error.message);
      return data as JobHistory[];
    },
    enabled: !!session?.user,
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const handleRestartTour = () => {
    navigate('/chat');
    startTour();
  };

  const handleRename = async () => {
    if (!renamingJob || !newName.trim()) return;
    const toastId = showLoading("Renaming chat...");
    try {
      const { error } = await supabase.from('mira-agent-jobs').update({ original_prompt: newName }).eq('id', renamingJob.id);
      if (error) throw error;
      dismissToast(toastId);
      showSuccess("Chat renamed.");
      queryClient.invalidateQueries({ queryKey: ['jobHistory'] });
      queryClient.invalidateQueries({ queryKey: ['chatJob', renamingJob.id] });
      setRenamingJob(null);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to rename chat: ${err.message}`);
    }
  };

  const handleDelete = async () => {
    if (!deletingJobId) return;
    const toastId = showLoading("Deleting chat...");
    try {
      const { error } = await supabase.rpc('delete_mira_agent_job', { p_job_id: deletingJobId });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess("Chat deleted.");
      queryClient.invalidateQueries({ queryKey: ["jobHistory"] });
      if (activeJobId === deletingJobId) {
        navigate("/chat");
      }
      setDeletingJobId(null);
    } catch (error: any) {
      dismissToast(toastId);
      showError(`Error deleting chat: ${error.message}`);
    }
  };

  const handleSortChange = (newSortOrder: 'created_at' | 'updated_at') => {
    setSortOrder(newSortOrder);
    setIsSettingsModalOpen(false);
  };

  const handleDropOnProject = async (projectId: string, e: React.DragEvent) => {
    e.preventDefault();
    const jobId = e.dataTransfer.getData("application/mira-job-id");
    setDraggingOverProjectId(null);
    if (!jobId) return;

    const toastId = showLoading("Moving chat to project...");
    try {
      const { error } = await supabase.rpc('update_job_project', { p_job_id: jobId, p_project_id: projectId });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess("Chat moved successfully.");
      queryClient.invalidateQueries({ queryKey: ['jobHistory'] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to move chat: ${err.message}`);
    }
  };

  const recentChats = jobHistory?.slice(0, 20) || [];

  return (
    <>
      <aside className="w-64 bg-background border-r flex flex-col h-screen">
        <div className="p-4 border-b">
          <h1 className="text-2xl font-bold">MIRA</h1>
        </div>
        <nav className="p-4 space-y-2">
          <NavLink id="chat-nav-link" to="/chat" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <MessageSquare size={20} />
            {t.agentChat}
          </NavLink>
          <NavLink id="projects-nav-link" to="/projects" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <LayoutGrid size={20} />
            Projects
          </NavLink>
          <NavLink id="generator-nav-link" to="/generator" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <Image size={20} />
            {t.generator}
          </NavLink>
          <NavLink id="refine-nav-link" to="/refine" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <Wand2 size={20} />
            {t.refineAndUpscale}
          </NavLink>
          <NavLink id="editor-nav-link" to="/editor" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <PencilRuler size={20} />
            {t.imageEditor}
          </NavLink>
          <NavLink id="virtual-try-on-nav-link" to="/virtual-try-on" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <Shirt size={20} />
            {t.virtualTryOn}
          </NavLink>
          <NavLink id="gallery-nav-link" to="/gallery" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <GalleryHorizontal size={20} />
            {t.gallery}
          </NavLink>
          <NavLink id="developer-nav-link" to="/developer" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <Code size={20} />
            {t.developer}
          </NavLink>
        </nav>
        <div className="flex-1 flex flex-col overflow-hidden">
            <Accordion type="multiple" defaultValue={['projects', 'recent-chats']} className="w-full flex flex-col flex-1">
                <AccordionItem value="projects" className="border-b">
                    <AccordionTrigger className="px-4 py-2 text-sm font-semibold text-muted-foreground hover:no-underline">Projects</AccordionTrigger>
                    <AccordionContent>
                        <ScrollArea className="h-48">
                            <div className="p-2 space-y-2">
                                {isLoadingProjects || isLoadingJobs ? <Skeleton className="h-8 w-full" /> : 
                                <ProjectFolders 
                                    projects={projects || []} 
                                    allJobs={jobHistory || []} 
                                    draggingOverProjectId={draggingOverProjectId}
                                    onDragEnter={(projectId) => setDraggingOverProjectId(projectId)}
                                    onDragLeave={() => setDraggingOverProjectId(null)}
                                    onDrop={handleDropOnProject}
                                />
                                }
                            </div>
                        </ScrollArea>
                    </AccordionContent>
                </AccordionItem>
                <AccordionItem value="recent-chats" className="border-none flex-1 flex flex-col">
                    <AccordionTrigger className="px-4 py-2 hover:no-underline">
                        <div className="flex justify-between items-center w-full">
                            <h2 className="text-sm font-semibold text-muted-foreground">Recent Chats</h2>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setIsSettingsModalOpen(true); }}><Settings className="h-4 w-4" /></Button>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="flex-1 overflow-hidden">
                        <ScrollArea className="h-full">
                            <div className="p-2 space-y-1">
                                {isLoadingJobs ? (
                                <div className="space-y-2">
                                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                                </div>
                                ) : (
                                recentChats.map(job => (
                                    <div 
                                    key={job.id} 
                                    className="group relative"
                                    draggable
                                    onDragStart={(e) => e.dataTransfer.setData("application/mira-job-id", job.id)}
                                    >
                                    <NavLink to={`/chat/${job.id}`} className={({ isActive }) => `block p-2 rounded-md text-sm truncate pr-24 ${isActive ? 'bg-primary text-primary-foreground font-semibold' : 'hover:bg-muted'}`}>
                                        {job.original_prompt || "Untitled Chat"}
                                    </NavLink>
                                    <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-muted/80 rounded-md">
                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Add to project" onClick={(e) => { e.preventDefault(); setMovingJob(job); }}>
                                        <FolderPlus className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Rename" onClick={(e) => { e.preventDefault(); setNewName(job.original_prompt); setRenamingJob(job); }}>
                                        <Edit className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10" title="Delete" onClick={(e) => { e.preventDefault(); setDeletingJobId(job.id); }}>
                                        <Trash2 className="h-4 w-4 text-destructive/80" />
                                        </Button>
                                    </div>
                                    </div>
                                ))
                                )}
                            </div>
                        </ScrollArea>
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        </div>
        <div className="p-4 border-t space-y-2">
          <ActiveJobsTracker />
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

      <AddToProjectDialog 
        job={movingJob}
        projects={projects || []}
        isOpen={!!movingJob}
        onClose={() => setMovingJob(null)}
      />

      <Dialog open={!!renamingJob} onOpenChange={(open) => !open && setRenamingJob(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Chat</DialogTitle></DialogHeader>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleRename()} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenamingJob(null)}>Cancel</Button>
            <Button onClick={handleRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingJobId} onOpenChange={(open) => !open && setDeletingJobId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This action cannot be undone. This will permanently delete this chat's history.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel onClick={() => setDeletingJobId(null)}>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isSettingsModalOpen} onOpenChange={setIsSettingsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chat Settings</DialogTitle>
            <DialogDescription>Manage how your chat history is displayed.</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Sort Chats By</Label>
            <RadioGroup defaultValue={sortOrder} onValueChange={(value: 'created_at' | 'updated_at') => handleSortChange(value)} className="mt-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="updated_at" id="sort-updated" />
                <Label htmlFor="sort-updated">Last Updated</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="created_at" id="sort-created" />
                <Label htmlFor="sort-created">Creation Date</Label>
              </div>
            </RadioGroup>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Sidebar;