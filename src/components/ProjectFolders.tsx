import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from './Auth/SessionContextProvider';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { NavLink } from 'react-router-dom';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Plus, Folder } from 'lucide-react';
import { showError, showSuccess } from '@/utils/toast';
import { Skeleton } from './ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogClose } from '@/components/ui/dialog';
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

const ProjectItem = ({ project, allJobs }: { project: Project, allJobs: Job[] }) => {
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
          <NavLink
            key={job.id}
            to={`/chat/${job.id}`}
            className={({ isActive }) => `block p-2 rounded-md text-sm truncate ${isActive ? 'bg-primary text-primary-foreground font-semibold' : 'hover:bg-muted'}`}
          >
            {job.original_prompt || "Untitled Chat"}
          </NavLink>
        ))}
      </AccordionContent>
    </AccordionItem>
  );
};

export const ProjectFolders = () => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: projects, isLoading: isLoadingProjects } = useQuery<Project[]>({
    queryKey: ['projects', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('projects')
        .select('id, name')
        .eq('user_id', session.user.id)
        .order('name', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const { data: allJobs, isLoading: isLoadingJobs } = useQuery<Job[]>({
    queryKey: ['jobHistory', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from("mira-agent-jobs")
        .select("id, original_prompt, project_id")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });
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

  if (isLoadingProjects || isLoadingJobs) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            New Project
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="project-name" className="text-right">Name</Label>
              <Input
                id="project-name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="col-span-3"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button onClick={handleCreateProject} disabled={isCreating || !newProjectName.trim()}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {projects && projects.length > 0 && allJobs && (
        <Accordion type="multiple" className="w-full">
          {projects.map(p => <ProjectItem key={p.id} project={p} allJobs={allJobs} />)}
        </Accordion>
      )}
    </div>
  );
};