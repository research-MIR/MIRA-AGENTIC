import { useState } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Loader2, Wand2, UploadCloud } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

const Refiner = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const [isLoading, setIsLoading] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [sourceImage, setSourceImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSourceImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setResultUrl(null); // Clear previous result
    }
  };

  const handleRefine = async () => {
    if (!sourceImage) return showError("Please upload an image to refine.");
    if (!prompt.trim()) return showError("Please enter a prompt to guide the refinement.");
    if (!session?.user) return showError("You must be logged in.");

    setIsLoading(true);
    setResultUrl(null);
    const toastId = showLoading("Uploading image and queueing job...");

    try {
      // The proxy functions will now read the comfyui_address from the database config
      const uploadFormData = new FormData();
      uploadFormData.append('image', sourceImage);
      
      const { data: uploadResult, error: uploadError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui-upload', {
          body: uploadFormData
      });

      if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
      const uploadedFilename = uploadResult.name;
      if (!uploadedFilename) throw new Error("ComfyUI did not return a filename for the uploaded image.");

      dismissToast(toastId);
      toastId = showLoading("Refining image... This may take a moment.");

      const { data: queueResult, error: queueError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
        body: {
          prompt_text: prompt,
          image_filename: uploadedFilename,
          invoker_user_id: session.user.id
        }
      });

      if (queueError) throw queueError;
      const { jobId } = queueResult;

      // Poll for the result
      const pollResult = async () => {
        for (let i = 0; i < 100; i++) {
          const { data: jobStatus } = await supabase.from('mira-agent-comfyui-jobs').select('status, final_result').eq('id', jobId).single();
          if (jobStatus?.status === 'complete') {
            return jobStatus.final_result.publicUrl;
          }
          if (jobStatus?.status === 'failed') {
            throw new Error("Refinement job failed.");
          }
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        throw new Error("Polling timed out.");
      };

      const finalUrl = await pollResult();
      setResultUrl(finalUrl);
      showSuccess("Image refined successfully!");

    } catch (err: any) {
      showError(err.message);
    } finally {
      dismissToast(toastId);
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">Image Refiner</h1>
        <p className="text-muted-foreground">Upload an image and use AI to upscale and refine it.</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>1. Upload Image</CardTitle></CardHeader>
            <CardContent>
              <Input id="source-image" type="file" onChange={handleFileChange} accept="image/*" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>2. Describe Refinements</CardTitle></CardHeader>
            <CardContent>
              <Label htmlFor="refiner-prompt">Prompt</Label>
              <Textarea id="refiner-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A photorealistic image, high detail, 4k..." />
            </CardContent>
          </Card>
          <Button onClick={handleRefine} disabled={isLoading} className="w-full">
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            Refine Image
          </Button>
        </div>
        <div>
          <Card className="min-h-[400px]">
            <CardHeader><CardTitle>Result</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-center">
              {resultUrl ? (
                <img src={resultUrl} alt="Refined result" className="max-w-full max-h-[500px] rounded-lg" />
              ) : imagePreview ? (
                <img src={imagePreview} alt="Image preview" className="max-w-full max-h-[500px] rounded-lg opacity-50" />
              ) : (
                <div className="text-center text-muted-foreground">
                  <UploadCloud className="mx-auto h-12 w-12" />
                  <p>Upload an image to get started</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Refiner;