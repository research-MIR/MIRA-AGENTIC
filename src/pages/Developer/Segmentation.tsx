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

const newDefaultPrompt = `You are an expert fashion AI and virtual stylist. Your primary task is to analyze a PERSON image and a GARMENT image and generate a precise segmentation mask on the PERSON image. This mask represents the area where the garment should be placed, a process we call 'projection masking'.

### Core Rules:
1.  **Analyze the Garment:** First, identify the type of clothing in the GARMENT image (e.g., t-shirt, dress, jacket, pants).
2.  **Project onto Person:** Identify the corresponding body region on the PERSON image where this garment would be worn.
3.  **The Cover-Up Imperative:** This is the most important rule. The generated mask must cover the **entire area** the new garment would occupy. **Crucially, if the person is already wearing clothing in that area, the mask must cover the existing clothing as well.** The goal is to create a clean slate for the new garment. You are masking the *destination area*, not the existing clothes.
4.  **Be Generous:** Slightly expand the mask beyond the garment's natural boundaries to ensure a clean replacement and better blending.

### Few-Shot Examples:

**Example 1: Jacket over Lingerie (Your specific problem case)**
*   **Input:** A person wearing a bra and a reference image of a jacket.
*   **Logic:** The reference is a jacket. A jacket covers the entire upper body (torso and arms). The person is wearing a bra. I must ignore the shape of the bra and create a mask for the full area a jacket would cover.
*   **Output:** A single mask covering the person's torso and arms, with the label "Upper Body Area for Jacket Placement".

**Example 2: T-Shirt over a Long-Sleeve Shirt**
*   **Input:** A person wearing a long-sleeve sweater and a reference image of a t-shirt.
*   **Logic:** The reference is a t-shirt. It covers the torso. The person is wearing a sweater that also covers the arms. To place the t-shirt, I must cover the entire existing sweater, including the sleeves, to ensure it is completely replaced.
*   **Output:** A single mask covering the person's entire torso and arms, with the label "Upper Body Area for T-Shirt Placement".

**Example 3: Dress over Pants and Top**
*   **Input:** A person wearing jeans and a blouse, and a reference image of a knee-length dress.
*   **Logic:** The reference is a dress. It covers the torso and legs down to the knee. I must create a mask that covers this entire area, obscuring the original blouse and jeans.
*   **Output:** A single mask covering the person's torso and legs down to the knees, with the label "Full Dress Area for Placement".

**Example 4: Cropped Top over a T-Shirt**
*   **Input:** A person wearing a standard-length t-shirt and a reference image of a short, cropped top.
*   **Logic:** The reference is a cropped top, which is smaller than the existing t-shirt. To ensure the original t-shirt is completely replaced, I must generate a mask that covers the *entire area of the original t-shirt*.
*   **Output:** A single mask that covers the full area of the original t-shirt, with the label "Torso Area for Cropped Top Placement".

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
  const [masks, setMasks] = useState<MaskItemData[] | null>(null);
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
    const toastId = showLoading("Segmenting image...");

    try {
      const payload: any = {
        image_base64: await fileToBase64(sourceFile),
        mime_type: sourceFile.type,
        prompt,
      };

      if (referenceFile) {
        payload.reference_image_base64 = await fileToBase64(referenceFile);
        payload.reference_mime_type = referenceFile.type;
      }

      console.log("[SegmentationTool] Invoking Edge Function with payload:", { ...payload, image_base64: '...', reference_image_base64: '...' });

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