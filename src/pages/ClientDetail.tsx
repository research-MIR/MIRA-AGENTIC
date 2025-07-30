import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Folder, MessageSquare, Image as ImageIcon, Plus, ArrowLeft, Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";

interface ProjectPreview {
  project_id: string;
  project_name: string;
  chat_count: number;
  latest_image_url: string | null;
}

const ProjectCard = ({ project }: { project: ProjectPreview }) => {
  const { displayUrl, isLoading } = useSecureImage(project.latest_image_url);

  return (
    <Link to={`/projects/${project.project_id}`}>
      <Card className="hover:border-primary transition-colors h-full flex flex-col">
        <CardHeader className="p-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Folder className="h-5 w-5 text-primary" />
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
  );
};

const ClientDetail = () => {
  const { clientId } = useParams();
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const { data: client, isLoading: isLoadingClient } = useQuery({
    queryKey: ['client', clientId],
    queryFn: async () => {
      if (!clientId) return null;
      const { data, error } = await supabase.from('mira-agent-clients').select('name').eq('id', clientId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId,
  });

  const { data: projects, isLoading: isLoadingProjects, error } = useQuery<ProjectPreview[]>({
    queryKey: ["clientProjects", clientId, session?.user?.id],
    queryFn: async () => {
      if (!session?.user || !clientId) return [];
      const { data, error } = await supabase.rpc('get_client_project_previews', { p_user_id: session.user.id, p_client_id: clientId });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user && !!clientId,
  });

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !session?.user || !clientId) return;
    setIsCreating(true);
    const toastId = showLoading("Creating project...");
    try {
      const { error } = await supabase.from('mira-agent-projects').insert({ name: newProjectName, user_id: session.user.id, client_id: clientId });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(`Project "${newProjectName}" created.`);
      setNewProjectName('');
      queryClient.invalidateQueries({ queryKey: ['clientProjects', clientId] });
      queryClient.invalidateQueries({ queryKey: ['clientPreviews'] });
      setIsModalOpen(false);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to create project: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <Link to="/clients" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="h-4 w-4" />
            Back to All Clients
          </Link>
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold">{isLoadingClient ? <Skeleton className="h-8 w-48" /> : client?.name || "Client"}</h1>
            <Button onClick={() => setIsModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('newProject')}
            </Button>
          </div>
        </header>

        {isLoadingProjects ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : projects && projects.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {projects.map(project => (
              <ProjectCard key={project.project_id} project={project} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <Folder className="mx-auto h-16 w-16 text-muted-foreground" />
            <h2 className="mt-4 text-xl font-semibold">No projects for this client yet</h2>
            <p className="mt-2 text-muted-foreground">Click the 'New Project' button to create one.</p>
          </div>
        )}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createNewProject')}</DialogTitle>
            <DialogDescription>Create a new project for {client?.name}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Label htmlFor="project-name">{t('name')}</Label>
            <Input id="project-name" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={handleCreateProject} disabled={isCreating || !newProjectName.trim()}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('createProject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ClientDetail;