import { useState, useEffect, useRef } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentationMask } from "@/components/SegmentationMask";

const Developer = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();

  const [segPersonImage, setSegPersonImage] = useState<File | null>(null);
  const [segGarmentImage, setSegGarmentImage] = useState<File | null>(null);
  const [segPrompt, setSegPrompt] = useState("Segment the main garment on the person.");
  const [segmentationResult, setSegmentationResult] = useState<any | null>(null);
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [sourceImageDimensions, setSourceImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [sourceImagePublicUrl, setSourceImagePublicUrl] = useState<string | null>(null);
  const [croppedImageUrl, setCroppedImageUrl] = useState<string | null>(null);

  const segPersonImageUrl = segPersonImage ? URL.createObjectURL(segPersonImage) : null;

  useEffect(() => {
    return () => {
      if (segPersonImageUrl) URL.revokeObjectURL(segPersonImageUrl);
    };
  }, [segPersonImageUrl]);

  const handlePersonImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSegPersonImage(file);
    setSegmentationResult(null);
    setCroppedImageUrl(null);
    setSourceImagePublicUrl(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setSourceImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const uploadFileAndGetUrl = async (file: File | null): Promise<string | null> => {
    if (!file) return null;
    if (!session?.user) throw new Error("User session not found.");
    const filePath = `${session.user.id}/dev-test/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('mira-agent-user-uploads').upload(filePath, file, { upsert: true });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);
    return publicUrl;
  };

  const handleSegmentationTest = async () => {
    if (!segPersonImage) return showError("Please select a person image for segmentation.");
    setIsSegmenting(true);
    setSegmentationResult(null);
    setCroppedImageUrl(null);
    const toastId = showLoading("Running segmentation test...");

    try {
      const person_image_url = await uploadFileAndGetUrl(segPersonImage);
      setSourceImagePublicUrl(person_image_url);
      const garment_image_url = await uploadFileAndGetUrl(segGarmentImage);

      if (!person_image_url) throw new Error("Failed to upload person image.");

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-worker-segmentation-test', {
        body: {
          person_image_url,
          garment_image_url,
          user_prompt: segPrompt
        }
      });

      if (error) throw error;

      const masksArray = data.result.masks ? data.result.masks : data.result;
      setSegmentationResult(masksArray);
      
      dismissToast(toastId);
      showSuccess("Segmentation analysis complete.");
    } catch (err: any) {
      showError(`Segmentation failed: ${err.message}`);
      dismissToast(toastId);
    } finally {
      setIsSegmenting(false);
    }
  };

  const handleCropTest = async () => {
    console.log("[CropTest] Starting...");
    if (!sourceImagePublicUrl || !segmentationResult || segmentationResult.length === 0) {
      const errorMsg = "Missing source image URL or segmentation result.";
      console.error("[CropTest] Error:", errorMsg, { sourceImagePublicUrl, segmentationResult });
      return showError(errorMsg);
    }
    setIsCropping(true);
    const toastId = showLoading("Cropping image...");
    
    const payload = {
      image_url: sourceImagePublicUrl,
      box: segmentationResult[0].box_2d,
      user_id: session?.user.id
    };
    console.log("[CropTest] Invoking 'MIRA-AGENT-tool-crop-image' with payload:", payload);

    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-crop-image', { body: payload });
      
      console.log("[CropTest] Response from function:", { data, error });

      if (error) throw error;
      
      console.log("[CropTest] Setting cropped image URL state to:", data.cropped_image_url);
      setCroppedImageUrl(data.cropped_image_url);
      dismissToast(toastId);
      showSuccess("Image cropped successfully.");
    } catch (err: any) {
      console.error("[CropTest] Catch block error:", err);
      showError(`Cropping failed: ${err.message}`);
      dismissToast(toastId);
    } finally {
      setIsCropping(false);
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t.developerTools}</h1>
        <p className="text-muted-foreground">{t.developerToolsDescription}</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>AI Segmentation Tester (Test Environment)</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Upload images and a prompt to test the isolated segmentation function.</p>
                <div>
                  <Label htmlFor="seg-person-upload">Person Image</Label>
                  <Input id="seg-person-upload" type="file" accept="image/*" onChange={handlePersonImageChange} />
                </div>
                <div>
                  <Label htmlFor="seg-garment-upload">Garment Image (Optional)</Label>
                  <Input id="seg-garment-upload" type="file" accept="image/*" onChange={(e) => setSegGarmentImage(e.target.files?.[0] || null)} />
                </div>
                <div>
                  <Label htmlFor="seg-prompt">Segmentation Prompt</Label>
                  <Textarea id="seg-prompt" value={segPrompt} onChange={(e) => setSegPrompt(e.target.value)} />
                </div>
                {segPersonImageUrl && (
                  <div className="relative w-full max-w-md mx-auto">
                    <img src={segPersonImageUrl} alt="Segmentation Source" className="w-full h-auto rounded-md" />
                    {segmentationResult && sourceImageDimensions && (
                        <SegmentationMask 
                            masks={segmentationResult} 
                            imageDimensions={sourceImageDimensions} 
                        />
                    )}
                  </div>
                )}
                <Button onClick={handleSegmentationTest} disabled={isSegmenting || !segPersonImage}>
                    {isSegmenting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Run Segmentation Test
                </Button>
                {segmentationResult && (
                    <div className="space-y-4 pt-4 border-t">
                        <Label>JSON Response</Label>
                        <Textarea
                            readOnly
                            value={JSON.stringify(segmentationResult, null, 2)}
                            className="mt-1 h-48 font-mono text-xs"
                        />
                        <Button onClick={handleCropTest} disabled={isCropping}>
                            {isCropping && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Test Crop with BBox
                        </Button>
                        {croppedImageUrl && (
                            <div>
                                <Label>Cropped Image Result</Label>
                                <img src={croppedImageUrl} alt="Cropped Result" className="mt-2 rounded-md border" />
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Developer;