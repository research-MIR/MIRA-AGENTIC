import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Folder, MessageSquare, Image as ImageIcon, Plus, Move, ImagePlus, Info } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import { cn } from "@/lib/utils";
import { ProjectImageManagerModal } from "@/components/ProjectImageManagerModal";

interface ProjectPreview {
  project_id: string;
  project_name: string;
  chat_count: number;
  latest_image_url: string | null;
}

const ProjectCard = ({ project, onDrop, onDragEnter, onDragLeave, isBeingDraggedOver, onManageImages }: { 
  project: ProjectPreview,
  onDrop: (projectId: string, e: React.DragEvent) => void,
  onDragEnter: (projectId: string) => void,
  onDragLeave: () => void,
  isBeingDraggedOver: boolean,
  onManageImages: (project: ProjectPreview) => void
}) => {
  const { displayUrl, isLoading } = useSecureImage(project.latest_image_url);

  return (
    <div
      onDrop={(e) => onDrop(project.project_id, e)}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={() => onDragEnter(project.project_id)}
      onDragLeave={onDragLeave}
      className={cn("rounded-lg transition-all relative group", isBeingDraggedOver && "ring-2 ring-primary ring-offset-2 ring-offset-background")}
    >
      <Button variant="secondary" size="icon" className="absolute top-2 right-2 z-10 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.preventDefault(); onManageImages(project); }}>
        <ImagePlus className="h-4 w-4" />
      </Button>
      <Link to={`/projects/${project.project_id}`}>
        <Card className="hover:border-primary transition-colors h-full flex flex-col">
          <CardHeader className="p-4">
            <CardTitle className="flex items-center gap-2 text-base">
              {isBeingDraggedOver ? <Move className="h-5 w-5 text-primary" /> : <Folder className="h-5 w-5 text-primary" />}
              <span className="truncate">{project.project_name}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 flex-1">
            <div className="aspect-[4/3] bg-muted rounded-md flex items-center justify-center overflow-hidden">
              {isLoading ? (
                <Skeleton className="w-full h-full" />
              ) : displayUrl ? (
                <img src={displayUrl} alt={project.project_name} className="w-full h-full object-cover" />
              ) : (
                <ImageIcon className="h-10 w-10 text-muted-foreground" />
              )}
            </div>
          </CardContent>
          <CardFooter className="p-4 pt-0">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <MessageSquare className="h-3 w-3" />
              <span>{project.chat_count} {project.chat_count === 1 ? 'chat' : 'chats'}</span>
            </div>
          </CardFooter>
        </Card>
      </Link>
    </div>
  );
};

const Projects = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [draggingOverProjectId, setDraggingOverProjectId] = useState<string | null>(null);
  const [managingProject, setManagingProject] = useState<ProjectPreview | null>(null);

  const { data: projects, isLoading, error } = useQuery<ProjectPreview[]>({
    queryKey: ["projectPreviews", session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      console.log("[ProjectsPage] Fetching project previews...");
      const { data, error } = await supabase.rpc('get_project_previews', { p_user_id: session.user.id });
      if (error) throw error;
      console.log("[ProjectsPage] Fetched previews:", data);
      return data;
    },
    enabled: !!session?.user,
  });

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !session?.user) return;
    setIsCreating(true);
    try {
      const { error } = await supabase.from('mira-agent-projects').insert({ name: newProjectName, user_id: session.user.id });
      if (error) throw error;
      showSuccess(`Project "${newProjectName}" created.`);
      setNewProjectName('');
      queryClient.invalidateQueries({ queryKey: ['projectPreviews'] });
      setIsModalOpen(false);
    } catch (err: any) {
      showError(`Failed to create project: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDrop = async (projectId: string, e: React.DragEvent) => {
    e.preventDefault();
    setDraggingOverProjectId(null);
    const jobDataString = e.dataTransfer.getData('application/json');
    if (!jobDataString) return;

    const jobData = JSON.parse(jobDataString);
    const toastId = showLoading(`Moving "${jobData.original_prompt}"...`);
    
    try {
      const { error } = await supabase.rpc('update_job_project', { p_job_id: jobData.id, p_project_id: projectId });
      if (error) throw error;
      
      const projectName = projects?.find(p => p.project_id === projectId)?.project_name || 'project';
      dismissToast(toastId);
      showSuccess(`Moved "${jobData.original_prompt}" to ${projectName}.`);
      
      queryClient.invalidateQueries({ queryKey: ['jobHistory'] });
      queryClient.invalidateQueries({ queryKey: ['projectPreviews'] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to move chat: ${err.message}`);
    }
  };

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">{t('projectsTitle')}</h1>
            <p className="text-muted-foreground">{t('projectsDescription')}</p>
          </div>
          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />{t('newProject')}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{t('createNewProject')}</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-4">
                <Label htmlFor="project-name">{t('name')}</Label>
                <Input id="project-name" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()} />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setIsModalOpen(false)}>{t('cancel')}</Button>
                <Button onClick={handleCreateProject} disabled={isCreating || !newProjectName.trim()}>{isCreating ? "Creating..." : t('createProject')}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </header>
        
        <Alert className="mb-8">
          <Info className="h-4 w-4" />
          <AlertTitle>{t('howProjectsWork')}</AlertTitle>
          <AlertDescription>
            {t('projectsDragDropInfo')}
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {projects.map(project => (
              <ProjectCard 
                key={project.project_id} 
                project={project} 
                onDrop={handleDrop}
                onDragEnter={setDraggingOverProjectId}
                onDragLeave={() => setDraggingOverProjectId(null)}
                isBeingDraggedOver={draggingOverProjectId === project.project_id}
                onManageImages={setManagingProject}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <Folder className="mx-auto h-16 w-16 text-muted-foreground" />
            <h2 className="mt-4 text-xl font-semibold">{t('noProjectsTitle')}</h2>
            <p className="mt-2 text-muted-foreground">{t('noProjectsDescription')}</p>
          </div>
        )}
      </div>
      {managingProject && (
        <ProjectImageManagerModal 
          project={managingProject}
          isOpen={!!managingProject}
          onClose={() => setManagingProject(null)}
        />
      )}
    </>
  );
};

export default Projects;