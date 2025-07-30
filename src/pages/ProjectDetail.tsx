import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Folder, MessageSquare, Image as ImageIcon, Plus, Users, Shirt } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/Clients/Breadcrumbs";
import { showError, showSuccess } from "@/utils/toast";
import { ProjectAssetList } from "@/components/Projects/ProjectAssetList";
import { EmptyState } from "@/components/Projects/EmptyState";
import { ProjectImageManagerModal } from "@/components/ProjectImageManagerModal";
import { AddPackModal } from "@/components/Projects/AddPackModal";
import { useDropzone } from "@/hooks/useDropzone";
import { cn } from "@/lib/utils";
import { ManageChatsModal } from "@/components/Projects/ManageChatsModal";
import { AddVtoJobsModal } from "@/components/Projects/AddVtoJobsModal";
import { VtoJobCard } from "@/components/Projects/VtoJobCard";
import { BitStudioJob } from "@/types/vto";
import { ClientVtoGarmentCard } from "@/components/Clients/ClientVtoGarmentCard";
import { ProjectDashboard } from "@/components/Projects/ProjectDashboard";
import { ProjectDeadlines } from "@/components/Projects/ProjectDeadlines";
import { ProjectNotes } from "@/components/Projects/ProjectNotes";
import { ActiveJobsMonitor } from "@/components/Projects/ActiveJobsMonitor";

interface Project {
  id: string;
  name: string;
  sharing_mode: 'private' | 'public_link' | 'restricted';
  client: { id: string; name: string };
}

interface Pack {
  pack_id: string;
  pack_name: string;
  pack_description: string | null;
  total_jobs: number;
  unique_garment_count: number;
  created_at: string;
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

interface ProjectPreview {
  project_id: string;
  project_name: string;
  chat_count: number;
  latest_image_url: string | null;
}

const ProjectDetail = () => {
  const { projectId } = useParams();
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [isImageManagerOpen, setIsImageManagerOpen] = useState(false);
  const [isAddModelPackOpen, setIsAddModelPackOpen] = useState(false);
  const [isAddGarmentPackOpen, setIsAddGarmentPackOpen] = useState(false);
  const [isAddVtoPackOpen, setIsAddVtoPackOpen] = useState(false);
  const [isManageChatsOpen, setIsManageChatsOpen] = useState(false);
  const [isRemovingChat, setIsRemovingChat] = useState<string | null>(null);
  const [isAddVtoJobsOpen, setIsAddVtoJobsOpen] = useState(false);

  const { data: project, isLoading: isLoadingProject } = useQuery<Project>({
    queryKey: ['project', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase.from('mira-agent-projects').select('*, client:mira-agent-clients(id, name)').eq('id', projectId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const { data: jobs, isLoading: isLoadingJobs } = useQuery({
    queryKey: ['projectJobs', projectId],
    queryFn: async () => {
        if (!projectId) return [];
        const { data, error } = await supabase.from('mira-agent-jobs').select('*').eq('project_id', projectId).order('updated_at', { ascending: false });
        if (error) throw error;
        return data;
    },
    enabled: !!projectId,
  });

  const { data: modelPacks, isLoading: isLoadingModelPacks } = useQuery<Pack[]>({
    queryKey: ['projectmodelPacks', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc('get_model_packs_for_project', { p_project_id: projectId });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const { data: garmentPacks, isLoading: isLoadingGarmentPacks } = useQuery<Pack[]>({
    queryKey: ['projectgarmentPacks', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc('get_garment_packs_for_project', { p_project_id: projectId });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const { data: vtoPacks, isLoading: isLoadingVtoPacks } = useQuery<Pack[]>({
    queryKey: ['projectvtoPacks', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc('get_vto_packs_for_project', { p_project_id: projectId });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const { data: vtoJobs, isLoading: isLoadingVtoJobs } = useQuery<BitStudioJob[]>({
    queryKey: ['projectVtoJobs', projectId],
    queryFn: async () => {
        if (!projectId) return [];
        const { data, error } = await supabase.rpc('get_vto_jobs_for_project', { p_project_id: projectId });
        if (error) throw error;
        return data;
    },
    enabled: !!projectId,
  });

  const { data: vtoGarments, isLoading: isLoadingVtoGarments } = useQuery({
    queryKey: ['projectVtoGarments', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.rpc('get_vto_garments_for_project', { p_project_id: projectId });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const galleryImages = useMemo(() => {
    if (!jobs) return [];
    const imagesMap = new Map<string, { jobId: string, createdAt: string }>();

    for (const job of jobs) {
      const processImageArray = (images: any[]) => {
        if (!Array.isArray(images)) return;
        for (const img of images) {
          if (img && typeof img.publicUrl === 'string' && !imagesMap.has(img.publicUrl)) {
            imagesMap.set(img.publicUrl, { jobId: job.id, createdAt: job.created_at });
          }
        }
      };

      processImageArray(job.final_result?.images);
      processImageArray(job.final_result?.final_generation_result?.response?.images);

      if (job.context?.history) {
        for (const turn of job.context.history) {
          if (turn.role === 'function' && turn.parts) {
            for (const part of turn.parts) {
              processImageArray(part.functionResponse?.response?.images);
            }
          }
        }
      }
    }
    
    const sortedImages = Array.from(imagesMap.entries()).map(([url, data]) => ({ url, ...data }));
    sortedImages.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    return sortedImages;
  }, [jobs]);

  const handleSetKeyVisual = async (imageUrl: string) => {
    if (!projectId) return;
    const { error } = await supabase.rpc('set_project_key_visual', { p_project_id: projectId, p_image_url: imageUrl });
    if (error) {
      showError(`Failed to set key visual: ${error.message}`);
    } else {
      showSuccess("Key visual updated.");
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    }
  };

  const handleDropChat = async (e: React.DragEvent<HTMLElement>) => {
    try {
      const jobData = JSON.parse(e.dataTransfer.getData('application/json'));
      if (jobData && jobData.id && projectId) {
        const { error } = await supabase.rpc('update_job_project', { p_job_id: jobData.id, p_project_id: projectId });
        if (error) throw error;
        showSuccess(`Chat "${jobData.original_prompt}" added to project.`);
        queryClient.invalidateQueries({ queryKey: ['projectJobs', projectId] });
        queryClient.invalidateQueries({ queryKey: ['jobHistory'] });
      }
    } catch (err: any) {
      showError(`Failed to add chat: ${err.message}`);
    }
  };

  const handleRemoveChat = async (jobId: string) => {
    if (!session?.user) return;
    setIsRemovingChat(jobId);
    try {
        const { error } = await supabase.rpc('unassign_job_from_project', { p_job_id: jobId, p_user_id: session.user.id });
        if (error) throw error;
        showSuccess("Chat removed from project.");
        queryClient.invalidateQueries({ queryKey: ['projectJobs', projectId] });
        queryClient.invalidateQueries({ queryKey: ['jobHistory'] });
    } catch (err: any) {
        showError(`Failed to remove chat: ${err.message}`);
    } finally {
        setIsRemovingChat(null);
    }
  };

  const handleRemoveVtoJob = async (jobId: string) => {
    if (!session?.user) return;
    try {
        const { error } = await supabase.rpc('unassign_vto_job_from_project', { p_job_id: jobId, p_user_id: session.user.id });
        if (error) throw error;
        showSuccess("VTO job unlinked from project.");
        queryClient.invalidateQueries({ queryKey: ['projectVtoJobs', projectId] });
    } catch (err: any) {
        showError(`Failed to remove job: ${err.message}`);
    }
  };

  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: handleDropChat });

  const isLoading = isLoadingProject || isLoadingJobs;

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-12 w-1/3" /></div>;
  }

  if (!project) {
    return <div className="p-8"><Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>Project not found.</AlertDescription></Alert></div>;
  }

  return (
    <>
      <div className={cn("p-4 md:p-8 h-screen flex flex-col transition-colors", isDraggingOver && "bg-primary/10")} {...dropzoneProps}>
        <header className="pb-4 mb-4 border-b shrink-0">
          <Breadcrumbs items={[
            { label: "Clients", href: "/clients" },
            { label: project.client?.name || "...", href: `/clients/${project.client?.id}` },
            { label: project.name },
          ]} />
          <div className="flex justify-between items-center mt-4">
            <h1 className="text-3xl font-bold">{project.name}</h1>
          </div>
        </header>
        
        <Tabs defaultValue="dashboard" className="flex-1 flex flex-col overflow-hidden">
          <TabsList>
            <TabsTrigger value="dashboard">{t('dashboard')}</TabsTrigger>
            <TabsTrigger value="gallery">{t('gallery')}</TabsTrigger>
            <TabsTrigger value="chats">{t('chats')}</TabsTrigger>
            <TabsTrigger value="models">{t('modelPacks')}</TabsTrigger>
            <TabsTrigger value="garments">{t('garmentPacks')}</TabsTrigger>
            <TabsTrigger value="vto">{t('vtoPacks')}</TabsTrigger>
            <TabsTrigger value="vto_jobs">{t('vtoJobs')}</TabsTrigger>
            <TabsTrigger value="vto_garments">{t('vtoGarments')}</TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard" className="flex-1 overflow-y-auto mt-4">
            <div className="space-y-6">
              <ProjectDashboard projectId={projectId!} />
              <ActiveJobsMonitor projectId={projectId!} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ProjectDeadlines projectId={projectId!} />
                <ProjectNotes projectId={projectId!} />
              </div>
            </div>
          </TabsContent>
          <TabsContent value="gallery" className="flex-1 overflow-y-auto mt-4">
              {galleryImages.length > 0 ? (
                <>
                  <div className="flex justify-end mb-4">
                    <Button onClick={() => setIsImageManagerOpen(true)}><Plus className="mr-2 h-4 w-4" /> Add Images</Button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                      {galleryImages.map(image => (
                          <div key={image.url} className="relative group aspect-square">
                              <img src={image.url} alt="Project image" className="w-full h-full object-cover rounded-md" />
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <Button size="sm" onClick={() => handleSetKeyVisual(image.url)}>Set as Key Visual</Button>
                              </div>
                          </div>
                      ))}
                  </div>
                </>
              ) : (
                <EmptyState 
                  icon={<ImageIcon size={48} />}
                  title="No Images in Project"
                  description="Add images from your gallery or upload new ones to get started."
                  buttonText="Add Images"
                  onButtonClick={() => setIsImageManagerOpen(true)}
                />
              )}
          </TabsContent>
          <TabsContent value="chats" className="flex-1 overflow-y-auto mt-4">
              <div className="flex justify-end mb-4">
                <Button variant="outline" onClick={() => setIsManageChatsOpen(true)}>
                  {t('manageChats')}
                </Button>
              </div>
              <div className="space-y-2">
                  {jobs?.map(job => (
                      <Link to={`/chat/${job.id}`} key={job.id} className="block p-2 rounded-md hover:bg-muted border">
                          <p className="font-medium text-sm truncate">{job.original_prompt || "Untitled Chat"}</p>
                          <p className="text-xs text-muted-foreground mt-1">Last updated: {new Date(job.updated_at).toLocaleString()}</p>
                      </Link>
                  ))}
              </div>
          </TabsContent>
          <TabsContent value="models" className="flex-1 overflow-y-auto mt-4">
            {isLoadingModelPacks ? <Skeleton className="h-64 w-full" /> : modelPacks && modelPacks.length > 0 ? (
              <ProjectAssetList projectId={projectId} packType="model" />
            ) : (
              <EmptyState 
                icon={<Users size={48} />}
                title="No Model Packs"
                description="Link model packs to this project to organize your generated models."
                buttonText="Add Model Pack"
                onButtonClick={() => setIsAddModelPackOpen(true)}
              />
            )}
          </TabsContent>
          <TabsContent value="garments" className="flex-1 overflow-y-auto mt-4">
            {isLoadingGarmentPacks ? <Skeleton className="h-64 w-full" /> : garmentPacks && garmentPacks.length > 0 ? (
              <ProjectAssetList projectId={projectId} packType="garment" />
            ) : (
              <EmptyState 
                icon={<Shirt size={48} />}
                title="No Garment Packs"
                description="Link garment packs to this project to organize your wardrobe items."
                buttonText="Add Garment Pack"
                onButtonClick={() => setIsAddGarmentPackOpen(true)}
              />
            )}
          </TabsContent>
          <TabsContent value="vto" className="flex-1 overflow-y-auto mt-4">
            {isLoadingVtoPacks ? <Skeleton className="h-64 w-full" /> : vtoPacks && vtoPacks.length > 0 ? (
              <ProjectAssetList projectId={projectId} packType="vto" />
            ) : (
              <EmptyState 
                icon={<Shirt size={48} />}
                title="No VTO Packs"
                description="Link VTO packs to this project to organize your virtual try-on jobs."
                buttonText="Add VTO Pack"
                onButtonClick={() => setIsAddVtoPackOpen(true)}
              />
            )}
          </TabsContent>
          <TabsContent value="vto_jobs" className="flex-1 overflow-y-auto mt-4">
            {isLoadingVtoJobs ? <Skeleton className="h-64 w-full" /> : vtoJobs && vtoJobs.length > 0 ? (
                <>
                    <div className="flex justify-end mb-4">
                        <Button onClick={() => setIsAddVtoJobsOpen(true)}><Plus className="mr-2 h-4 w-4" /> {t('addVtoJobs')}</Button>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {vtoJobs.map(job => (
                            <VtoJobCard key={job.id} job={job} onRemove={handleRemoveVtoJob} />
                        ))}
                    </div>
                </>
            ) : (
                <EmptyState 
                    icon={<Shirt size={48} />}
                    title={t('noVtoJobsTitle')}
                    description={t('noVtoJobsDescription')}
                    buttonText={t('addVtoJobs')}
                    onButtonClick={() => setIsAddVtoJobsOpen(true)}
                />
            )}
          </TabsContent>
          <TabsContent value="vto_garments" className="flex-1 overflow-y-auto mt-4">
            {isLoadingVtoGarments ? <Skeleton className="h-64 w-full" /> : vtoGarments && vtoGarments.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {vtoGarments.map((garment: any) => <ClientVtoGarmentCard key={garment.storage_path} garment={garment} />)}
                </div>
            ) : (
                <EmptyState 
                    icon={<Shirt size={48} />}
                    title={t('noVtoGarmentsTitle')}
                    description={t('noVtoGarmentsDescription')}
                    buttonText={t('addVtoJobs')}
                    onButtonClick={() => setIsAddVtoJobsOpen(true)}
                />
            )}
          </TabsContent>
        </Tabs>
      </div>
      <ProjectImageManagerModal isOpen={isImageManagerOpen} onClose={() => setIsImageManagerOpen(false)} project={project} />
      <AddPackModal isOpen={isAddModelPackOpen} onClose={() => setIsAddModelPackOpen(false)} projectId={projectId} packType="model" existingPackIds={modelPacks?.map(p => p.pack_id) || []} />
      <AddPackModal isOpen={isAddGarmentPackOpen} onClose={() => setIsAddGarmentPackOpen(false)} projectId={projectId} packType="garment" existingPackIds={garmentPacks?.map(p => p.pack_id) || []} />
      <AddPackModal isOpen={isAddVtoPackOpen} onClose={() => setIsAddVtoPackOpen(false)} projectId={projectId} packType="vto" existingPackIds={vtoPacks?.map(p => p.pack_id) || []} />
      <ManageChatsModal
        isOpen={isManageChatsOpen}
        onClose={() => setIsManageChatsOpen(false)}
        projectName={project.name}
        jobs={jobs || []}
        onRemoveChat={handleRemoveChat}
        isRemoving={isRemovingChat}
      />
      <AddVtoJobsModal
        isOpen={isAddVtoJobsOpen}
        onClose={() => setIsAddVtoJobsOpen(false)}
        projectId={projectId!}
      />
    </>
  );
};

export default ProjectDetail;