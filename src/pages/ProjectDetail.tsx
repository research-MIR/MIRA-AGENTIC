import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Folder, MessageSquare, Image as ImageIcon } from "lucide-react";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { useSecureImage } from "@/hooks/useSecureImage";
import { useMemo } from "react";

interface Job {
  id: string;
  original_prompt: string;
  context: any;
  final_result: any;
}

interface ImageResult {
  publicUrl: string;
  storagePath: string;
  jobId: string;
}

const ProjectDetail = () => {
  const { projectId } = useParams();
  const { supabase, session } = useSession();
  const { showImage } = useImagePreview();

  const { data: project, isLoading: isLoadingProject } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase.from('projects').select('name').eq('id', projectId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const { data: jobs, isLoading: isLoadingJobs } = useQuery<Job[]>({
    queryKey: ['projectJobs', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.from('mira-agent-jobs').select('id, original_prompt, context, final_result').eq('project_id', projectId).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const projectImages = useMemo((): ImageResult[] => {
    if (!jobs) return [];
    const allImages: ImageResult[] = [];
    for (const job of jobs) {
      const extractImages = (result: any) => {
        if (result?.isImageGeneration && Array.isArray(result.images)) {
          return result.images.map((img: any) => ({ ...img, jobId: job.id }));
        }
        if (result?.isCreativeProcess && result.final_generation_result?.response?.images) {
          return result.final_generation_result.response.images.map((img: any) => ({ ...img, jobId: job.id }));
        }
        return [];
      };
      allImages.push(...extractImages(job.final_result));
    }
    return Array.from(new Map(allImages.map(item => [item.publicUrl, item])).values());
  }, [jobs]);

  const latestImageUrl = projectImages.length > 0 ? projectImages[0].publicUrl : null;
  const { displayUrl: latestImageDisplayUrl, isLoading: isLoadingLatestImage } = useSecureImage(latestImageUrl);

  if (isLoadingProject || isLoadingJobs) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <Skeleton className="h-64 w-full" />
        <div className="grid grid-cols-3 gap-6">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full col-span-2" />
        </div>
      </div>
    );
  }

  if (!project) {
    return <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>Project not found.</AlertDescription></Alert>;
  }

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Folder className="h-8 w-8 text-primary" />
          {project.name}
        </h1>
      </header>

      <Card className="mb-8">
        <CardHeader><CardTitle>Key Visual</CardTitle></CardHeader>
        <CardContent>
          <div className="aspect-video bg-muted rounded-lg flex items-center justify-center overflow-hidden">
            {isLoadingLatestImage ? <Skeleton className="w-full h-full" /> : latestImageDisplayUrl ? (
              <img src={latestImageDisplayUrl} alt="Latest project image" className="w-full h-full object-contain" />
            ) : (
              <ImageIcon className="h-24 w-24 text-muted-foreground" />
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <Card>
            <CardHeader><CardTitle>Chats ({jobs?.length || 0})</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {jobs?.map(job => (
                  <Link key={job.id} to={`/chat/${job.id}`} className="block p-2 rounded-md hover:bg-muted">
                    <p className="font-medium truncate">{job.original_prompt || "Untitled Chat"}</p>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Image Gallery ({projectImages.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-[60vh] overflow-y-auto">
                {projectImages.map((image, index) => (
                  <button key={image.publicUrl} onClick={() => showImage({ images: projectImages, currentIndex: index })} className="aspect-square block">
                    <img src={image.publicUrl} alt={`Project image ${index + 1}`} className="w-full h-full object-cover rounded-md hover:opacity-80 transition-opacity" />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ProjectDetail;