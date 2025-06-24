import { useState, useRef, useCallback } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, UploadCloud, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { showError, showLoading, dismissToast } from '@/utils/toast';
import { useDropzone } from '@/hooks/useDropzone';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { SegmentationMask } from '@/components/SegmentationMask';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = (error) => reject(error);
    });
};

interface MaskItemData {
    box_2d: [number, number, number, number];
    label: string;
    mask: string;
}

const SegmentationTool = () => {
  const { supabase } = useSession();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{width: number, height: number} | null>(null);
  const [prompt, setPrompt] = useState('Give the segmentation masks for all clearly visible objects. Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label".');
  const [masks, setMasks] = useState<MaskItemData[] | null>(null);
  const [rawResponse, setRawResponse] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((file: File | null) => {
    if (file && file.type.startsWith('image/')) {
      console.log(`[SegmentationTool] File selected: ${file.name}, size: ${file.size}`);
      setSourceFile(file);
      setMasks(null);
      setRawResponse('');
      setError(null);
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            console.log(`[SegmentationTool] Image loaded. Dimensions: ${img.width}x${img.height}`);
            setImageDimensions({ width: img.width, height: img.height });
            setSourcePreview(e.target?.result as string);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const { dropzoneProps, isDraggingOver } = useDropzone({
    onDrop: (e) => handleFileSelect(e.dataTransfer.files?.[0]),
  });

  const handleSegment = async () => {
    if (!sourceFile) {
      showError("Please upload an image first.");
      return;
    }
    console.log("[SegmentationTool] Starting segmentation process...");
    setIsLoading(true);
    setError(null);
    setMasks(null);
    setRawResponse('');
    const toastId = showLoading("Segmenting image...");

    try {
      const image_base64 = await fileToBase64(sourceFile);
      const payload = {
        image_base64,
        mime_type: sourceFile.type,
        prompt,
      };
      console.log("[SegmentationTool] Invoking Edge Function with payload:", { mime_type: payload.mime_type, prompt: payload.prompt, image_base64: '...' });

      const { data, error: invokeError } = await supabase.functions.invoke('MIRA-AGENT-tool-segment-image', {
        body: payload
      });

      if (invokeError) throw invokeError;
      
      console.log("[SegmentationTool] Received response from Edge Function:", data);
      const maskData = data.masks || data;
      if (!Array.isArray(maskData)) {
        throw new Error("API did not return a valid array of masks.");
      }

      console.log(`[SegmentationTool] Successfully parsed ${maskData.length} masks.`);
      setMasks(maskData);
      setRawResponse(JSON.stringify(data, null, 2));
      dismissToast(toastId);
    } catch (err: any) {
      console.error("[SegmentationTool] Error during segmentation:", err);
      dismissToast(toastId);
      setError(err.message);
      showError(`Segmentation failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 h-full overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">Gemini 2.5 Segmentation Tool</h1>
        <p className="text-muted-foreground">A developer tool to test image segmentation capabilities.</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader><CardTitle>1. Upload Image</CardTitle></CardHeader>
            <CardContent>
              <div {...dropzoneProps} onClick={() => fileInputRef.current?.click()} className={cn("p-4 border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-primary transition-colors", isDraggingOver && "border-primary bg-primary/10")}>
                {sourcePreview ? (
                  <img src={sourcePreview} alt="Source preview" className="max-h-48 mx-auto rounded-md" />
                ) : (
                  <>
                    <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">Click or drag file to upload</p>
                  </>
                )}
                <Input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={(e) => handleFileSelect(e.target.files?.[0] || null)} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>2. Set Prompt</CardTitle></CardHeader>
            <CardContent>
              <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} />
            </CardContent>
          </Card>
          <Button onClick={handleSegment} disabled={isLoading || !sourceFile}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
            Segment Image
          </Button>
        </div>
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>Results</CardTitle></CardHeader>
            <CardContent>
              {isLoading && <div className="flex justify-center p-12"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}
              {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="font-semibold mb-2">Original Image</h3>
                  {sourcePreview ? <img src={sourcePreview} alt="Original" className="rounded-md w-full" /> : <div className="aspect-square bg-muted rounded-md flex items-center justify-center text-muted-foreground">Upload an image</div>}
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Segmented Image</h3>
                  <div className="relative aspect-square bg-muted rounded-md">
                    {sourcePreview && <img src={sourcePreview} alt="Original with overlay" className="rounded-md w-full h-full object-contain" />}
                    {masks && imageDimensions && <SegmentationMask masks={masks} imageDimensions={imageDimensions} />}
                  </div>
                </div>
              </div>

              {rawResponse && (
                <div className="mt-6">
                  <h3 className="font-semibold mb-2">Raw JSON Response</h3>
                  <pre className="bg-muted p-4 rounded-md text-xs overflow-x-auto max-h-96">{rawResponse}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default SegmentationTool;