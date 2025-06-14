import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ImageOff, View } from "lucide-react";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useLanguage } from "@/context/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useMemo } from "react";

interface ImageResult {
  publicUrl: string;
  storagePath: string;
}

interface Job {
  id: string;
  final_result: {
    isImageGeneration: boolean;
    isCreativeProcess?: boolean;
    images: ImageResult[];
  };
  context: {
    source: 'direct_generator' | 'agent' | 'refiner';
    history?: any[];
  };
}

const Gallery = () => {
  const { supabase, session } = useSession();
  const { showImage } = useImagePreview();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const fetchGeneratedImages = async () => {
    if (!session?.user) return [];
    console.log("[Gallery] Fetching jobs from Supabase...");
    const { data, error } = await supabase
      .from("mira-agent-jobs")
      .select("id, final_result, context")
      .eq("user_id", session.user.id)
      .eq("status", "complete")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    console.log(`[Gallery] Fetched ${data.length} raw jobs from DB.`, data);

    const processedJobs = data
      .map((job: any) => {
        console.log(`[Gallery] Processing job ID: ${job.id}`, job);
        // For any job with a history, check for image generation artifacts.
        // This covers both simple agent generations and complex creative processes.
        if (job.context?.history) {
          const history = job.context.history;
          const lastImageTurn = [...history].reverse().find(turn => 
            turn.role === 'function' && 
            (turn.parts[0]?.functionResponse?.name === 'generate_image' || 
             turn.parts[0]?.functionResponse?.name === 'generate_image_with_reference' ||
             turn.parts[0]?.functionResponse?.name === 'fal_image_to_image') &&
            turn.parts[0]?.functionResponse?.response?.images
          );

          if (lastImageTurn) {
            console.log(`[Gallery] Found image turn in history for job ${job.id}.`, lastImageTurn);
            // Overwrite final_result to standardize it for the gallery
            job.final_result = {
                isImageGeneration: true,
                images: lastImageTurn.parts[0].functionResponse.response.images
            };
            // Ensure agent jobs are categorized correctly if source is missing
            if (!job.context.source) {
                console.log(`[Gallery] Job ${job.id} missing source, defaulting to 'agent'.`);
                job.context.source = 'agent';
            }
          } else {
            console.log(`[Gallery] No image turn found in history for job ${job.id}.`);
          }
        }
        // Jobs from direct generator or refiner should already have the correct final_result structure.
        return job;
      })
      .filter(job => {
        const hasImages = job.final_result?.isImageGeneration && Array.isArray(job.final_result.images) && job.final_result.images.length > 0;
        if (!hasImages) {
            console.log(`[Gallery] Filtering out job ${job.id} because it has no valid images in final_result.`, job.final_result);
        }
        return hasImages;
      });
    
    console.log(`[Gallery] Finished processing. ${processedJobs.length} jobs have images to display.`, processedJobs);
    return processedJobs;
  };

  const { data: jobs, isLoading, error } = useQuery<Job[]>({
    queryKey: ["generatedImages", session?.user?.id],
    queryFn: fetchGeneratedImages,
    enabled: !!session?.user,
  });

  const { agentJobs, directJobs, refinedJobs } = useMemo(() => {
    if (!jobs) {
      return { agentJobs: [], directJobs: [], refinedJobs: [] };
    }
    
    const direct = jobs.filter(job => job.context?.source === 'direct_generator');
    const agent = jobs.filter(job => job.context?.source === 'agent');
    const refined = jobs.filter(job => job.context?.source === 'refiner');

    return { agentJobs: agent, directJobs: direct, refinedJobs: refined };
  }, [jobs]);

  const renderImageList = (jobList: Job[] | undefined) => {
    if (!jobList || jobList.length === 0) {
      return (
        <div className="text-center text-muted-foreground col-span-full mt-8">
          <p>{t.noImagesYet}</p>
        </div>
      );
    }

    const allImagesInList = jobList.flatMap(job => 
        job.final_result.images.map(image => ({
            ...image,
            jobId: job.id,
            source: job.context?.source
        }))
    );

    return allImagesInList.map((image, index) => (
        <div key={`${image.jobId}-${index}`} className="relative group aspect-square">
          <img
            src={image.publicUrl}
            alt={`Generated by job ${image.jobId}`}
            className="w-full h-full object-cover rounded-lg cursor-pointer"
            onClick={() => showImage({ 
                images: allImagesInList.map(img => ({ url: img.publicUrl, jobId: img.jobId })),
                currentIndex: index 
            })}
          />
          {image.source === 'agent' && (
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Button variant="secondary" onClick={() => navigate(`/chat/${image.jobId}`)}>
                <View className="mr-2 h-4 w-4" /> {t.viewChat}
              </Button>
            </div>
          )}
        </div>
      )
    );
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t.resultsGallery}</h1>
          <p className="text-muted-foreground">{t.galleryDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            <Tabs defaultValue="all" className="w-full">
              <TabsList>
                <TabsTrigger value="all">{t.galleryTabsAll}</TabsTrigger>
                <TabsTrigger value="agent">{t.galleryTabsAgent}</TabsTrigger>
                <TabsTrigger value="direct">{t.galleryTabsDirect}</TabsTrigger>
                <TabsTrigger value="refined">{t.galleryTabsRefined}</TabsTrigger>
              </TabsList>
              <TabsContent value="all">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-4">
                  {isLoading ? (
                    [...Array(12)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)
                  ) : jobs && jobs.length > 0 ? (
                    renderImageList(jobs)
                  ) : (
                    <div className="col-span-full">
                      <Alert>
                        <ImageOff className="h-4 w-4" />
                        <AlertTitle>{t.noImagesYet}</AlertTitle>
                        <AlertDescription>{t.noImagesDescription}</AlertDescription>
                      </Alert>
                    </div>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="agent">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-4">
                  {isLoading ? (
                    [...Array(6)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)
                  ) : (
                    renderImageList(agentJobs)
                  )}
                </div>
              </TabsContent>
              <TabsContent value="direct">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-4">
                  {isLoading ? (
                    [...Array(6)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)
                  ) : (
                    renderImageList(directJobs)
                  )}
                </div>
              </TabsContent>
              <TabsContent value="refined">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mt-4">
                  {isLoading ? (
                    [...Array(6)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)
                  ) : (
                    renderImageList(refinedJobs)
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error && <Alert variant="destructive">Error loading images: {error.message}</Alert>}
        </CardContent>
      </Card>
    </div>
  );
};

export default Gallery;