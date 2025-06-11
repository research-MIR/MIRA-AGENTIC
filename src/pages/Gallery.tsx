import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError } from "@/utils/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";

interface ImageResult {
  publicUrl: string;
  storagePath: string;
}

interface JobWithImages {
  id: string;
  original_prompt: string;
  created_at: string;
  images: ImageResult[];
}

const Gallery = () => {
  const { supabase, session } = useSession();
  const { showImage } = useImagePreview();
  const [groupedImages, setGroupedImages] = useState<JobWithImages[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'agent' | 'direct'>('all');

  useEffect(() => {
    const fetchImageJobs = async () => {
      if (!session?.user) return;
      setIsLoading(true);
      try {
        let query = supabase
          .from("mira-agent-jobs")
          .select("id, original_prompt, created_at, final_result, context")
          .eq("user_id", session.user.id)
          .in("status", ["complete", "awaiting_feedback"])
          .not("final_result", "is", null);

        if (sourceFilter === 'agent') {
          query = query.or('context->>source.neq.direct_generator,context->>source.is.null');
        } else if (sourceFilter === 'direct') {
          query = query.eq('context->>source', 'direct_generator');
        }

        const { data, error } = await query.order("created_at", { ascending: false });

        if (error) throw error;
        
        const processedJobs = data
          .map((job: any) => {
            let images: ImageResult[] | null = null;
            if (job.final_result?.isImageGeneration) {
              images = job.final_result.images;
            } else if (job.final_result?.isCreativeProcess) {
              const lastIteration = job.context?.history?.filter((t:any) => t.role === 'function' && t.parts[0]?.functionResponse?.name === 'fal_image_to_image').pop();
              if (lastIteration) {
                images = lastIteration.parts[0].functionResponse.response.images;
              } else {
                const lastInitialGen = job.context?.history?.filter((t:any) => t.role === 'function' && ['generate_image', 'generate_image_with_reference'].includes(t.parts[0]?.functionResponse?.name)).pop();
                if (lastInitialGen) {
                    images = lastInitialGen.parts[0].functionResponse.response.images;
                }
              }
            }

            if (images && images.length > 0) {
              return {
                id: job.id,
                original_prompt: job.original_prompt,
                created_at: job.created_at,
                images: images,
              };
            }
            return null;
          })
          .filter((job): job is JobWithImages => job !== null);

        setGroupedImages(processedJobs);
      } catch (err: any) {
        showError("Failed to load gallery: " + err.message);
        console.error("[Gallery] Error loading gallery:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchImageJobs();
  }, [session, supabase, sourceFilter]);

  const GalleryContent = () => {
    if (isLoading) {
      return (
        <div className="space-y-4 mt-8">
          {[...Array(2)].map((_, i) => (
             <Card key={i}>
                <CardHeader>
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-1/4" />
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {[...Array(4)].map((_, j) => (
                        <Skeleton key={j} className="aspect-square w-full" />
                        ))}
                    </div>
                </CardContent>
            </Card>
          ))}
        </div>
      );
    }

    if (groupedImages.length === 0) {
      return (
        <div className="text-center py-16">
            <h2 className="text-2xl font-semibold">No Images Yet</h2>
            <p className="text-muted-foreground mt-2">Generate some images to see them here.</p>
        </div>
      );
    }

    return (
      <div className="space-y-6 mt-8">
        {groupedImages.map((job) => (
          <Card key={job.id}>
            <CardHeader>
                <CardTitle className="text-lg">{job.original_prompt}</CardTitle>
                <CardDescription>{new Date(job.created_at).toLocaleDateString()}</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {job.images.map((image, index) => (
                    <button onClick={() => showImage({ url: image.publicUrl, jobId: job.id })} key={index} className="block w-full h-full rounded-md overflow-hidden focus:ring-2 ring-primary">
                        <img
                            src={image.publicUrl}
                            alt={`Generated image ${index + 1} for ${job.original_prompt}`}
                            className="aspect-square object-cover w-full h-full hover:scale-105 transition-transform duration-200"
                        />
                    </button>
                ))}
                </div>
            </CardContent>
            <CardFooter className="flex justify-end">
                <Button asChild variant="outline" size="sm">
                    <Link to={`/chat/${job.id}`}>
                        <MessageSquare className="h-4 w-4 mr-2" />
                        View Chat
                    </Link>
                </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-4 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Results Gallery</h1>
          <p className="text-muted-foreground">A collection of all your generated images.</p>
        </div>
        <ThemeToggle />
      </header>
      
      <Tabs id="gallery-tabs" value={sourceFilter} onValueChange={(value) => setSourceFilter(value as any)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="direct">Direct</TabsTrigger>
        </TabsList>
      </Tabs>

      <GalleryContent />
    </div>
  );
};

export default Gallery;