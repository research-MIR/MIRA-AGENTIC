import { useState, useEffect, useRef } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";
import { Loader2, AlertTriangle, Image as ImageIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { optimizeImage } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentationMask } from "@/components/SegmentationMask";

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

const Developer = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [isCancelling, setIsCancelling] = useState(false);

  // Image Optimizer State
  const [originalImage, setOriginalImage] = useState<File | null>(null);
  const [optimizedImage, setOptimizedImage] = useState<File | null>(null);
  const [quality, setQuality] = useState(80);

  // Segmentation State
  const [segPersonImage, setSegPersonImage] = useState<File | null>(null);
  const [segGarmentImage, setSegGarmentImage] = useState<File | null>(null);
  const [segPrompt, setSegPrompt] = useState("Segment the main garment on the person.");
  const [segmentationResult, setSegmentationResult] = useState<any | null>(null);
  const [isSegmenting, setIsSegmenting] = useState(false);

  const originalImageUrl = originalImage ? URL.createObjectURL(originalImage) : null;
  const optimizedImageUrl = optimizedImage ? URL.createObjectURL(optimizedImage) : null;
  const segPersonImageUrl = segPersonImage ? URL.createObjectURL(segPersonImage) : null;

  useEffect(() => {
    return () => {
      if (originalImageUrl) URL.revokeObjectURL(originalImageUrl);
      if (optimizedImageUrl) URL.revokeObjectURL(optimizedImageUrl);
      if (segPersonImageUrl) URL.revokeObjectURL(segPersonImageUrl);
    };
  }, [originalImageUrl, optimizedImageUrl, segPersonImageUrl]);

  const handleImageTestChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setOriginalImage(file);
    }
  };

  useEffect(() => {
    if (originalImage) {
      optimizeImage(originalImage, quality / 100).then(setOptimizedImage);
    }
  }, [originalImage, quality]);

  const handleCancelAllJobs = async () => {
    if (!session?.user) return showError("You must be logged in.");
    setIsCancelling(true);
    const toastId = showLoading("Cancelling all active jobs...");
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-cancel-all-my-jobs', {
        body: { user_id: session.user.id }
      });

      if (error) throw error;

      dismissToast(toastId);
      showSuccess(data.message || "All active jobs have been cancelled.");
      queryClient.invalidateQueries({ queryKey: ['activeComfyJobs'] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to cancel jobs: ${err.message}`);
    } finally {
      setIsCancelling(false);
    }
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
    const toastId = showLoading("Running segmentation test...");

    try {
      const person_image_url = await uploadFileAndGetUrl(segPersonImage);
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

      setSegmentationResult(data.result);
      dismissToast(toastId);
      showSuccess("Segmentation analysis complete.");
    } catch (err: any) {
      showError(`Segmentation failed: ${err.message}`);
      dismissToast(toastId);
    } finally {
      setIsSegmenting(false);
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
                  <Input id="seg-person-upload" type="file" accept="image/*" onChange={(e) => setSegPersonImage(e.target.files?.[0] || null)} />
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
                    {segmentationResult && <SegmentationMask masks={segmentationResult.masks} />}
                  </div>
                )}
                <Button onClick={handleSegmentationTest} disabled={isSegmenting || !segPersonImage}>
                    {isSegmenting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Run Segmentation Test
                </Button>
                {segmentationResult && (
                    <div>
                        <Label>JSON Response</Label>
                        <Textarea
                            readOnly
                            value={JSON.stringify(segmentationResult, null, 2)}
                            className="mt-1 h-48 font-mono text-xs"
                        />
                    </div>
                )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Image Optimization Tester</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Input id="image-test-upload" type="file" accept="image/*" onChange={handleImageTestChange} />
              {originalImage && (
                <div className="space-y-4">
                  <div>
                    <Label>Quality: {quality}%</Label>
                    <Slider value={[quality]} onValueChange={(v) => setQuality(v[0])} min={10} max={100} step={5} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-semibold text-center">Original</h4>
                      {originalImageUrl && <img src={originalImageUrl} alt="Original" className="w-full rounded-md mt-2" />}
                      <p className="text-sm text-center text-muted-foreground mt-1">{formatBytes(originalImage.size)}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-center">Optimized (PNG)</h4>
                      {optimizedImageUrl && <img src={optimizedImageUrl} alt="Optimized" className="w-full rounded-md mt-2" />}
                      {optimizedImage && <p className="text-sm text-center text-muted-foreground mt-1">{formatBytes(optimizedImage.size)}</p>}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <div>
          <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle />
                    Danger Zone
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                    These actions are irreversible. Use with caution.
                </p>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive" disabled={isCancelling}>
                            {isCancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Cancel All My Active Jobs
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This will immediately stop and fail all of your jobs that are currently queued or processing across all systems. This action cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleCancelAllJobs}>
                                Yes, cancel all jobs
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Developer;