import { useState, useEffect, useRef } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";
import { Loader2, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentationMask } from "@/components/SegmentationMask";
import { useSecureImage } from "@/hooks/useSecureImage";

const SecureImageDisplay = ({ imageUrl, alt }: { imageUrl: string | null, alt: string }) => {
  const { displayUrl, isLoading, error } = useSecureImage(imageUrl);

  if (isLoading) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error) return <div className="w-full h-full bg-destructive/10 rounded-md flex items-center justify-center text-destructive text-sm p-2">Error loading image: {error}</div>;
  if (!displayUrl) return null;

  return <img src={displayUrl} alt={alt} className="w-full h-full object-contain" />;
};

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
  const [maskImageUrl, setMaskImageUrl] = useState<string | null>(null);

  const segPersonImageUrl = segPersonImage ? URL.createObjectURL(segPersonImage) : null;

  useEffect(() => {
    return () => {
      if (segPersonImageUrl) URL.revokeObjectURL(segPersonImageUrl);
    };
  }, [segPersonImageUrl]);

  useEffect(() => {
    if (segmentationResult && segmentationResult[0]?.mask && sourceImageDimensions) {
      const maskItem = segmentationResult[0];
      const base64Data = maskItem.mask;
      const imageUrl = base64Data.startsWith('data:image') ? base64Data : `data:image/png;base64,${base64Data}`;

      const maskImg = new Image();
      maskImg.onload = () => {
        const [y0, x0, y1, x1] = maskItem.box_2d;
        const absX0 = Math.floor((x0 / 1000) * sourceImageDimensions.width);
        const absY0 = Math.floor((y0 / 1000) * sourceImageDimensions.height);
        const bboxWidth = Math.ceil(((x1 - x0) / 1000) * sourceImageDimensions.width);
        const bboxHeight = Math.ceil(((y1 - y0) / 1000) * sourceImageDimensions.height);

        if (bboxWidth < 1 || bboxHeight < 1) return;

        const resizedMaskCanvas = document.createElement('canvas');
        resizedMaskCanvas.width = bboxWidth;
        resizedMaskCanvas.height = bboxHeight;
        const resizedCtx = resizedMaskCanvas.getContext('2d');
        if (!resizedCtx) return;
        resizedCtx.drawImage(maskImg, 0, 0, bboxWidth, bboxHeight);

        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = sourceImageDimensions.width;
        fullCanvas.height = sourceImageDimensions.height;
        const fullCtx = fullCanvas.getContext('2d');
        if (!fullCtx) return;
        
        fullCtx.drawImage(resizedMaskCanvas, absX0, absY0);
        setMaskImageUrl(fullCanvas.toDataURL());
      };
      maskImg.src = imageUrl;
    }
  }, [segmentationResult, sourceImageDimensions]);

  const handlePersonImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSegPersonImage(file);
    setSegmentationResult(null);
    setCroppedImageUrl(null);
    setSourceImagePublicUrl(null);
    setMaskImageUrl(null);

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
    setMaskImageUrl(null);
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
          user_prompt: segPrompt,
          user_id: session?.user.id
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
    if (!sourceImagePublicUrl || !segmentationResult || segmentationResult.length === 0) {
      return showError("Missing source image URL or segmentation result.");
    }
    setIsCropping(true);
    const toastId = showLoading("Cropping image...");
    
    const payload = {
      image_url: sourceImagePublicUrl,
      box: segmentationResult[0].box_2d,
      user_id: session?.user.id
    };

    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-crop-image', { body: payload });
      if (error) throw error;
      
      setCroppedImageUrl(data.cropped_image_url);
      dismissToast(toastId);
      showSuccess("Image cropped successfully.");
    } catch (err: any) {
      showError(`Cropping failed: ${err.message}`);
      dismissToast(toastId);
    } finally {
      setIsCropping(false);
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('developerTools')}</h1>
        <p className="text-muted-foreground">{t('developerToolsDescription')}</p>
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
                  <div className="relative w-full max-w-md mx-auto max-h-96 bg-muted rounded-md overflow-hidden flex justify-center items-center">
                    <img src={segPersonImageUrl} alt="Segmentation Source" className="w-full h-full object-contain" />
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
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <Label>JSON Response</Label>
                                <Textarea
                                    readOnly
                                    value={JSON.stringify(segmentationResult, null, 2)}
                                    className="mt-1 h-48 font-mono text-xs"
                                />
                            </div>
                            <div className="max-h-96 bg-muted rounded-md overflow-hidden flex justify-center items-center">
                                <Label>Corresponding Mask</Label>
                                <SecureImageDisplay imageUrl={maskImageUrl} alt="Segmentation Mask" />
                            </div>
                        </div>
                        <Button onClick={handleCropTest} disabled={isCropping}>
                            {isCropping && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Test Crop with BBox
                        </Button>
                    </div>
                )}
                {croppedImageUrl && (
                  <div className="space-y-4 pt-4 border-t">
                    <h3 className="font-semibold">Crop Result</h3>
                    <div className="max-h-96 bg-muted rounded-md overflow-hidden flex justify-center items-center">
                      <SecureImageDisplay imageUrl={croppedImageUrl} alt="Cropped Result" />
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

export default Developer;