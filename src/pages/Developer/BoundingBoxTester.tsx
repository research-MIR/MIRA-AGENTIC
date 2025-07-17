import { useState, useRef, useCallback } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, UploadCloud, AlertTriangle } from 'lucide-react';
import { showError, showLoading, dismissToast } from '@/utils/toast';
import { useDropzone } from '@/hooks/useDropzone';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface BboxResult {
  person: number[];
}

const BoundingBoxTester = () => {
  const { supabase, session } = useSession();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [result, setResult] = useState<BboxResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    setSourceFile(file);
    setResult(null);
    setError(null);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      setSourcePreview(event.target?.result as string);
    };
  }, []);

  const { dropzoneProps, isDraggingOver } = useDropzone({
    onDrop: (e) => handleFileSelect(e.dataTransfer.files?.[0]),
  });

  const handleGetBoundingBox = async () => {
    if (!sourceFile) {
      showError("Please upload a source image first.");
      return;
    }
    setIsLoading(true);
    setError(null);
    setResult(null);
    const toastId = showLoading("Uploading image and starting analysis...");

    try {
      const filePath = `${session?.user.id}/bbox-test/${Date.now()}-${sourceFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from('mira-agent-user-uploads')
        .upload(filePath, sourceFile, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('mira-agent-user-uploads')
        .getPublicUrl(filePath);

      dismissToast(toastId);
      showLoading("Image uploaded. Detecting bounding box...");

      const { data, error: functionError } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-bbox', {
        body: { image_url: publicUrl }
      });

      if (functionError) throw functionError;
      
      setResult(data);
      dismissToast(toastId);
    } catch (err: any) {
      dismissToast(toastId);
      setError(err.message);
      showError(`Analysis failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const boxCoords = result?.person ? {
    y: result.person[0] / 1000,
    x: result.person[1] / 1000,
    height: (result.person[2] - result.person[0]) / 1000,
    width: (result.person[3] - result.person[1]) / 1000,
  } : null;

  return (
    <div className="p-4 md:p-8 h-full overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">Bounding Box Tester</h1>
        <p className="text-muted-foreground">A developer tool to test the person detection and bounding box function.</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader><CardTitle>1. Upload Source Image</CardTitle></CardHeader>
            <CardContent>
              <div {...dropzoneProps} onClick={() => fileInputRef.current?.click()} className={cn("p-4 border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-primary transition-colors", isDraggingOver && "border-primary bg-primary/10")}>
                {sourcePreview ? <img src={sourcePreview} alt="Source preview" className="max-h-48 mx-auto rounded-md" /> : <><UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" /><p className="mt-2 text-sm font-medium">Click or drag source image</p></>}
                <Input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={(e) => handleFileSelect(e.target.files?.[0] || null)} />
              </div>
            </CardContent>
          </Card>
          <Button onClick={handleGetBoundingBox} disabled={isLoading || !sourceFile}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Get Bounding Box
          </Button>
        </div>
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>Results</CardTitle></CardHeader>
            <CardContent>
              {isLoading && <div className="flex justify-center p-12"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}
              {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
              
              <div className="relative w-full max-w-lg mx-auto">
                {sourcePreview ? (
                  <img src={sourcePreview} alt="Result" className="rounded-md w-full" />
                ) : (
                  <div className="aspect-square bg-muted rounded-md flex items-center justify-center text-muted-foreground">Upload an image to see results</div>
                )}
                {boxCoords && (
                  <div
                    className="absolute border-2 border-red-500"
                    style={{
                      left: `${boxCoords.x * 100}%`,
                      top: `${boxCoords.y * 100}%`,
                      width: `${boxCoords.width * 100}%`,
                      height: `${boxCoords.height * 100}%`,
                    }}
                  />
                )}
              </div>

              {result && (
                <div className="mt-6">
                  <h3 className="font-semibold mb-2">Raw JSON Response</h3>
                  <pre className="bg-muted p-4 rounded-md text-xs overflow-x-auto">{JSON.stringify(result, null, 2)}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default BoundingBoxTester;