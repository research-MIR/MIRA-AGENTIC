import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft, Folder, MessageSquare, Image as ImageIcon } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Breadcrumbs } from "@/components/Clients/Breadcrumbs";
import { showError, showSuccess } from "@/utils/toast";
import { ProjectAssetList } from "@/components/Projects/ProjectAssetList";

const ProjectDetail = () => {
  const { projectId } = useParams();
  const { supabase } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const { data: project, isLoading: isLoadingProject } = useQuery({
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

  const galleryImages = useMemo(() => {
    if (!jobs) return [];
    const images = new Map<string, { jobId: string, createdAt: string }>();
    for (const job of jobs) {
        const jobImages = (job.final_result?.images || job.final_result?.final_generation_result?.response?.images || []);
        for (const img of jobImages) {
            if (img.publicUrl && !images.has(img.publicUrl)) {
                images.set(img.publicUrl, { jobId: job.id, createdAt: job.created_at });
            }
        }
    }
    return Array.from(images.entries()).map(([url, data]) => ({ url, ...data }));
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

  const isLoading = isLoadingProject || isLoadingJobs;

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-12 w-1/3" /></div>;
  }

  if (!project) {
    return <div className="p-8"><Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>Project not found.</AlertDescription></Alert></div>;
  }

  return (
    <div className="p-4 md:p-8 h-screen flex flex-col">
      <header className="pb-4 mb-4 border-b shrink-0">
        <Breadcrumbs items={[
          { label: "Clients", href: "/clients" },
          { label: project.client?.name || "...", href: `/clients/${project.client?.id}` },
          { label: project.name },
        ]} />
        <div className="flex justify-between items-center mt-4">
          <h1 className="text-3xl font-bold">{project.name}</h1>
          {/* Add actions like rename, delete project here */}
        </div>
      </header>
      
      <Tabs defaultValue="gallery" className="flex-1 flex flex-col overflow-hidden">
        <TabsList>
          <TabsTrigger value="gallery">Gallery</TabsTrigger>
          <TabsTrigger value="chats">Chats</TabsTrigger>
          <TabsTrigger value="models">Model Packs</TabsTrigger>
          <TabsTrigger value="garments">Garment Packs</TabsTrigger>
        </TabsList>
        <TabsContent value="gallery" className="flex-1 overflow-y-auto mt-4">
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
        </TabsContent>
        <TabsContent value="chats" className="flex-1 overflow-y-auto mt-4">
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
            <ProjectAssetList projectId={projectId} packType="model" />
        </TabsContent>
        <TabsContent value="garments" className="flex-1 overflow-y-auto mt-4">
            <ProjectAssetList projectId={projectId} packType="garment" />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ProjectDetail;