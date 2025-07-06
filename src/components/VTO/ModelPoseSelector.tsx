import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SecureImageDisplay } from './SecureImageDisplay';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface Pose {
  final_url: string;
  is_upscaled?: boolean;
}

interface PoseWithPack extends Pose {
  packId: string;
  packName: string;
}

interface ModelPoseSelectorProps {
  mode: 'single' | 'multiple';
  selectedUrls: Set<string>;
  onSelect: (url: string) => void;
}

export const ModelPoseSelector = ({ mode, selectedUrls, onSelect }: ModelPoseSelectorProps) => {
  const { supabase, session } = useSession();

  const { data: posesByPack, isLoading, error } = useQuery<Record<string, PoseWithPack[]>>({
    queryKey: ['upscaledModelPosesByPack', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return {};
      const { data, error } = await supabase
        .from('mira-agent-model-generation-jobs')
        .select('final_posed_images, pack_id, mira-agent-model-packs ( name )')
        .eq('user_id', session.user.id)
        .eq('status', 'complete')
        .not('final_posed_images', 'is', null);
      
      if (error) throw error;

      const allPoses = data
        .flatMap(job => {
            const packName = (job['mira-agent-model-packs'] as { name: string })?.name || 'Uncategorized';
            return (job.final_posed_images || [])
                .filter(pose => pose.is_upscaled)
                .map(pose => ({ ...pose, packId: job.pack_id, packName }));
        });
      
      const uniquePoses = Array.from(new Map(allPoses.map(pose => [pose.final_url, pose])).values());

      const grouped: Record<string, PoseWithPack[]> = {};
      for (const pose of uniquePoses) {
          if (!grouped[pose.packName]) {
              grouped[pose.packName] = [];
          }
          grouped[pose.packName].push(pose);
      }
      
      return grouped;
    },
    enabled: !!session?.user,
  });

  const handleSelect = (url: string) => {
    onSelect(url);
  };

  if (isLoading) {
    return <div className="grid grid-cols-3 gap-2"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>;
  }

  if (error) {
    return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>;
  }

  if (!posesByPack || Object.keys(posesByPack).length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">No upscaled models found in your packs.</p>;
  }

  return (
    <ScrollArea className="h-96">
      <Accordion type="multiple" defaultValue={Object.keys(posesByPack || {})}>
        {Object.entries(posesByPack).map(([packName, poses]) => (
          <AccordionItem value={packName} key={packName}>
            <AccordionTrigger>{packName} ({poses.length})</AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-3 md:grid-cols-4 gap-2 pr-4">
                {poses.map((pose, index) => {
                  const isSelected = selectedUrls.has(pose.final_url);
                  return (
                    <button key={index} onClick={() => handleSelect(pose.final_url)} className="relative aspect-square block w-full h-full group">
                      <SecureImageDisplay imageUrl={pose.final_url} alt={`Model pose ${index + 1}`} />
                      {isSelected && (
                        <div className="absolute inset-0 bg-primary/70 flex items-center justify-center rounded-md">
                          <CheckCircle className="h-8 w-8 text-primary-foreground" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </ScrollArea>
  );
};