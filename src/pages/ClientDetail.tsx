import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Folder, MessageSquare, Image as ImageIcon, Plus, ArrowLeft, Loader2, Folder as FolderIcon, Bot, Package } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/Clients/Breadcrumbs";
import { StatCard } from "@/components/Clients/StatCard";
import { RecentProjectItem } from "@/components/Clients/RecentProjectItem";
import { ActivityFeed } from "@/components/Clients/ActivityFeed";
import { SuggestionsCard } from "@/components/Clients/SuggestionsCard";

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

  const breadcrumbs = [
    { label: "Dashboard", href: "/clients" },
    { label: "Client", href: "/clients" },
    { label: client?.name || "..." },
  ];

  // Placeholder data for recent projects
  const recentProjects = projects?.slice(0, 3).map((p, i) => ({
    id: p.project_id,
    name: p.project_name,
    code: `PRJ-00${i + 1}`,
    status: (['completato', 'in elaborazione', 'attivo'] as const)[i % 3],
    productCount: (p.chat_count || 0) * 5, // Placeholder logic
    progress: (p.chat_count || 0) * 10 % 101, // Placeholder logic
  })) || [];

  if (isLoadingClient || isLoadingProjects) {
    return <div className="p-8"><Skeleton className="h-12 w-1/3" /><div className="mt-8 grid grid-cols-3 gap-4"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div></div>;
  }

  if (error) {
    return <div className="p-8"><Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert></div>;
  }

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto bg-gray-50/50 dark:bg-background">
        <Breadcrumbs items={breadcrumbs} />
        
        <header className="mt-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-muted rounded-lg">
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">{client?.name}</h1>
              <p className="text-muted-foreground">Dashboard Cliente</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline">Carica Prodotti</Button>
            <Button variant="outline">Genera Modelli</Button>
            <Button onClick={() => setIsModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('newProject')}
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
          <StatCard title="Progetti Totali" value={projects?.length || 0} icon={<FolderIcon className="h-6 w-6 text-muted-foreground" />} />
          <StatCard title="Modelli Attivi" value={24} icon={<Bot className="h-6 w-6 text-muted-foreground" />} />
          <StatCard title="Prodotti Caricati" value={156} icon={<Package className="h-6 w-6 text-muted-foreground" />} />
        </div>

        <Tabs defaultValue="panoramica" className="mt-6">
          <TabsList>
            <TabsTrigger value="panoramica">Panoramica</TabsTrigger>
            <TabsTrigger value="progetti">Progetti</TabsTrigger>
            <TabsTrigger value="prodotti">Prodotti</TabsTrigger>
            <TabsTrigger value="modelli">Modelli</TabsTrigger>
          </TabsList>
          <TabsContent value="panoramica" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle>Progetti Recenti</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {recentProjects.map(p => <RecentProjectItem key={p.id} project={p} />)}
                  </div>
                </CardContent>
              </Card>
              <div className="space-y-6">
                <ActivityFeed />
                <SuggestionsCard />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="progetti" className="mt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {projects?.map(project => (
                <ProjectCard key={project.project_id} project={project} />
              ))}
            </div>
          </TabsContent>
          <TabsContent value="prodotti" className="mt-6"><p>Sezione Prodotti in costruzione.</p></TabsContent>
          <TabsContent value="modelli" className="mt-6"><p>Sezione Modelli in costruzione.</p></TabsContent>
        </Tabs>
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
              {isCreating && <Loader2 className="mr-2 h-4 w-4" />}
              {t('createProject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ClientDetail;