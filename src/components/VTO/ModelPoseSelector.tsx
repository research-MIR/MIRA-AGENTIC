import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SecureImageDisplay } from './SecureImageDisplay';

interface Pose {
  final_url: string;
  is_upscaled?: boolean;
}

interface ModelPoseSelectorProps {
  selectedUrl: string | null;
  onSelect: (url: string) => void;
}

export const ModelPoseSelector = ({ selectedUrl, onSelect }: ModelPoseSelectorProps) => {
  const { supabase, session } = useSession();

  const { data: poses, isLoading, error } = useQuery<Pose[]>({
    queryKey: ['upscaledModelPoses', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-model-generation-jobs')
        .select('final_posed_images')
        .eq('user_id', session.user.id)
        .eq('status', 'complete');
      
      if (error) throw error;

      const allPoses = data
        .flatMap(job => job.final_posed_images || [])
        .filter(pose => pose.is_upscaled);
      
      const uniquePoses = Array.from(new Map(allPoses.map(pose => [pose.final_url, pose])).values());
      
      return uniquePoses;
    },
    enabled: !!session?.user,
  });

  if (isLoading) {
    return <div className="grid grid-cols-3 gap-2"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>;
  }

  if (error) {
    return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>;
  }

  if (!poses || poses.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-4">No upscaled models found in your packs.</p>;
  }

  return (
    <ScrollArea className="h-64">
      <div className="grid grid-cols-3 gap-2 pr-4">
        {poses.map((pose, index) => {
          const isSelected = selectedUrl === pose.final_url;
          return (
            <button key={index} onClick={() => onSelect(pose.final_url)} className="relative aspect-square block w-full h-full group">
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
    </ScrollArea>
  );
};