import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Image as ImageIcon, Bot, Wand2, Code } from "lucide-react";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface ImageResult {
  url: string;
  jobId: string;
  source: string;
}

interface Job {
  id: string;
  final_result: any;
  context: any;
}

const Gallery = () => {
  const { supabase, session } = useSession();
  const { showImage } = useImagePreview();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const { data: jobs, isLoading, error } = useQuery<Job[]>({
    queryKey: ['galleryJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-jobs').select('id, final_result, context').eq('user_id', session.user.id).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const allImages = useMemo((): ImageResult[] => {
    if (!jobs) return [];
    const images: ImageResult[] = [];
    for (const job of jobs) {
      const source = job.context?.source || 'agent';
      const jobImages = (job.final_result?.images || job.final_result?.final_generation_result?.response?.images || []);
      for (const img of jobImages) {
        if (img.publicUrl) images.push({ url: img.publicUrl, jobId: job.id, source });
      }
      if (job.context?.history) {
        for (const turn of job.context.history) {
          if (turn.role === 'function' && turn.parts[0]?.functionResponse?.response?.isImageGeneration) {
            const imagesInTurn = turn.parts[0].functionResponse.response.images;
            if (Array.isArray(imagesInTurn)) {
              for (const image of imagesInTurn) {
                if (!images.some(existing => existing.url === image.publicUrl)) {
                  images.push({ url: image.publicUrl, jobId: job.id, source });
                }
              }
            }
          }
        }
      }
    }
    console.log('[Gallery.tsx] Computed allImages:', images);
    return Array.from(new Map(images.map(item => [item.url, item])).values());
  }, [jobs]);

  const agentImages = useMemo(() => allImages.filter(img => img.source === 'agent' || img.source === 'agent_branch'), [allImages]);
  const directImages = useMemo(() => allImages.filter(img => img.source === 'direct_generator'), [allImages]);
  const refinedImages = useMemo(() => allImages.filter(img => img.source === 'refiner'), [allImages]);

  const renderImageGrid = (images: ImageResult[]) => {
    if (images.length === 0) {
      return (
        <div className="text-center py-16">
          <ImageIcon className="mx-auto h-16 w-16 text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">{t('noImagesYet')}</h2>
          <p className="mt-2 text-muted-foreground">{t('noImagesDescription')}</p>
        </div>
      );
    }
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {images.map((image, index) => (
          <div key={image.url} className="group relative aspect-square">
            <button onClick={() => {
              console.log(`[Gallery.tsx] Image clicked. Index: ${index}, URL: ${image.url}`);
              showImage({ images, currentIndex: index })
            }} className="w-full h-full">
              <img src={image.url} alt={`Generated image ${index + 1}`} className="w-full h-full object-cover rounded-md" />
            </button>
            <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-b-md">
              <Button size="sm" variant="secondary" className="w-full" onClick={() => navigate(`/chat/${image.jobId}`)}>{t('viewChat')}</Button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('resultsGallery')}</h1>
        <p className="text-muted-foreground">{t('galleryDescription')}</p>
      </header>
      
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {[...Array(12)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)}
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : (
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-4">
            <TabsTrigger value="all"><ImageIcon className="mr-2 h-4 w-4" />{t('galleryTabsAll')}</TabsTrigger>
            <TabsTrigger value="agent"><Bot className="mr-2 h-4 w-4" />{t('galleryTabsAgent')}</TabsTrigger>
            <TabsTrigger value="direct"><Code className="mr-2 h-4 w-4" />{t('galleryTabsDirect')}</TabsTrigger>
            <TabsTrigger value="refined"><Wand2 className="mr-2 h-4 w-4" />{t('galleryTabsRefined')}</TabsTrigger>
          </TabsList>
          <TabsContent value="all">{renderImageGrid(allImages)}</TabsContent>
          <TabsContent value="agent">{renderImageGrid(agentImages)}</TabsContent>
          <TabsContent value="direct">{renderImageGrid(directImages)}</TabsContent>
          <TabsContent value="refined">{renderImageGrid(refinedImages)}</TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default Gallery;