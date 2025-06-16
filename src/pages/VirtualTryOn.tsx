import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { UploadCloud, Wand2, Loader2, Image as ImageIcon } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { optimizeImage } from "@/lib/utils";
import { RealtimeChannel } from "@supabase/supabase-js";
import { SegmentationMask } from "@/components/SegmentationMask";

interface MaskItem {
  box_2d: [number, number, number, number];
  label: string;
}

interface SegmentationResult {
  description: string;
  masks: MaskItem[];
}

const ImageUploader = ({ onFileSelect, title, isDraggingOver, t }: { onFileSelect: (file: File) => void, title: string, isDraggingOver: boolean, t: any }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  const { dropzoneProps } = useDropzone({
    onDrop: (files) => {
      if (files && files[0]) {
        onFileSelect(files[0]);
      }
    }
  });

  return (
    <div 
      {...dropzoneProps}
      className={cn("flex justify-center rounded-lg border border-dashed border-border p-6 transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")}
      onClick={() => inputRef.current?.click()}
    >
      <div className="text-center pointer-events-none">
        <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-2 font-semibold">{title}</p>
        <p className="text-xs leading-5 text-muted-foreground">{t.dragAndDrop}</p>
      </div>
      <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
    </div>
  );
};

const VirtualTryOn = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();

  const [personImageFile, setPersonImageFile] = useState<File | null>(null);
  const [garmentImageFile, setGarmentImageFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [segmentationResult, setSegmentationResult] = useState<SegmentationResult | null>(null);
  const [isPersonDragging, setIsPersonDragging] = useState(false);
  const [isGarmentDragging, setIsGarmentDragging] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [personImageDimensions, setPersonImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const personImageUrl = useMemo(() => personImageFile ? URL.createObjectURL(personImageFile) : null, [personImageFile]);
  const garmentImageUrl = useMemo(() => garmentImageFile ? URL.createObjectURL(garmentImageFile) : null, [garmentImageFile]);

  useEffect(() => {
    if (!activeJobId) {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    if (channelRef.current?.topic === `realtime:public:mira-agent-segmentation-jobs:id=eq.${activeJobId}`) {
      return;
    }

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase.channel(`segmentation-job-${activeJobId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mira-agent-segmentation-jobs', filter: `id=eq.${activeJobId}` },
        (payload) => {
          const job = payload.new;
          if (job.status === 'complete') {
            setSegmentationResult(job.result);
            setIsLoading(false);
            showSuccess("Analysis complete!");
            setActiveJobId(null);
          } else if (job.status === 'failed') {
            showError(`Analysis failed: ${job.error_message}`);
            setIsLoading(false);
            setActiveJobId(null);
          }
        }
      )
      .subscribe();
    
    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [activeJobId, supabase]);

  const uploadFileAndGetUrl = async (file: File | null, bucket: string): Promise<string | null> => {
    if (!file) return null;
    if (!session?.user) throw new Error("User session not found.");
    
    const optimizedFile = await optimizeImage(file);

    const filePath = `${session.user.id}/${Date.now()}-${optimizedFile.name}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, optimizedFile);
    if (uploadError) throw new Error(`Failed to upload file: ${uploadError.message}`);
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(filePath);
    return publicUrl;
  };

  const handleSegment = async () => {
    if (!personImageFile || !garmentImageFile) {
      return showError("Please upload both a person and a garment image.");
    }
    setIsLoading(true);
    setSegmentationResult(null);
    const toastId = showLoading("Uploading images and queueing job...");

    try {
      const person_image_url = await uploadFileAndGetUrl(personImageFile, 'mira-agent-user-uploads');
      const garment_image_url = await uploadFileAndGetUrl(garmentImageFile, 'mira-agent-user-uploads');

      if (!person_image_url || !garment_image_url) {
        throw new Error("Failed to upload one or both images.");
      }
      
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-segmentation', {
        body: { 
          person_image_url, 
          garment_image_url, 
          user_prompt: prompt,
          user_id: session?.user.id
        }
      });

      if (error) throw error;

      setActiveJobId(data.jobId);
      dismissToast(toastId);
      showSuccess("Job queued! The result will appear below when ready.");

    } catch (err: any) {
      showError(err.message);
      setIsLoading(false);
      dismissToast(toastId);
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t.virtualTryOn}</h1>
        <p className="text-muted-foreground">Describe where a garment would fit on a person.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Controls */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>1. Upload Images</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ImageUploader onFileSelect={setPersonImageFile} title="Person Image" isDraggingOver={isPersonDragging} t={t} />
              <ImageUploader onFileSelect={setGarmentImageFile} title="Garment Image" isDraggingOver={isGarmentDragging} t={t} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>2. Add Instructions (Optional)</CardTitle></CardHeader>
            <CardContent>
              <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g., 'Focus on how the collar sits.'" />
            </CardContent>
          </Card>
          <Button onClick={handleSegment} disabled={isLoading} className="w-full">
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            Analyze Placement
          </Button>
        </div>

        {/* Results */}
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Results</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="relative">
                  <h3 className="font-semibold text-center mb-2">Person</h3>
                  {personImageUrl ? (
                    <img 
                      src={personImageUrl} 
                      alt="Person" 
                      className="w-full rounded-md" 
                      onLoad={(e) => setPersonImageDimensions({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
                    />
                  ) : <div className="aspect-square bg-muted rounded-md flex items-center justify-center"><ImageIcon className="h-12 w-12 text-muted-foreground" /></div>}
                  {segmentationResult && personImageDimensions && (
                    <SegmentationMask 
                      masks={segmentationResult.masks} 
                      width={personImageDimensions.width} 
                      height={personImageDimensions.height} 
                    />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-center mb-2">Garment</h3>
                  {garmentImageUrl ? <img src={garmentImageUrl} alt="Garment" className="w-full rounded-md" /> : <div className="aspect-square bg-muted rounded-md flex items-center justify-center"><ImageIcon className="h-12 w-12 text-muted-foreground" /></div>}
                </div>
              </div>
              {isLoading && (
                <div className="text-center text-muted-foreground py-4">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto" />
                  <p className="mt-2">Analyzing images... this may take a moment.</p>
                </div>
              )}
              {segmentationResult && (
                <div>
                  <Label>AI Description</Label>
                  <div className="mt-2 p-3 bg-muted rounded-md text-sm">
                    <p>{segmentationResult.description}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default VirtualTryOn;