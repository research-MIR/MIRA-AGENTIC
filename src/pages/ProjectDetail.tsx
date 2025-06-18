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
import { useLanguage } from "@/context/LanguageContext";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  const { t } = useLanguage();

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
      console.log(`[ProjectDetail] Fetching jobs for project: ${projectId}`);
      const { data, error } = await supabase.from('mira-agent-jobs').select('id, original_prompt, context, final_result').eq('project_id', projectId).order('created_at', { ascending: false });
      if (error) throw error;
      console.log(`[ProjectDetail] Fetched ${data.length} jobs:`, data);
      return data;
    },
    enabled: !!projectId,
  });

  const projectImages = useMemo((): ImageResult[] => {
    if (!jobs) return [];
    const allImages: ImageResult[] = [];

    for (const job of jobs) {
      // Case 1: Images are directly in the final_result (Direct Generator, simple agent responses)
      if (job.final_result?.isImageGeneration && Array.isArray(job.final_result.images)) {
        for (const image of job.final_result.images) {
          allImages.push({ ...image, jobId: job.id });
        }
      }

      // Case 2: Images are in the final_result of a creative process
      if (job.final_result?.isCreativeProcess && job.final_result.final_generation_result?.response?.images) {
        for (const image of job.final_result.final_generation_result.response.images) {
          allImages.push({ ...image, jobId: job.id });
        }
      }

      // Case 3: Images are buried in the history
      if (job.context?.history) {
        for (const turn of job.context.history) {
          if (turn.role === 'function' && turn.parts[0]?.functionResponse?.response?.isImageGeneration) {
            const imagesInTurn = turn.parts[0].functionResponse.response.images;
            if (Array.isArray(imagesInTurn)) {
              for (const image of imagesInTurn) {
                allImages.push({ ...image, jobId: job.id });
              }
            }
          }
        }
      }
    }
    
    const uniqueImages = Array.from(new Map(allImages.map(item => [item.publicUrl, item])).values());
    console.log(`[ProjectDetail] Extracted ${uniqueImages.length} unique images from jobs.`);
    return uniqueImages;
  }, [jobs]);

  const latestImageUrl = projectImages.length > 0 ? projectImages[0].publicUrl : null;
  const { displayUrl: latestImageDisplayUrl, isLoading: isLoadingLatestImage } = useSecureImage(latestImageUrl);

  if (isLoadingProject || isLoadingJobs) {
    return (
      <div className="p-8 space-y-6">
        <Skeleton className="h-12 w-1/3" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <Skeleton className="h-96 w-full lg:col-span-1" />
          <div className="lg:col-span-2 space-y-6">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>Project not found.</AlertDescription></Alert>;
  }

  return (
    <div className="p-4 md:p-8 h-screen flex flex-col">
      <header className="pb-4 mb-8 border-b shrink-0">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Folder className="h-8 w-8 text-primary" />
          {project.name}
        </h1>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 overflow-hidden">
        <div className="lg:col-span-1 flex flex-col h-full">
          <Card className="flex-1 flex flex-col">
            <CardHeader><CardTitle>{t.projectChatsTitle} ({jobs?.length || 0})</CardTitle></CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="space-y-2 pr-4">
                  {jobs?.map(job => (
                    <Link key={job.id} to={`/chat/${job.id}`} className="block p-2 rounded-md hover:bg-muted">
                      <p className="font-medium truncate">{job.original_prompt || "Untitled Chat"}</p>
                    </Link>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2 flex flex-col gap-8 overflow-hidden">
          <Card>
            <CardHeader>
              <CardTitle>{t.keyVisualTitle}</CardTitle>
              <p className="text-sm text-muted-foreground">{t.keyVisualDescription}</p>
            </CardHeader>
            <CardContent>
              <div className="aspect-square max-h-64 mx-auto bg-muted rounded-lg flex items-center justify-center overflow-hidden">
                {isLoadingLatestImage ? <Skeleton className="w-full h-full" /> : latestImageDisplayUrl ? (
                  <img src={latestImageDisplayUrl} alt="Latest project image" className="w-full h-full object-contain" />
                ) : (
                  <ImageIcon className="h-16 w-16 text-muted-foreground" />
                )}
              </div>
            </CardContent>
          </Card>
          <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader><CardTitle>{t.projectGalleryTitle} ({projectImages.length})</CardTitle></CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pr-4">
                  {projectImages.map((image, index) => (
                    <button key={image.publicUrl} onClick={() => showImage({ images: projectImages.map(img => ({ url: img.publicUrl, jobId: img.jobId })), currentIndex: index })} className="aspect-square block">
                      <img src={image.publicUrl} alt={`Project image ${index + 1}`} className="w-full h-full object-cover rounded-md hover:opacity-80 transition-opacity" />
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ProjectDetail;