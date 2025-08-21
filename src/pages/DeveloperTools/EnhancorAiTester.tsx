import { useState } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { showError, showLoading, dismissToast, showSuccess } from '@/utils/toast';
import { Loader2, Upload, Wand2 } from 'lucide-react';

const UPLOAD_BUCKET = 'enhancor-ai-uploads';

export const EnhancorAiTester = () => {
  const { supabase, session } = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [mode, setMode] = useState('portrait');
  const [portraitMode, setPortraitMode] = useState('professional');

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setFile(event.target.files[0]);
      setUploadedImageUrl(null);
      setResultImageUrl(null);
    }
  };

  const handleUpload = async () => {
    if (!file || !session) return;

    setIsUploading(true);
    const toastId = showLoading('Uploading image...');

    try {
      const filePath = `${session.user.id}/enhancor-sources/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
      setUploadedImageUrl(publicUrl);
      dismissToast(toastId);
      showSuccess('Image uploaded successfully!');
    } catch (error: any) {
      dismissToast(toastId);
      showError(`Upload failed: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleProcess = async () => {
    if (!uploadedImageUrl || !session) return;

    setIsProcessing(true);
    const toastId = showLoading('Sending image to EnhancorAI...');

    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-enhancor-ai', {
        body: {
          user_id: session.user.id,
          source_image_urls: [uploadedImageUrl],
          enhancor_mode: mode,
          enhancor_params: mode === 'portrait' ? { mode: portraitMode } : {},
        },
      });

      if (error) throw error;
      
      dismissToast(toastId);
      showSuccess('Job successfully submitted! The result will appear below when ready (via webhook). This may take a few minutes.');
      // NOTE: The result image URL will be set by a real-time subscription in a real app.
      // For this tester, we can just show a success message.
      console.log('EnhancorAI job response:', data);

    } catch (error: any) {
      dismissToast(toastId);
      showError(`Processing failed: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="p-4 md:p-8">
        <header className="pb-4 mb-8 border-b">
            <h1 className="text-3xl font-bold flex items-center gap-2">
                <Wand2 />
                EnhancorAI Upscaler Tester
            </h1>
            <p className="text-muted-foreground">Test the EnhancorAI upscaling and enhancement services.</p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card>
                <CardHeader>
                <CardTitle>1. Upload Image</CardTitle>
                <CardDescription>Select an image file to upload. Any format will be converted to JPEG on the server.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                <div className="grid w-full max-w-sm items-center gap-1.5">
                    <Label htmlFor="picture">Picture</Label>
                    <Input id="picture" type="file" onChange={handleFileChange} />
                </div>
                {file && <p className="text-sm text-muted-foreground">Selected: {file.name}</p>}
                </CardContent>
                <CardFooter>
                <Button onClick={handleUpload} disabled={!file || isUploading}>
                    {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <Upload className="mr-2 h-4 w-4" />
                    Upload to Supabase
                </Button>
                </CardFooter>
            </Card>

            <Card className={!uploadedImageUrl ? 'bg-muted' : ''}>
                <CardHeader>
                <CardTitle>2. Configure & Process</CardTitle>
                <CardDescription className={!uploadedImageUrl ? 'text-muted-foreground' : ''}>
                    Once uploaded, select the enhancement mode and send it to the API.
                </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                {uploadedImageUrl && (
                    <div className="space-y-4">
                        <img src={uploadedImageUrl} alt="Uploaded" className="rounded-md max-h-48 w-auto" />
                        <div className="space-y-2">
                            <Label>Enhancement Mode</Label>
                            <Select value={mode} onValueChange={setMode}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select a mode" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="portrait">Portrait Enhancer</SelectItem>
                                    <SelectItem value="general">General Upscaler (x2)</SelectItem>
                                    <SelectItem value="detailed">Detailed Upscaler (x4)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {mode === 'portrait' && (
                            <div className="space-y-2">
                                <Label>Portrait Style</Label>
                                <Select value={portraitMode} onValueChange={setPortraitMode}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a portrait style" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="professional">Professional</SelectItem>
                                        <SelectItem value="cinematic">Cinematic</SelectItem>
                                        <SelectItem value="vibrant">Vibrant</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                )}
                </CardContent>
                <CardFooter>
                <Button onClick={handleProcess} disabled={!uploadedImageUrl || isProcessing}>
                    {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <Wand2 className="mr-2 h-4 w-4" />
                    Process Image
                </Button>
                </CardFooter>
            </Card>
        </div>
    </div>
  );
};