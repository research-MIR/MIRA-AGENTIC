import React, { useState, useCallback, useMemo, useRef } from "react";
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

const ImageUploader = ({ onFileSelect, title, isDraggingOver, t }: { onFileSelect: (file: File) => void, title: string, isDraggingOver: boolean, t: any }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <div 
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
  const [segmentationResult, setSegmentationResult] = useState<any | null>(null);
  const [isPersonDragging, setIsPersonDragging] = useState(false);
  const [isGarmentDragging, setIsGarmentDragging] = useState(false);

  const personImageUrl = useMemo(() => personImageFile ? URL.createObjectURL(personImageFile) : null, [personImageFile]);
  const garmentImageUrl = useMemo(() => garmentImageFile ? URL.createObjectURL(garmentImageFile) : null, [garmentImageFile]);

  const uploadFileAndGetUrl = async (file: File | null, bucket: string): Promise<string | null> => {
    if (!file) return null;
    if (!session?.user) throw new Error("User session not found.");
    const filePath = `${session.user.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, file);
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
    const toastId = showLoading("Uploading images and starting analysis...");

    try {
      const person_image_url = await uploadFileAndGetUrl(personImageFile, 'mira-agent-user-uploads');
      const garment_image_url = await uploadFileAndGetUrl(garmentImageFile, 'mira-agent-user-uploads');

      if (!person_image_url || !garment_image_url) {
        throw new Error("Failed to upload one or both images.");
      }
      
      dismissToast(toastId);
      showLoading("AI is analyzing the images...");

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-segment-garment', {
        body: { person_image_url, garment_image_url, user_prompt: prompt }
      });

      if (error) throw error;

      setSegmentationResult(data.segmentation_result);
      showSuccess("Segmentation complete!");

    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsLoading(false);
      dismissToast(toastId);
    }
  };

  const BoundingBox = () => {
    if (!segmentationResult?.box_2d) return null;
    const [x_min, y_min, x_max, y_max] = segmentationResult.box_2d;
    return (
      <div
        className="absolute border-2 border-primary pointer-events-none"
        style={{
          left: `${x_min * 100}%`,
          top: `${y_min * 100}%`,
          width: `${(x_max - x_min) * 100}%`,
          height: `${(y_max - y_min) * 100}%`,
        }}
      >
        <div className="absolute -top-5 left-0 bg-primary text-primary-foreground text-xs px-1 rounded-sm">
          {segmentationResult.label}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t.virtualTryOn}</h1>
        <p className="text-muted-foreground">{t.comingSoon}</p>
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
              <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g., 'Just the t-shirt, ignore the jacket'" />
            </CardContent>
          </Card>
          <Button onClick={handleSegment} disabled={isLoading} className="w-full">
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            Segment Garment Area
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
                  {personImageUrl ? <img src={personImageUrl} alt="Person" className="w-full rounded-md" /> : <div className="aspect-square bg-muted rounded-md flex items-center justify-center"><ImageIcon className="h-12 w-12 text-muted-foreground" /></div>}
                  {segmentationResult && <BoundingBox />}
                </div>
                <div>
                  <h3 className="font-semibold text-center mb-2">Garment</h3>
                  {garmentImageUrl ? <img src={garmentImageUrl} alt="Garment" className="w-full rounded-md" /> : <div className="aspect-square bg-muted rounded-md flex items-center justify-center"><ImageIcon className="h-12 w-12 text-muted-foreground" /></div>}
                </div>
              </div>
              {segmentationResult && (
                <div>
                  <Label>Segmentation JSON Output</Label>
                  <pre className="mt-2 p-2 bg-muted rounded-md text-xs overflow-x-auto">
                    {JSON.stringify(segmentationResult, null, 2)}
                  </pre>
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