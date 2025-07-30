import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Folder, Plus, Users, Bot, Shirt, FolderGit2, ImageIcon, MessageSquare } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/Clients/Breadcrumbs";
import { StatCard } from "@/components/Clients/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientModelCard } from "@/components/Clients/ClientModelCard";
import { ClientGarmentCard } from "@/components/Clients/ClientGarmentCard";
import { ClientVtoCard } from "@/components/Clients/ClientVtoCard";
import { RecentProjectItem } from "@/components/Clients/RecentProjectItem";
import { ClientActivityFeed } from "@/components/Clients/ClientActivityFeed";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useSecureImage } from "@/hooks/useSecureImage";
import { useImagePreview } from "@/context/ImagePreviewContext";

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
      </Card>
    </Link>
  );
};

const ClientDetail = () => {
  const { clientId } = useParams();
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { showImage } = useImagePreview();

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

  const { data: stats, isLoading: isLoadingStats } = useQuery({
    queryKey: ['clientDashboardStats', clientId, session?.user?.id],
    queryFn: async () => {
      if (!clientId || !session?.user) return null;
      const { data, error } = await supabase.rpc('get_client_dashboard_stats', { p_user_id: session.user.id, p_client_id: clientId }).single();
      if (error) throw error;
      return data;
    },
    enabled: !!clientId && !!session?.user,
  });

  const { data: recentProjects, isLoading: isLoadingRecentProjects } = useQuery({
    queryKey: ['clientRecentProjects', clientId, session?.user?.id],
    queryFn: async () => {
      if (!clientId || !session?.user) return [];
      const { data, error } = await supabase.rpc('get_client_recent_projects', { p_user_id: session.user.id, p_client_id: clientId });
      if (error) throw error;
      return data;
    },
    enabled: !!clientId && !!session?.user,
  });

  const { data: allProjects, isLoading: isLoadingProjects, error } = useQuery<ProjectPreview[]>({
    queryKey: ["clientProjects", clientId, session?.user?.id],
    queryFn: async () => {
      if (!session?.user || !clientId) return [];
      const { data, error } = await supabase.rpc('get_client_project_previews', { p_user_id: session.user.id, p_client_id: clientId });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user && !!clientId,
  });

  const { data: clientModels, isLoading: isLoadingModels } = useQuery({
    queryKey: ['clientModels', clientId, session?.user?.id],
    queryFn: async () => {
      if (!clientId || !session?.user) return [];
      const { data, error } = await supabase.rpc('get_models_for_client', { p_user_id: session.user.id, p_client_id: clientId });
      if (error) throw error;
      return data;
    },
    enabled: !!clientId && !!session?.user,
  });

  const { data: clientGarments, isLoading: isLoadingGarments } = useQuery({
    queryKey: ['clientGarments', clientId, session?.user?.id],
    queryFn: async () => {
      if (!clientId || !session?.user) return [];
      const { data, error } = await supabase.rpc('get_garments_for_client', { p_user_id: session.user.id, p_client_id: clientId });
      if (error) throw error;
      return data;
    },
    enabled: !!clientId && !!session?.user,
  });

  const { data: clientVtoJobs, isLoading: isLoadingVtoJobs } = useQuery({
    queryKey: ['clientVtoJobs', clientId, session?.user?.id],
    queryFn: async () => {
      if (!clientId || !session?.user) return [];
      const { data, error } = await supabase.rpc('get_vto_jobs_for_client', { p_user_id: session.user.id, p_client_id: clientId });
      if (error) throw error;
      return data;
    },
    enabled: !!clientId && !!session?.user,
  });

  const { data: clientGalleryImages, isLoading: isLoadingGallery } = useQuery({
    queryKey: ['clientGalleryImages', clientId, session?.user?.id],
    queryFn: async () => {
        if (!clientId || !session?.user) return [];
        const { data, error } = await supabase.rpc('get_client_gallery_images', { p_user_id: session.user.id, p_client_id: clientId });
        if (error) throw error;
        return data;
    },
    enabled: !!clientId && !!session?.user,
  });

  const { data: clientChats, isLoading: isLoadingChats } = useQuery({
    queryKey: ['clientChats', clientId, session?.user?.id],
    queryFn: async () => {
        if (!clientId || !session?.user) return [];
        const { data, error } = await supabase.rpc('get_client_chats', { p_user_id: session.user.id, p_client_id: clientId });
        if (error) throw error;
        return data;
    },
    enabled: !!clientId && !!session?.user,
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
      queryClient.invalidateQueries({ queryKey: ['clientDashboardStats', clientId] });
      setIsModalOpen(false);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to create project: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const breadcrumbs = [
    { label: "Clients", href: "/clients" },
    { label: client?.name || "..." },
  ];

  if (isLoadingClient) {
    return <div className="p-8"><Skeleton className="h-12 w-1/3" /></div>;
  }

  if (error) {
    return <div className="p-8"><Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert></div>;
  }

  return (
    <>
      <div className="p-4 md:p-8 h-screen flex flex-col bg-gray-50/50 dark:bg-background">
        <header className="pb-4 mb-4 border-b shrink-0">
          <Breadcrumbs items={breadcrumbs} />
          <div className="mt-4 flex justify-between items-center">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-muted rounded-lg">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">{client?.name}</h1>
                <p className="text-muted-foreground">Client Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => setIsModalOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                {t('newProject')}
              </Button>
            </div>
          </div>
        </header>
        
        <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
          <TabsList>
            <TabsTrigger value="overview">{t('overview')}</TabsTrigger>
            <TabsTrigger value="projects">{t('projectsTitle')}</TabsTrigger>
            <TabsTrigger value="gallery">{t('gallery')}</TabsTrigger>
            <TabsTrigger value="chats">{t('chats')}</TabsTrigger>
            <TabsTrigger value="models">{t('models')}</TabsTrigger>
            <TabsTrigger value="garments">{t('garments')}</TabsTrigger>
            <TabsTrigger value="vto">{t('vtoResults')}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex-1 overflow-y-auto mt-4">
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard title="Total Projects" value={stats?.project_count ?? 0} icon={<Folder className="h-6 w-6 text-muted-foreground" />} />
                <StatCard title="Client Models" value={stats?.client_total_models ?? 0} icon={<Bot className="h-6 w-6 text-muted-foreground" />} />
                <StatCard title="Client Garments" value={stats?.client_total_garments ?? 0} icon={<Shirt className="h-6 w-6 text-muted-foreground" />} />
                <StatCard title="VTO Jobs" value={stats?.client_vto_job_count ?? 0} icon={<FolderGit2 className="h-6 w-6 text-muted-foreground" />} />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <Card>
                    <CardHeader><CardTitle>{t('recentProjects')}</CardTitle></CardHeader>
                    <CardContent>
                      {isLoadingRecentProjects ? <Skeleton className="h-48 w-full" /> : recentProjects && recentProjects.length > 0 ? (
                        <div className="space-y-2">
                          {recentProjects.map((p: any) => <RecentProjectItem key={p.project_id} project={p} />)}
                        </div>
                      ) : <p className="text-sm text-muted-foreground text-center py-4">{t('noRecentProjects')}</p>}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader><CardTitle>{t('recentActivity')}</CardTitle></CardHeader>
                    <CardContent>
                      <ClientActivityFeed clientId={clientId!} />
                    </CardContent>
                  </Card>
                </div>
                <div className="lg:col-span-1 space-y-6">
                  <Card>
                    <CardHeader><CardTitle>{t('latestAssets')}</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <h3 className="text-sm font-semibold mb-2">{t('models')}</h3>
                        {isLoadingModels ? <Skeleton className="h-32 w-full" /> : clientModels && clientModels.length > 0 ? (
                          <Carousel opts={{ align: "start" }} className="relative"><CarouselContent className="-ml-2">{clientModels.map((model: any) => <CarouselItem key={model.model_id} className="pl-2 basis-1/2"><ClientModelCard model={model} /></CarouselItem>)}</CarouselContent><CarouselPrevious className="absolute -left-4 top-1/2 -translate-y-1/2" /><CarouselNext className="absolute -right-4 top-1/2 -translate-y-1/2" /></Carousel>
                        ) : <p className="text-xs text-muted-foreground">{t('noAssets')}</p>}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold mb-2">{t('garments')}</h3>
                        {isLoadingGarments ? <Skeleton className="h-32 w-full" /> : clientGarments && clientGarments.length > 0 ? (
                          <Carousel opts={{ align: "start" }} className="relative"><CarouselContent className="-ml-2">{clientGarments.map((garment: any) => <CarouselItem key={garment.garment_id} className="pl-2 basis-1/2"><ClientGarmentCard garment={garment} /></CarouselItem>)}</CarouselContent><CarouselPrevious className="absolute -left-4 top-1/2 -translate-y-1/2" /><CarouselNext className="absolute -right-4 top-1/2 -translate-y-1/2" /></Carousel>
                        ) : <p className="text-xs text-muted-foreground">{t('noAssets')}</p>}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold mb-2">{t('vtoResults')}</h3>
                        {isLoadingVtoJobs ? <Skeleton className="h-32 w-full" /> : clientVtoJobs && clientVtoJobs.length > 0 ? (
                          <Carousel opts={{ align: "start" }} className="relative"><CarouselContent className="-ml-2">{clientVtoJobs.map((job: any) => <CarouselItem key={job.job_id} className="pl-2 basis-1/2"><ClientVtoCard job={job} /></CarouselItem>)}</CarouselContent><CarouselPrevious className="absolute -left-4 top-1/2 -translate-y-1/2" /><CarouselNext className="absolute -right-4 top-1/2 -translate-y-1/2" /></Carousel>
                        ) : <p className="text-xs text-muted-foreground">{t('noAssets')}</p>}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="projects" className="flex-1 overflow-y-auto mt-4">
            {isLoadingProjects ? <Skeleton className="h-64 w-full" /> : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {allProjects?.map(project => (
                  <ProjectCard key={project.project_id} project={project} />
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="gallery" className="flex-1 overflow-y-auto mt-4">
            {isLoadingGallery ? <Skeleton className="h-64 w-full" /> : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {clientGalleryImages?.map((image: any, index: number) => (
                  <button key={image.public_url} onClick={() => showImage({ images: clientGalleryImages.map((img: any) => ({ url: img.public_url, jobId: img.job_id })), currentIndex: index })} className="aspect-square block">
                    <img src={image.public_url} alt="Gallery image" className="w-full h-full object-cover rounded-md" />
                  </button>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="chats" className="flex-1 overflow-y-auto mt-4">
            {isLoadingChats ? <Skeleton className="h-64 w-full" /> : (
              <div className="space-y-2">
                {clientChats?.map((job: any) => (
                  <Link to={`/chat/${job.id}`} key={job.id} className="block p-2 rounded-md hover:bg-muted border">
                    <p className="font-medium text-sm truncate">{job.original_prompt || "Untitled Chat"}</p>
                    <p className="text-xs text-muted-foreground mt-1">Last updated: {new Date(job.updated_at).toLocaleString()}</p>
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="models" className="flex-1 overflow-y-auto mt-4">
            {isLoadingModels ? <Skeleton className="h-64 w-full" /> : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {clientModels?.map((model: any) => <ClientModelCard key={model.model_id} model={model} />)}
              </div>
            )}
          </TabsContent>
          <TabsContent value="garments" className="flex-1 overflow-y-auto mt-4">
            {isLoadingGarments ? <Skeleton className="h-64 w-full" /> : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {clientGarments?.map((garment: any) => <ClientGarmentCard key={garment.garment_id} garment={garment} />)}
              </div>
            )}
          </TabsContent>
          <TabsContent value="vto" className="flex-1 overflow-y-auto mt-4">
            {isLoadingVtoJobs ? <Skeleton className="h-64 w-full" /> : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {clientVtoJobs?.map((job: any) => <ClientVtoCard key={job.job_id} job={job} />)}
              </div>
            )}
          </TabsContent>
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