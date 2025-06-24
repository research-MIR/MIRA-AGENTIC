import { useState, useRef, useCallback } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, UploadCloud, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { showError, showLoading, dismissToast, showSuccess } from '@/utils/toast';
import { useDropzone } from '@/hooks/useDropzone';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = (error) => reject(error);
    });
};

const SegmentationTool = () => {
  const { supabase, session } = useSession();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [referencePreview, setReferencePreview] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState<{width: number, height: number} | null>(null);
  const [expansionAmount, setExpansionAmount] = useState(3);
  const [finalMaskUrl, setFinalMaskUrl] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceFileInputRef = useRef<HTMLInputElement>(null);
  const referenceFileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((file: File | null, type: 'source' | 'reference') => {
    if (file && file.type.startsWith('image/')) {
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
    setIsLoading(true);
    setError(null);
    setFinalMaskUrl(null);
    setRawResponse('');
    const toastId = showLoading("Starting segmentation process... This may take a moment.");

    try {
      const sourceBase64 = await fileToBase64(sourceFile);
      const referenceBase64 = referenceFile ? await fileToBase64(referenceFile) : null;

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-segmentation', {
        body: {
          user_id: session?.user.id,
          image_base64: sourceBase64,
          mime_type: sourceFile.type,
          reference_image_base64: referenceBase64,
          reference_mime_type: referenceFile?.type,
          image_dimensions: imageDimensions,
          expansion_percent: expansionAmount / 100,
        }
      });

      if (error) throw error;
      
      setFinalMaskUrl(data.finalMaskUrl);
      setRawResponse(JSON.stringify(data.rawResponse, null, 2));
      dismissToast(toastId);
      showSuccess("Segmentation complete!");

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
            <CardHeader><CardTitle>2. Configure Settings</CardTitle></CardHeader>
            <CardContent>
              <Label>Mask Expansion: {expansionAmount}%</Label>
              <Slider 
                value={[expansionAmount]} 
                onValueChange={(v) => setExpansionAmount(v[0])} 
                min={0} 
                max={10} 
                step={0.5} 
              />
              <p className="text-xs text-muted-foreground mt-1">Controls how much the final mask spills over the edges. Higher values ensure full coverage but may bleed.</p>
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
                    {finalMaskUrl && <img src={finalMaskUrl} alt="Final Mask" className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none" />}
                  </div>
                </div>
              </div>

              {rawResponse && (
                <div className="mt-6">
                  <h3 className="font-semibold mb-2">Raw JSON Response (from all runs)</h3>
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