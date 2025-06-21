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
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useImagePreview } from "@/context/ImagePreviewContext";
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

const ImageUploader = ({ onFileSelect, title, imageUrl, onClear }: { onFileSelect: (file: File) => void, title: string, imageUrl: string | null, onClear: () => void }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFileSelect(e.dataTransfer.files[0]) });
  
    if (imageUrl) {
      return (
        <div className="relative aspect-square">
          <img src={imageUrl} alt={title} className="w-full h-full object-cover rounded-md" />
          <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6 z-10" onClick={onClear}><X className="h-4 w-4" /></Button>
        </div>
      );
    }
  
    return (
      <div {...dropzoneProps} className={cn("flex aspect-square justify-center items-center rounded-lg border border-dashed p-4 text-center transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        <div className="text-center pointer-events-none"><PlusCircle className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">{title}</p></div>
        <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && onFileSelect(e.target.files[0])} />
      </div>
    );
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
  const [referenceImageFile, setReferenceImageFile] = useState<File | null>(null);
  const [maskImage, setMaskImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [brushSize, setBrushSize] = useState(30);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const sourceImageUrl = useMemo(() => sourceImageFile ? URL.createObjectURL(sourceImageFile) : null, [sourceImageFile]);
  const referenceImageUrl = useMemo(() => referenceImageFile ? URL.createObjectURL(referenceImageFile) : null, [referenceImageFile]);

  useEffect(() => {
    return () => {
      if (sourceImageUrl) URL.revokeObjectURL(sourceImageUrl);
      if (referenceImageUrl) URL.revokeObjectURL(referenceImageUrl);
    };
  }, [sourceImageUrl, referenceImageUrl]);

  useEffect(() => {
    if (selectedJob) {
      setSourceImageFile(null);
      setReferenceImageFile(null);
      setMaskImage(null);
      setPrompt("");
      setResetTrigger(c => c + 1);
      setResultImage(null);
    }
  }, [selectedJob]);

  const proJobs = useMemo(() => recentJobs?.filter(job => job.mode === 'inpaint') || [], [recentJobs]);

  const handleFileSelect = (file: File | null) => {
    if (file && file.type.startsWith("image/")) {
      resetForm();
      setSourceImageFile(file);
      setMaskImage(null);
      setResultImage(null);
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
    const toastId = showLoading("Preparing images for inpainting...");

    try {
      const sourceImg = new Image();
      sourceImg.src = URL.createObjectURL(sourceImageFile);
      await new Promise(resolve => sourceImg.onload = resolve);

      const maskImg = new Image();
      maskImg.src = maskImage;
      await new Promise(resolve => maskImg.onload = resolve);

      const dilatedCanvas = document.createElement('canvas');
      dilatedCanvas.width = maskImg.width;
      dilatedCanvas.height = maskImg.height;
      const dilateCtx = dilatedCanvas.getContext('2d');
      if (!dilateCtx) throw new Error("Could not get canvas context for dilation.");
      
      const dilationAmount = Math.max(10, Math.round(maskImg.width * 0.02));
      dilateCtx.filter = `blur(${dilationAmount}px)`;
      dilateCtx.drawImage(maskImg, 0, 0);
      dilateCtx.filter = 'none';
      
      const dilatedImageData = dilateCtx.getImageData(0, 0, dilatedCanvas.width, dilatedCanvas.height);
      const data = dilatedImageData.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 128) {
          data[i] = data[i+1] = data[i+2] = 255;
        } else {
          data[i] = data[i+1] = data[i+2] = 0;
        }
      }
      dilateCtx.putImageData(dilatedImageData, 0, 0);

      let minX = dilatedCanvas.width, minY = dilatedCanvas.height, maxX = 0, maxY = 0;
      for (let y = 0; y < dilatedCanvas.height; y++) {
        for (let x = 0; x < dilatedCanvas.width; x++) {
          const i = (y * dilatedCanvas.width + x) * 4;
          if (data[i] === 255) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      if (maxX < minX) throw new Error("The mask is empty. Please draw on the image.");

      const padding = Math.round(Math.max(maxX - minX, maxY - minY) * 0.05);
      const bbox = {
        x: Math.max(0, minX - padding),
        y: Math.max(0, minY - padding),
        width: Math.min(sourceImg.width - (minX - padding), (maxX - minX) + padding * 2),
        height: Math.min(sourceImg.height - (minY - padding), (maxY - minY) + padding * 2)
      };

      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = bbox.width;
      croppedCanvas.height = bbox.height;
      const cropCtx = croppedCanvas.getContext('2d');
      if (!cropCtx) throw new Error("Could not get canvas context for cropping.");
      cropCtx.drawImage(sourceImg, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
      const croppedSourceBase64 = croppedCanvas.toDataURL('image/png').split(',')[1];

      const croppedMaskCanvas = document.createElement('canvas');
      croppedMaskCanvas.width = bbox.width;
      croppedMaskCanvas.height = bbox.height;
      const cropMaskCtx = croppedMaskCanvas.getContext('2d');
      if (!cropMaskCtx) throw new Error("Could not get canvas context for mask cropping.");
      cropMaskCtx.drawImage(dilatedCanvas, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
      const croppedDilatedMaskBase64 = croppedMaskCanvas.toDataURL('image/jpeg').split(',')[1];

      dismissToast(toastId);
      showLoading("Sending job to inpainting service...");

      const payload: any = {
        mode: 'inpaint',
        full_source_image_base64: await fileToBase64(sourceImageFile),
        cropped_source_image_base64: croppedSourceBase64,
        cropped_dilated_mask_base64: croppedDilatedMaskBase64,
        prompt,
        bbox,
        user_id: session?.user.id
      };

      if (referenceImageFile) {
        payload.reference_image_base64 = await fileToBase64(referenceImageFile);
      }

      const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
        body: payload
      });

      if (error) throw error;

      dismissToast(toastId);
      showSuccess("Inpainting job started! You can track its progress in the sidebar.");
      queryClient.invalidateQueries({ queryKey: ['activeJobs'] });
      queryClient.invalidateQueries({ queryKey: ['bitstudioJobs', session?.user?.id] });
      resetForm();

    } catch (err: any) {
      dismissToast(toastId);
      showError(`Processing failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const { dropzoneProps, isDraggingOver } = useDropzone({
    onDrop: (e) => handleFileSelect(e.target.files?.[0]),
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
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Style Reference (Optional)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ImageUploader 
              onFileSelect={setReferenceImageFile} 
              title="Upload Reference" 
              imageUrl={referenceImageUrl} 
              onClear={() => setReferenceImageFile(null)} 
            />
          </CardContent>
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