import { useState, useMemo, Fragment } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Image as ImageIcon, Bot, Wand2, Code, CheckCircle, Plus, Folder, MoreVertical, X, Download, Loader2 } from "lucide-react";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import JSZip from 'jszip';

interface ImageResult {
  url: string;
  jobId: string;
  source: string;
}

interface Job {
  id: string;
  final_result: any;
  context: any;
  original_prompt: string;
  project_id: string | null;
}

interface Project {
  id: string;
  name: string;
}

const PAGE_SIZE = 30; // Load 30 jobs at a time

const Gallery = () => {
  const { supabase, session } = useSession();
  const { showImage } = useImagePreview();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const { 
    data, 
    error, 
    fetchNextPage, 
    hasNextPage, 
    isFetching, 
    isFetchingNextPage 
  } = useInfiniteQuery<Job[]>({
    queryKey: ['galleryJobs', session?.user?.id],
    queryFn: async ({ pageParam }) => {
      if (!session?.user) return [];
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      
      const { data, error } = await supabase
        .from('mira-agent-jobs')
        .select('id, final_result, context, original_prompt, project_id')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .range(from, to);
        
      if (error) throw error;
      return data || []; // Ensure we always return an array
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // If the last page has fewer items than PAGE_SIZE, it's the last page.
      if (!lastPage || lastPage.length < PAGE_SIZE) {
        return undefined;
      }
      // Otherwise, the next page number is the current number of pages.
      return allPages.length;
    },
    enabled: !!session?.user,
  });

  const jobs = useMemo(() => data?.pages.flatMap(page => page) ?? [], [data]);

  const { data: projects } = useQuery<Project[]>({
    queryKey: ['projects', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('projects').select('id, name').eq('user_id', session.user.id);
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
    return Array.from(new Map(images.map(item => [item.url, item])).values());
  }, [jobs]);

  const toggleSelection = (imageUrl: string) => {
    setSelectedImages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(imageUrl)) {
        newSet.delete(imageUrl);
      } else {
        newSet.add(imageUrl);
      }
      return newSet;
    });
  };

  const handleBulkUpscale = async (factor: number) => {
    const toastId = showLoading(`Queuing ${selectedImages.size} images for x${factor} upscale...`);
    const promises = Array.from(selectedImages).map(async (url) => {
      try {
        const imageResponse = await fetch(url);
        if (!imageResponse.ok) throw new Error(`Failed to fetch image for analysis: ${url}`);
        const imageBlob = await imageResponse.blob();
        const reader = new FileReader();
        reader.readAsDataURL(imageBlob);
        const base64String = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
        });
        const base64Data = base64String.split(',')[1];

        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-auto-describe-image', { 
          body: { base64_image_data: base64Data, mime_type: imageBlob.type } 
        });
        if (error) throw error;
        const autoPrompt = data.auto_prompt;
        const { error: queueError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
          body: {
            prompt_text: autoPrompt,
            image_url: url,
            invoker_user_id: session?.user?.id,
            upscale_factor: factor,
            original_prompt_for_gallery: `Upscaled from gallery`,
            source: 'refiner'
          }
        });
        if (queueError) throw queueError;
      } catch (err) {
        console.error(`Failed to queue upscale for ${url}:`, err);
        // Don't rethrow, let other jobs succeed
      }
    });
    await Promise.all(promises);
    dismissToast(toastId);
    showSuccess(`${selectedImages.size} images sent for upscaling.`);
    queryClient.invalidateQueries({ queryKey: ['activeComfyJobs'] });
    setIsSelectMode(false);
    setSelectedImages(new Set());
  };

  const handleBulkAddToProject = async () => {
    if (!targetProjectId) return showError("Please select a project.");
    const toastId = showLoading(`Adding ${selectedImages.size} images to project...`);
    
    const jobIdsToUpdate = new Set<string>();
    selectedImages.forEach(url => {
      const img = allImages.find(i => i.url === url);
      if (img) jobIdsToUpdate.add(img.jobId);
    });

    const promises = Array.from(jobIdsToUpdate).map(jobId => 
      supabase.from('mira-agent-jobs').update({ project_id: targetProjectId }).eq('id', jobId)
    );

    const results = await Promise.allSettled(promises);
    const failedCount = results.filter(r => r.status === 'rejected').length;

    dismissToast(toastId);
    if (failedCount > 0) {
      showError(`Failed to add ${failedCount} jobs to the project.`);
    } else {
      showSuccess(`Successfully added images from ${jobIdsToUpdate.size} jobs to the project.`);
    }
    
    queryClient.invalidateQueries({ queryKey: ['galleryJobs'] });
    queryClient.invalidateQueries({ queryKey: ['projectPreviews'] });
    setIsProjectModalOpen(false);
    setIsSelectMode(false);
    setSelectedImages(new Set());
  };

  const handleBulkDownload = async () => {
    if (selectedImages.size === 0) return;
    setIsDownloading(true);
    const toastId = showLoading(`Preparing ${selectedImages.size} images for download...`);
    
    try {
      const zip = new JSZip();
      const imagePromises = Array.from(selectedImages).map(async (url) => {
        try {
          const response = await fetch(url);
          if (!response.ok) return null;
          const blob = await response.blob();
          const filename = url.split('/').pop() || 'image.png';
          zip.file(filename, blob);
        } catch (e) {
          console.error(`Failed to fetch ${url}`, e);
        }
      });

      await Promise.all(imagePromises);

      dismissToast(toastId);
      showLoading("Zipping files...");

      const content = await zip.generateAsync({ type: "blob" });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `mira-gallery-export-${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      dismissToast(toastId);
      showSuccess("Download started!");
      setIsSelectMode(false);
      setSelectedImages(new Set());

    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to create zip file: ${err.message}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const renderImageGrid = (images: ImageResult[]) => {
    if (images.length === 0 && !isFetching) {
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
        {images.map((image, index) => {
          const isSelected = selectedImages.has(image.url);
          return (
            <div
              key={image.url}
              className="group relative aspect-square cursor-pointer"
              onClick={() => isSelectMode ? toggleSelection(image.url) : showImage({ images, currentIndex: index })}
            >
              <img src={image.url} alt={`Generated image ${index + 1}`} className={cn("w-full h-full object-cover rounded-md transition-transform", isSelectMode && "group-hover:scale-95")} />
              {isSelectMode && (
                <div className={cn("absolute inset-0 rounded-md flex items-center justify-center transition-all", isSelected ? "bg-primary/60" : "bg-black/50 opacity-0 group-hover:opacity-100")}>
                  {isSelected && <CheckCircle className="h-10 w-10 text-white" />}
                </div>
              )}
              {!isSelectMode && (
                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-b-md">
                  <Button size="sm" variant="secondary" className="w-full" onClick={(e) => { e.stopPropagation(); navigate(`/chat/${image.jobId}`); }}>{t('viewChat')}</Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">{t('resultsGallery')}</h1>
            <p className="text-muted-foreground">{t('galleryDescription')}</p>
          </div>
          <Button variant={isSelectMode ? "secondary" : "outline"} onClick={() => { setIsSelectMode(!isSelectMode); setSelectedImages(new Set()); }}>
            {isSelectMode ? t('cancel') : "Select"}
          </Button>
        </header>
        
        {isFetching && !isFetchingNextPage ? (
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
            <TabsContent value="agent">{renderImageGrid(allImages.filter(img => img.source === 'agent' || img.source === 'agent_branch'))}</TabsContent>
            <TabsContent value="direct">{renderImageGrid(allImages.filter(img => img.source === 'direct_generator'))}</TabsContent>
            <TabsContent value="refined">{renderImageGrid(allImages.filter(img => img.source === 'refiner'))}</TabsContent>
          </Tabs>
        )}
        
        <div className="flex justify-center mt-8">
          {hasNextPage && (
            <Button onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
              {isFetchingNextPage ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading more...</> : 'Load More'}
            </Button>
          )}
        </div>
      </div>

      {isSelectMode && selectedImages.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-auto bg-background border rounded-lg shadow-2xl p-2 flex items-center gap-4 z-50">
          <p className="text-sm font-medium px-2">{selectedImages.size} selected</p>
          <Button variant="outline" onClick={() => setIsProjectModalOpen(true)}><Folder className="mr-2 h-4 w-4" />Add to Project</Button>
          <Button variant="outline" onClick={handleBulkDownload} disabled={isDownloading}>
            {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download as ZIP
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button><Wand2 className="mr-2 h-4 w-4" />Upscale</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => handleBulkUpscale(1.5)}>Upscale x1.5</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleBulkUpscale(2.0)}>Upscale x2.0</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleBulkUpscale(2.5)}>Upscale x2.5</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" onClick={() => setSelectedImages(new Set())}>Clear</Button>
        </div>
      )}

      <Dialog open={isProjectModalOpen} onOpenChange={setIsProjectModalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add to Project</DialogTitle></DialogHeader>
          <div className="py-4">
            <Label htmlFor="project-select">Select a project</Label>
            <Select onValueChange={setTargetProjectId}>
              <SelectTrigger><SelectValue placeholder="Choose a project..." /></SelectTrigger>
              <SelectContent>
                {projects?.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsProjectModalOpen(false)}>Cancel</Button>
            <Button onClick={handleBulkAddToProject} disabled={!targetProjectId}>Add to Project</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Gallery;