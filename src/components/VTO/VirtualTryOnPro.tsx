import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Wand2, Brush, Palette, UploadCloud, Sparkles, Loader2, Image as ImageIcon, X, PlusCircle, AlertTriangle } from "lucide-react";
import { MaskCanvas } from "@/components/Editor/MaskCanvas";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { MaskControls } from "@/components/Editor/MaskControls";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Skeleton } from "../ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

interface BitStudioJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  source_person_image_url: string;
  source_garment_image_url: string;
  final_image_url?: string;
  error_message?: string;
  mode: 'base' | 'inpaint';
}

const SecureImageDisplay = ({ imageUrl, alt, onClick }: { imageUrl: string | null, alt: string, onClick?: (e: React.MouseEvent<HTMLImageElement>) => void }) => {
    const { displayUrl, isLoading, error } = useSecureImage(imageUrl);
    const hasClickHandler = !!onClick;
  
    if (!imageUrl) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
    if (isLoading) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    if (error) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><AlertTriangle className="h-6 w-6 text-destructive" /></div>;
    
    return <img src={displayUrl} alt={alt} className={cn("max-w-full max-h-full object-contain rounded-md", hasClickHandler && "cursor-pointer")} onClick={onClick} />;
};

interface VirtualTryOnProProps {
  recentJobs: BitStudioJob[] | undefined;
  isLoadingRecentJobs: boolean;
  selectedJob: BitStudioJob | undefined;
  handleSelectJob: (job: BitStudioJob) => void;
  resetForm: () => void;
}

export const VirtualTryOnPro = ({ recentJobs, isLoadingRecentJobs, selectedJob, handleSelectJob, resetForm }: VirtualTryOnProProps) => {
  const { supabase, session } = useSession();
  const { showImage } = useImagePreview();
  const queryClient = useQueryClient();
  const [sourceImageFile, setSourceImageFile] = useState<File | null>(null);
  const [maskImage, setMaskImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [brushSize, setBrushSize] = useState(30);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const sourceImageUrl = useMemo(() => 
    sourceImageFile ? URL.createObjectURL(sourceImageFile) : null, 
  [sourceImageFile]);

  useEffect(() => {
    return () => {
      if (sourceImageUrl) URL.revokeObjectURL(sourceImageUrl);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [sourceImageUrl, supabase]);

  useEffect(() => {
    if (selectedJob) {
      setSourceImageFile(null);
      setMaskImage(null);
      setPrompt("");
      setResetTrigger(c => c + 1);
    }
  }, [selectedJob]);

  const proJobs = useMemo(() => recentJobs?.filter(job => job.mode === 'inpaint') || [], [recentJobs]);

  const handleFileSelect = (file: File | null) => {
    if (file && file.type.startsWith("image/")) {
      resetForm();
      setSourceImageFile(file);
      setMaskImage(null);
      setResultImage(null);
      setActiveJobId(null);
      setResetTrigger(c => c + 1);
    }
  };

  const handleResetMask = () => {
    setResetTrigger(c => c + 1);
  };

  const handleGenerate = async () => {
    if (!sourceImageFile || !maskImage || !prompt.trim()) {
      showError("Please provide a source image, a mask, and a prompt.");
      return;
    }
    setIsLoading(true);
    const toastId = showLoading("Starting inpainting job...");
    try {
      const source_image_base64 = await fileToBase64(sourceImageFile);
      const mask_image_base64 = maskImage.split(',')[1];

      const userId = session?.user.id;
      if (!userId) {
        throw new Error("User not authenticated.");
      }

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
        body: { 
          mode: 'inpaint',
          source_image_base64, 
          mask_image_base64, 
          prompt,
          user_id: userId
        }
      });

      if (error) throw error;
      if (!data.success || !data.jobId) throw new Error("Failed to queue inpainting job.");
      
      setActiveJobId(data.jobId);
      dismissToast(toastId);
      showSuccess("Inpainting job started! You can track its progress in the sidebar.");
      
      // Clear the form and refresh recent jobs
      queryClient.invalidateQueries({ queryKey: ['bitstudioJobs', session?.user?.id] });
      setSourceImageFile(null);
      setMaskImage(null);
      setPrompt("");
      setResetTrigger(c => c + 1);

    } catch (err: any) {
      dismissToast(toastId);
      showError(`Inpainting failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!activeJobId) return;

    const channel = supabase
      .channel(`inpaint-job-${activeJobId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'mira-agent-bitstudio-jobs',
        filter: `id=eq.${activeJobId}`
      }, (payload) => {
        const updatedJob = payload.new as any;
        if (updatedJob.status === 'complete' && updatedJob.final_image_url) {
          setResultImage(updatedJob.final_image_url);
          setIsLoading(false);
          setActiveJobId(null);
          channel.unsubscribe();
        } else if (updatedJob.status === 'failed') {
          showError(`Inpainting failed: ${updatedJob.error_message || 'Unknown error'}`);
          setIsLoading(false);
          setActiveJobId(null);
          channel.unsubscribe();
        }
      })
      .subscribe();
    
    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [activeJobId, supabase]);

  const { dropzoneProps, isDraggingOver } = useDropzone({
    onDrop: (e) => handleFileSelect(e.dataTransfer.files?.[0]),
  });

  const renderJobResult = (job: BitStudioJob) => {
    if (job.status === 'failed') return <p className="text-destructive text-sm p-2">Job failed: {job.error_message}</p>;
    if (job.status === 'complete' && job.final_image_url) {
      return <SecureImageDisplay imageUrl={job.final_image_url} alt="Final Result" onClick={() => showImage({ images: [{ url: job.final_image_url! }], currentIndex: 0 })} />;
    }
    return (
      <div className="text-center text-muted-foreground">
        <Loader2 className="h-12 w-12 mx-auto animate-spin" />
        <p className="mt-4">Job status: {job.status}</p>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              Inpainting Prompt
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Label htmlFor="pro-prompt">Describe what to generate in the masked area:</Label>
            <Textarea id="pro-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g., a red silk shirt, a leather jacket with zippers..." rows={4} />
            <Button className="w-full" onClick={handleGenerate} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Generate
            </Button>
          </CardContent>
        </Card>
        <Card>
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="item-1" className="border-b-0">
              <AccordionTrigger className="p-4 hover:no-underline">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Brush className="h-5 w-5" />
                  Mask Preview
                </CardTitle>
              </AccordionTrigger>
              <AccordionContent className="p-4 pt-0">
                {maskImage ? (
                    <div>
                        <img src={maskImage} alt="Generated Mask" className="w-full h-auto rounded-md mt-2 border bg-muted" />
                    </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Draw on the image in the workbench to generate a mask.</div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
      </div>
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>PRO Workbench</CardTitle>
              {selectedJob && <Button variant="outline" size="sm" onClick={resetForm}><PlusCircle className="h-4 w-4 mr-2" />New</Button>}
            </div>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {selectedJob ? (
              renderJobResult(selectedJob)
            ) : sourceImageUrl ? (
              <div className="w-full max-h-[70vh] aspect-square relative">
                <MaskCanvas 
                  imageUrl={sourceImageUrl} 
                  onMaskChange={setMaskImage}
                  brushSize={brushSize}
                  resetTrigger={resetTrigger}
                />
                {resultImage && (
                  <img 
                    src={resultImage} 
                    alt="Inpainting Result" 
                    className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none"
                    onClick={() => showImage({ images: [{ url: resultImage }], currentIndex: 0 })}
                  />
                )}
                {isLoading && !resultImage && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-md">
                    <Loader2 className="h-10 w-10 text-white animate-spin" />
                  </div>
                )}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                  <MaskControls 
                    brushSize={brushSize}
                    onBrushSizeChange={setBrushSize}
                    onReset={handleResetMask}
                  />
                </div>
              </div>
            ) : (
              <div
                {...dropzoneProps}
                className={cn(
                  "h-96 w-full bg-muted rounded-md flex flex-col items-center justify-center cursor-pointer border-2 border-dashed hover:border-primary transition-colors",
                  isDraggingOver && "border-primary bg-primary/10"
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadCloud className="h-12 w-12 text-muted-foreground" />
                <p className="mt-4 font-semibold">Upload an image to start</p>
                <p className="text-sm text-muted-foreground">Drag & drop or click to select a file</p>
                <Input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={(e) => handleFileSelect(e.target.files?.[0])}
                />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent PRO Jobs</CardTitle></CardHeader>
          <CardContent>
            {isLoadingRecentJobs ? <Skeleton className="h-24 w-full" /> : proJobs.length > 0 ? (
              <div className="flex gap-4 overflow-x-auto pb-2">
                {proJobs.map(job => {
                  const urlToPreview = job.final_image_url || job.source_person_image_url;
                  return (
                    <button key={job.id} onClick={() => handleSelectJob(job)} className={cn("border-2 rounded-lg p-1 flex-shrink-0 w-24 h-24", selectedJob?.id === job.id ? "border-primary" : "border-transparent")}>
                      <SecureImageDisplay imageUrl={urlToPreview} alt="Recent job" />
                    </button>
                  )
                })}
              </div>
            ) : <p className="text-muted-foreground text-sm">No recent PRO jobs found.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};