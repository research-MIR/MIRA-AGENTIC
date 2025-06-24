import { useState, useRef, useCallback } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, UploadCloud, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { showError, showLoading, dismissToast, showSuccess } from '@/utils/toast';
import { useDropzone } from '@/hooks/useDropzone';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { SegmentationMask } from '@/components/SegmentationMask';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from '@/components/ui/label';

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

const newDefaultPrompt = `You are an expert image analyst specializing in fashion segmentation. Your task is to find an object in a SOURCE image that is visually similar to an object in a REFERENCE image and create a highly precise segmentation mask for it.

### Core Rules:
1.  **Identify the Reference:** Look at the REFERENCE image to understand the target object's category and appearance (e.g., "a t-shirt", "a pair of jeans", "a blazer").
2.  **Find in Source:** Locate the corresponding object in the SOURCE image.
3.  **Precision is Paramount:** Create a precise segmentation mask for the object you found in the SOURCE image.
4.  **No Overlap Rule:** The mask MUST NOT cover other garments or parts of the body that are not part of the target object. For example, if segmenting a jacket, do not let the mask bleed onto the skin of the chest or a shirt underneath.
5.  **Under-covering is Preferable:** It is better for the mask to be slightly smaller and miss a few pixels of the target object than for it to be too large and cover adjacent areas. Prioritize clean edges.

### Few-Shot Examples:

**Example 1: Blazer over bare chest**
*   **SOURCE IMAGE:** A photo of a man wearing a brown blazer over his bare chest.
*   **REFERENCE IMAGE:** A photo of a brown blazer.
*   **Your Logic:** The reference is a blazer. The man in the source image is wearing a similar blazer. I will create a mask that follows the exact outline of the blazer, carefully avoiding the skin on his chest and neck.
*   **Output:** A single, precise segmentation mask for "the brown jacket/blazer".

**Example 2: Pants**
*   **SOURCE IMAGE:** A photo of a person wearing a white shirt and blue jeans.
*   **REFERENCE IMAGE:** A photo of blue jeans.
*   **Your Logic:** The reference is blue jeans. The person in the source image is wearing blue jeans. I will create a mask that covers only the jeans, stopping precisely at the waistline and not overlapping with the white shirt.
*   **Output:** A single, precise segmentation mask for "the blue jeans".

**Example 3: T-shirt**
*   **SOURCE IMAGE:** A photo of a person wearing a red t-shirt.
*   **REFERENCE IMAGE:** A photo of a red t-shirt.
*   **Your Logic:** The reference is a t-shirt. The person in the source image is wearing a matching t-shirt. I will create a mask for the t-shirt, carefully following the neckline and sleeves to avoid masking the skin.
*   **Output:** A single, precise segmentation mask for "the red t-shirt".

### Output Format:
Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label".`;

const SegmentationTool = () => {
  const { supabase } = useSession();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [referencePreview, setReferencePreview] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{width: number, height: number} | null>(null);
  const [prompt, setPrompt] = useState(newDefaultPrompt);
  const [masks, setMasks] = useState<MaskItemData[][] | null>(null);
  const [rawResponse, setRawResponse] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const referenceFileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((file: File | null, type: 'source' | 'reference') => {
    if (file && file.type.startsWith('image/')) {
      console.log(`[SegmentationTool] ${type} file selected: ${file.name}`);
      if (type === 'source') {
        setSourceFile(file);
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
              setImageDimensions({ width: img.width, height: img.height });
              setSourcePreview(e.target?.result as string);
          };
          img.src = e.target?.result as string;
        };
        reader.readAsDataURL(file);
      } else {
        setReferenceFile(file);
        setReferencePreview(URL.createObjectURL(file));
      }
    }
  }, []);

  const { dropzoneProps: sourceDropzoneProps, isDraggingOver: isDraggingOverSource } = useDropzone({
    onDrop: (e) => handleFileSelect(e.dataTransfer.files?.[0], 'source'),
  });

  const { dropzoneProps: referenceDropzoneProps, isDraggingOver: isDraggingOverReference } = useDropzone({
    onDrop: (e) => handleFileSelect(e.dataTransfer.files?.[0], 'reference'),
  });

  const handleSegment = async () => {
    if (!sourceFile) {
      showError("Please upload a source image first.");
      return;
    }
    console.log("[SegmentationTool] Starting segmentation process...");
    setIsLoading(true);
    setError(null);
    setMasks(null);
    setRawResponse('');
    const toastId = showLoading("Segmenting image (3 runs)...");

    try {
      const sourceBase64 = await fileToBase64(sourceFile);
      const referenceBase64 = referenceFile ? await fileToBase64(referenceFile) : null;

      const createPayload = () => ({
        image_base64: sourceBase64,
        mime_type: sourceFile.type,
        prompt,
        reference_image_base64: referenceBase64,
        reference_mime_type: referenceFile?.type,
      });

      // Create three parallel promises
      const promises = [
        supabase.functions.invoke('MIRA-AGENT-tool-segment-image', { body: createPayload() }),
        supabase.functions.invoke('MIRA-AGENT-tool-segment-image', { body: createPayload() }),
        supabase.functions.invoke('MIRA-AGENT-tool-segment-image', { body: createPayload() }),
      ];

      const results = await Promise.all(promises);

      const allMasks: MaskItemData[][] = [];
      let combinedRawResponse: Record<string, any> = {};
      
      results.forEach((result, index) => {
        if (result.error) {
          throw new Error(`Run ${index + 1} failed: ${result.error.message}`);
        }
        const maskData = result.data.masks || result.data;
        if (!Array.isArray(maskData)) {
          throw new Error(`Run ${index + 1} did not return a valid array of masks.`);
        }
        allMasks.push(maskData);
        combinedRawResponse[`run_${index + 1}`] = result.data;
      });

      setMasks(allMasks);
      setRawResponse(JSON.stringify(combinedRawResponse, null, 2));
      dismissToast(toastId);
      showSuccess(`Segmentation complete. Found masks across ${allMasks.length} runs.`);

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
            <CardHeader><CardTitle>1. Upload Images</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Source Image</Label>
                <div {...sourceDropzoneProps} onClick={() => sourceFileInputRef.current?.click()} className={cn("mt-1 p-4 border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-primary transition-colors", isDraggingOverSource && "border-primary bg-primary/10")}>
                  {sourcePreview ? <img src={sourcePreview} alt="Source preview" className="max-h-32 mx-auto rounded-md" /> : <><UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-xs font-medium">Click or drag source image</p></>}
                  <Input ref={sourceFileInputRef} type="file" className="hidden" accept="image/*" onChange={(e) => handleFileSelect(e.target.files?.[0] || null, 'source')} />
                </div>
              </div>
              <div>
                <Label>Reference Image (Optional)</Label>
                <div {...referenceDropzoneProps} onClick={() => referenceFileInputRef.current?.click()} className={cn("mt-1 p-4 border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-primary transition-colors", isDraggingOverReference && "border-primary bg-primary/10")}>
                  {referencePreview ? <img src={referencePreview} alt="Reference preview" className="max-h-32 mx-auto rounded-md" /> : <><UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-xs font-medium">Click or drag reference image</p></>}
                  <Input ref={referenceFileInputRef} type="file" className="hidden" accept="image/*" onChange={(e) => handleFileSelect(e.target.files?.[0] || null, 'reference')} />
                </div>
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