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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RealtimeChannel } from "@supabase/supabase-js";

interface VtoPipelineJob {
  id: string;
  status: 'pending_segmentation' | 'pending_crop' | 'pending_tryon' | 'pending_composite' | 'complete' | 'failed';
  source_person_image_url: string;
  source_garment_image_url: string;
  cropped_image_url?: string;
  segmentation_result?: {
    masks: { box_2d: [number, number, number, number], label: string }[];
  };
  final_composite_url?: string;
  error_message?: string;
  bitstudio_job?: {
    final_image_url?: string;
  };
}

const SecureImageDisplay = ({ imageUrl, alt }: { imageUrl: string | null, alt: string }) => {
  const { displayUrl, isLoading, error } = useSecureImage(imageUrl);

  if (isLoading) return <div className="w-full h-32 bg-muted rounded-md flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error) return <div className="w-full h-32 bg-destructive/10 rounded-md flex items-center justify-center text-destructive text-sm p-2">Error loading image: {error}</div>;
  if (!displayUrl) return null;

  return <img src={displayUrl} alt={alt} className="mt-2 rounded-md border" />;
};

const Developer = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const [personImageFile, setPersonImageFile] = useState<File | null>(null);
  const [garmentImageFile, setGarmentImageFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const { data: activeJob } = useQuery<VtoPipelineJob | null>({
    queryKey: ['vtoPipelineTestJob', activeJobId],
    queryFn: async () => {
      if (!activeJobId) return null;
      const { data, error } = await supabase
        .from('mira-agent-vto-pipeline-jobs-test')
        .select('*, bitstudio_job:bitstudio_job_id(final_image_url)')
        .eq('id', activeJobId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!activeJobId,
  });

  useEffect(() => {
    if (!session?.user?.id) return;
    const channel = supabase.channel(`vto-pipeline-test-tracker-${session.user.id}`)
      .on<VtoPipelineJob>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mira-agent-vto-pipeline-jobs-test', filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          if (payload.new.id === activeJobId) {
            queryClient.invalidateQueries({ queryKey: ['vtoPipelineTestJob', activeJobId] });
          }
        }
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [supabase, session?.user?.id, queryClient, activeJobId]);

  const uploadFileAndGetUrl = async (file: File | null): Promise<string | null> => {
    if (!file) return null;
    if (!session?.user) throw new Error("User session not found.");
    const filePath = `${session.user.id}/dev-test/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('mira-agent-user-uploads').upload(filePath, file, { upsert: true });
    if (error) throw new Error(`Upload failed: ${error.message}`);
    const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);
    return publicUrl;
  };

  const handlePipelineTest = async () => {
    if (!personImageFile || !garmentImageFile) return showError("Please select both a person and a garment image.");
    setIsLoading(true);
    setActiveJobId(null);
    const toastId = showLoading("Uploading images and starting pipeline...");

    try {
      const person_image_url = await uploadFileAndGetUrl(personImageFile);
      const garment_image_url = await uploadFileAndGetUrl(garmentImageFile);
      if (!person_image_url || !garment_image_url) throw new Error("Failed to upload one or both images.");

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-vto-pipeline-test', {
        body: {
          person_image_url,
          garment_image_url,
          user_id: session?.user.id,
          mode: 'edit' // Hardcode to edit mode for this test
        }
      });

      if (error) throw error;
      
      setActiveJobId(data.jobId);
      dismissToast(toastId);
      showSuccess("Test pipeline job started!");
    } catch (err: any) {
      showError(`Pipeline start failed: ${err.message}`);
      dismissToast(toastId);
    } finally {
      setIsLoading(false);
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
            <CardHeader><CardTitle>VTO Pipeline Tester</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Test the full VTO pipeline from segmentation to final composite.</p>
                <div>
                  <Label htmlFor="person-upload">Person Image</Label>
                  <Input id="person-upload" type="file" accept="image/*" onChange={(e) => setPersonImageFile(e.target.files?.[0] || null)} />
                </div>
                <div>
                  <Label htmlFor="garment-upload">Garment Image</Label>
                  <Input id="garment-upload" type="file" accept="image/*" onChange={(e) => setGarmentImageFile(e.target.files?.[0] || null)} />
                </div>
                <Button onClick={handlePipelineTest} disabled={isLoading || !personImageFile || !garmentImageFile}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Run Full Pipeline Test
                </Button>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Pipeline Status</CardTitle></CardHeader>
            <CardContent>
              {!activeJob && <p className="text-sm text-muted-foreground">Run a test to see the results here.</p>}
              {activeJob && (
                <div className="space-y-4">
                  <p className="text-sm font-mono">Job ID: {activeJob.id}</p>
                  <p className="text-sm font-semibold">Status: <span className="font-mono p-1 bg-muted rounded-md">{activeJob.status}</span></p>
                  {activeJob.error_message && <div className="p-2 bg-destructive/10 text-destructive rounded-md text-sm"><AlertTriangle className="inline h-4 w-4 mr-2"/>{activeJob.error_message}</div>}
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Source Person</Label>
                      <SecureImageDisplay imageUrl={activeJob.source_person_image_url} alt="Source Person" />
                    </div>
                    <div>
                      <Label>Source Garment</Label>
                      <SecureImageDisplay imageUrl={activeJob.source_garment_image_url} alt="Source Garment" />
                    </div>
                    <div>
                      <Label>Cropped Image</Label>
                      <SecureImageDisplay imageUrl={activeJob.cropped_image_url} alt="Cropped Image" />
                    </div>
                    <div>
                      <Label>VTO Result (Mock)</Label>
                      <SecureImageDisplay imageUrl={activeJob.bitstudio_job?.final_image_url} alt="VTO Result" />
                    </div>
                  </div>
                   <div>
                      <Label>Final Composite</Label>
                      <SecureImageDisplay imageUrl={activeJob.final_composite_url} alt="Final Composite" />
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