import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle, Loader2, Wand2, AlertTriangle, Info } from 'lucide-react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Label } from '../ui/label';
import { Slider } from '../ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

interface Pose {
  final_url: string;
  is_upscaled?: boolean;
  status: string;
  pose_prompt: string;
}

interface Job {
  id: string;
  final_posed_images?: Pose[];
}

interface UpscalePosesModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobs: Job[];
  packId: string;
  totalPoses: number;
  completedPoses: number;
  isReadyForUpscale: boolean;
}

export const UpscalePosesModal = ({ 
  isOpen, 
  onClose, 
  jobs, 
  packId,
  totalPoses,
  completedPoses,
  isReadyForUpscale
}: UpscalePosesModalProps) => {
  const { supabase } = useSession();
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [selectedPoseUrls, setSelectedPoseUrls] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  // New state for upscale settings
  const [upscaleFactor, setUpscaleFactor] = useState(2.0);
  const [engine, setEngine] = useState('comfyui_tiled_upscaler');
  const [tileSize, setTileSize] = useState<string | number>('default');
  const [useBlankPrompt, setUseBlankPrompt] = useState(false);

  const posesReadyForUpscale = useMemo(() => {
    if (!jobs) return [];
    return jobs.flatMap(job => 
      (job.final_posed_images || [])
        .filter(pose => pose.status === 'complete' && !pose.is_upscaled)
        .map(pose => ({ ...pose, jobId: job.id }))
    );
  }, [jobs]);

  const toggleSelection = (url: string) => {
    setSelectedPoseUrls(prev => {
      const newSet = new Set(prev);
      if (newSet.has(url)) {
        newSet.delete(url);
      } else {
        newSet.add(url);
      }
      return newSet;
    });
  };

  const handleUpscale = async (urlsToProcess: string[]) => {
    if (urlsToProcess.length === 0) return;
    setIsLoading(true);
    const toastId = showLoading(`Preparing ${urlsToProcess.length} poses for upscaling...`);

    try {
      const jobsToUpdate = new Map<string, string[]>();
      urlsToProcess.forEach(url => {
        const jobForPose = jobs.find(j => j.final_posed_images?.some(p => p.final_url === url));
        if (jobForPose) {
          if (!jobsToUpdate.has(jobForPose.id)) {
            jobsToUpdate.set(jobForPose.id, []);
          }
          jobsToUpdate.get(jobForPose.id)!.push(url);
        }
      });

      const upscaleConfig = {
        upscale_factor: upscaleFactor,
        upscaler_engine: engine,
        tile_size: tileSize === 'default' ? null : tileSize,
        use_blank_prompt: useBlankPrompt,
      };

      const upscalePromises = Array.from(jobsToUpdate.entries()).map(([jobId, poseUrls]) => {
        return supabase.rpc('MIRA-AGENT-start_poses_upscaling', {
          p_job_id: jobId,
          p_pose_urls: poseUrls,
          p_upscale_config: upscaleConfig
        });
      });

      const results = await Promise.allSettled(upscalePromises);
      
      const successfulJobs = results.filter(r => r.status === 'fulfilled').length;
      const failedJobs = results.length - successfulJobs;

      dismissToast(toastId);

      if (successfulJobs > 0) {
        showSuccess(`Successfully queued ${urlsToProcess.length} poses across ${successfulJobs} jobs for upscaling.`);
        queryClient.invalidateQueries({ queryKey: ['modelsForPack', packId] });
      }
      if (failedJobs > 0) {
        showError(`${failedJobs} batch(es) failed to start. Please check the console for details.`);
        results.forEach(r => {
          if (r.status === 'rejected') console.error("Upscale request failed:", r.reason);
        });
      }

      onClose();
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to start upscaling: ${err.message}`);
    } finally {
      setIsLoading(false);
      setSelectedPoseUrls(new Set());
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Upscale & Prepare Poses for VTO</DialogTitle>
          <DialogDescription>Select poses and configure the upscaling process. This prepares them for use in the Virtual Try-On tool.</DialogDescription>
        </DialogHeader>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 my-4">
          <div className="md:col-span-2">
            {!isReadyForUpscale && (
              <Alert variant="destructive" className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Generation Incomplete</AlertTitle>
                <AlertDescription>
                  Warning: Only {completedPoses} out of {totalPoses} poses have been successfully generated. You can proceed with upscaling the available images, but the final set will be incomplete.
                </AlertDescription>
              </Alert>
            )}
            <ScrollArea className="h-[60vh]">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pr-4">
                {posesReadyForUpscale.map((pose) => {
                  const isSelected = selectedPoseUrls.has(pose.final_url);
                  return (
                    <div key={pose.final_url} className="relative cursor-pointer" onClick={() => toggleSelection(pose.final_url)}>
                      <img src={pose.final_url} alt="Pose to upscale" className="w-full h-full object-cover rounded-md" />
                      {isSelected && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-md">
                          <CheckCircle className="h-8 w-8 text-white" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {posesReadyForUpscale.length === 0 && (
                <p className="text-center text-muted-foreground py-8">All generated poses have been upscaled.</p>
              )}
            </ScrollArea>
          </div>
          <div className="md:col-span-1">
            <Card>
              <CardHeader><CardTitle>Upscale Settings</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Upscale Factor: {upscaleFactor.toFixed(1)}x</Label>
                  <Slider value={[upscaleFactor]} onValueChange={(v) => setUpscaleFactor(v[0])} min={1.1} max={4} step={0.1} />
                </div>
                <div>
                  <Label>Upscaler Engine</Label>
                  <Select value={engine} onValueChange={(v) => setEngine(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comfyui_tiled_upscaler">ComfyUI (Prompt-based)</SelectItem>
                      <SelectItem value="enhancor_detailed">Enhancor (Detailed)</SelectItem>
                      <SelectItem value="enhancor_general">Enhancor (General)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tile Size</Label>
                  <Select value={String(tileSize)} onValueChange={(v) => setTileSize(v === 'full_size' || v === 'default' ? v : Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default (768px)</SelectItem>
                      <SelectItem value="full_size">Full Size (Single Tile)</SelectItem>
                      <SelectItem value="512">512px</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="blank-prompt-switch" className="flex items-center gap-2">
                    Use Blank Prompt
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent><p>For ComfyUI engine only. Skips AI analysis for a faster, less detailed upscale.</p></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Switch id="blank-prompt-switch" checked={useBlankPrompt} onCheckedChange={setUseBlankPrompt} disabled={engine !== 'comfyui_tiled_upscaler'} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="secondary"
            disabled={isLoading || posesReadyForUpscale.length === 0}
            onClick={() => handleUpscale(posesReadyForUpscale.map(p => p.final_url))}
          >
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            {isReadyForUpscale ? `Upscale All (${posesReadyForUpscale.length})` : `Upscale ${posesReadyForUpscale.length} Available`}
          </Button>
          <Button
            disabled={isLoading || selectedPoseUrls.size === 0}
            onClick={() => handleUpscale(Array.from(selectedPoseUrls))}
          >
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            Upscale Selected ({selectedPoseUrls.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};