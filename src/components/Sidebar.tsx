import { useState } from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { Button } from "./ui/button";
import { MessageSquare, Image, GalleryHorizontal, LogOut, HelpCircle, LogIn, Shirt, Code, Wand2, PencilRuler, Pencil, Trash2, Settings, FolderPlus, LayoutGrid } from "lucide-react";
import { useSession } from "./Auth/SessionContextProvider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "./ui/skeleton";
import { useLanguage } from "@/context/LanguageContext";
import { useOnboardingTour } from "@/context/OnboardingTourContext";
import { ActiveJobsTracker } from "@/components/Jobs/ActiveJobsTracker";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import { AddToProjectDialog } from "./Jobs/AddToProjectDialog";
import { useModalStore } from "@/store/modalStore";

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
  const { openMoveToProjectModal } = useModalStore();

  const [renamingJob, setRenamingJob] = useState<JobHistory | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<'created_at' | 'updated_at'>('updated_at');

  const { data: projects } = useQuery<Project[]>({
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
        .not('context->>source', 'in', '("direct_generator","refiner","project_upload","project_gallery_add")')
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

  const unassignedChats = jobHistory?.filter(job => !job.project_id) || [];

  return (
    <>
      <aside className="w-64 bg-background border-r flex flex-col h-screen">
        <div className="p-4 border-b">
          <h1 className="text-2xl font-bold">MIRA</h1>
        </div>
        <nav className="p-4 space-y-2">
          <NavLink id="chat-nav-link" to="/chat" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <MessageSquare size={20} />
            {t('agentChat')}
          </NavLink>
          <NavLink id="projects-nav-link" to="/projects" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <LayoutGrid size={20} />
            {t('projectsTitle')}
          </NavLink>
          <NavLink id="generator-nav-link" to="/generator" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <Image size={20} />
            {t('generator')}
          </NavLink>
          <NavLink id="refine-nav-link" to="/refine" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <Wand2 size={20} />
            {t('refineAndUpscale')}
          </NavLink>
          <NavLink id="editor-nav-link" to="/editor" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <PencilRuler size={20} />
            {t('imageEditor')}
          </NavLink>
          <NavLink id="virtual-try-on-nav-link" to="/virtual-try-on" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <Shirt size={20} />
            {t('virtualTryOn')}
          </NavLink>
          <NavLink id="gallery-nav-link" to="/gallery" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <GalleryHorizontal size={20} />
            {t('gallery')}
          </NavLink>
          <NavLink id="developer-nav-link" to="/developer" className={({ isActive }) => `flex items-center gap-2 p-2 rounded-md ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            <Code size={20} />
            {t('developer')}
          </NavLink>
        </nav>
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex justify-between items-center w-full px-4 pt-4 pb-2">
                <h2 className="text-sm font-semibold text-muted-foreground">Recent Chats</h2>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setIsSettingsModalOpen(true); }}><Settings className="h-4 w-4" /></Button>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar">
                <div className="p-2 space-y-1">
                    {isLoadingJobs ? (
                    <div className="space-y-2">
                        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                    </div>
                    ) : (
                    unassignedChats.map(job => (
                        <div 
                          key={job.id} 
                          className="group relative"
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('application/json', JSON.stringify(job))}
                        >
                          <NavLink to={`/chat/${job.id}`} className={({ isActive }) => `flex items-center justify-between p-2 rounded-md text-sm ${isActive ? 'bg-primary text-primary-foreground font-semibold' : 'hover:bg-muted'}`}>
                              <span className="truncate pr-1">{job.original_prompt || "Untitled Chat"}</span>
                          </NavLink>
                          <div className="absolute right-1 top-1/2 -translate-y-1/2 z-10 flex items-center gap-0.5 rounded-md bg-muted/80 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto">
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Add to project" onClick={(e) => { e.preventDefault(); openMoveToProjectModal(job); }}>
                              <FolderPlus className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Rename" onClick={(e) => { e.preventDefault(); setNewName(job.original_prompt); setRenamingJob(job); }}>
                              <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10" title="Delete" onClick={(e) => { e.preventDefault(); setDeletingJobId(job.id); }}>
                              <Trash2 className="h-4 w-4 text-destructive/80" />
                              </Button>
                          </div>
                        </div>
                    ))
                    )}
                </div>
            </div>
        </div>
        <div className="p-4 border-t space-y-2">
          <ActiveJobsTracker />
          <Button variant="ghost" className="w-full justify-start gap-2" onClick={handleRestartTour}>
            <HelpCircle size={20} />
            {t('restartOnboarding')}
          </Button>
          {session ? (
            <Button variant="ghost" className="w-full justify-start gap-2" onClick={handleLogout}>
              <LogOut size={20} />
              {t('logout')}
            </Button>
          ) : (
            <Button variant="ghost" className="w-full justify-start gap-2" onClick={() => navigate("/login")}>
              <LogIn size={20} />
              {t('login')}
            </Button>
          )}
        </div>
      </aside>

      <AddToProjectDialog projects={projects || []} />

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
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isSettingsModalOpen} onOpenChange={setIsSettingsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('chatSettings')}</DialogTitle>
            <DialogDescription>{t('manageChatHistory')}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>{t('sortChatsBy')}</Label>
            <RadioGroup defaultValue={sortOrder} onValueChange={(value: 'created_at' | 'updated_at') => handleSortChange(value)} className="mt-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="updated_at" id="sort-updated" />
                <Label htmlFor="sort-updated">{t('lastUpdated')}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="created_at" id="sort-created" />
                <Label htmlFor="sort-created">{t('creationDate')}</Label>
              </div>
            </RadioGroup>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Sidebar;