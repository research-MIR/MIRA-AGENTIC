import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from './Auth/SessionContextProvider';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { NavLink, useParams, useNavigate } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Plus, Folder, Edit, Trash2, Loader2 } from 'lucide-react';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { Skeleton } from './ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Label } from './ui/label';

interface Project {
  id: string;
  name: string;
}

interface Job {
  id: string;
  original_prompt: string;
  project_id: string;
}

const ProjectItem = ({ project, allJobs, onRename, onDelete }: { project: Project, allJobs: Job[], onRename: (job: Job) => void, onDelete: (jobId: string) => void }) => {
  const projectJobs = allJobs.filter(job => job.project_id === project.id);

  if (projectJobs.length === 0) {
    return (
      <AccordionItem value={project.id} disabled>
        <AccordionTrigger className="hover:no-underline">
          <div className="flex items-center gap-2">
            <Folder className="h-4 w-4" />
            <span className="text-sm font-semibold">{project.name}</span>
          </div>
        </AccordionTrigger>
      </AccordionItem>
    );
  }

  return (
    <AccordionItem value={project.id}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <Folder className="h-4 w-4" />
          <span className="text-sm font-semibold">{project.name}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pl-4">
        {projectJobs.map(job => (
          <div key={job.id} className="group relative">
            <NavLink
              to={`/chat/${job.id}`}
              className={({ isActive }) => `block p-2 rounded-md text-sm truncate pr-16 ${isActive ? 'bg-primary text-primary-foreground font-semibold' : 'hover:bg-muted'}`}
            >
              {job.original_prompt || "Untitled Chat"}
            </NavLink>
            <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-muted/80 rounded-md">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.preventDefault(); onRename(job); }}>
                <Edit className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 hover:bg-destructive/10" onClick={(e) => { e.preventDefault(); onDelete(job.id); }}>
                <Trash2 className="h-4 w-4 text-destructive/80" />
              </Button>
            </div>
          </div>
        ))}
      </AccordionContent>
    </AccordionItem>
  );
};

export const ProjectFolders = () => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { jobId: activeJobId } = useParams();

  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [renamingJob, setRenamingJob] = useState<Job | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

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

  const { data: allJobs, isLoading: isLoadingJobs } = useQuery<Job[]>({
    queryKey: ['jobHistory', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from("mira-agent-jobs").select("id, original_prompt, project_id").eq("user_id", session.user.id).order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return data as Job[];
    },
    enabled: !!session?.user,
  });

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !session?.user) return;
    setIsCreating(true);
    try {
      const { error } = await supabase.from('projects').insert({ name: newProjectName, user_id: session.user.id });
      if (error) throw error;
      showSuccess(`Project "${newProjectName}" created.`);
      setNewProjectName('');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setIsModalOpen(false);
    } catch (err: any) {
      showError(`Failed to create project: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
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

  if (isLoadingProjects || isLoadingJobs) {
    return <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>;
  }

  return (
    <div className="space-y-2">
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogTrigger asChild><Button variant="outline" size="sm" className="w-full"><Plus className="h-4 w-4 mr-2" />New Project</Button></DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Create New Project</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="project-name" className="text-right">Name</Label>
              <Input id="project-name" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} className="col-span-3" onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button onClick={handleCreateProject} disabled={isCreating || !newProjectName.trim()}>{isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create Project</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {projects && projects.length > 0 && allJobs && (
        <Accordion type="multiple" className="w-full">
          {projects.map(p => <ProjectItem key={p.id} project={p} allJobs={allJobs} onRename={(job) => { setNewName(job.original_prompt); setRenamingJob(job); }} onDelete={setDeletingJobId} />)}
        </Accordion>
      )}

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
    </div>
  );
};