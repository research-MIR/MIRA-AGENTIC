import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SecureImageDisplay } from './SecureImageDisplay';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '../ui/button';

interface Pose {
  final_url: string;
  is_upscaled?: boolean;
}

interface ModelPack {
  id: string;
  name: string;
}

interface ModelPoseSelectorProps {
  mode: 'single' | 'multiple' | 'get-all';
  selectedUrls?: Set<string>;
  onSelect?: (url: string) => void;
  onUseEntirePack?: (poses: Pose[]) => void;
}

export const ModelPoseSelector = ({ mode, selectedUrls, onSelect, onUseEntirePack }: ModelPoseSelectorProps) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const [selectedPackId, setSelectedPackId] = useState<string>('all');

  const { data: packs, isLoading: isLoadingPacks } = useQuery<ModelPack[]>({
    queryKey: ['modelPacks', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-model-packs').select('id, name').eq('user_id', session.user.id);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const { data: poses, isLoading, error } = useQuery<Pose[]>({
    queryKey: ['upscaledModelPoses', session?.user?.id, selectedPackId],
    queryFn: async () => {
      if (!session?.user) return [];
      let query = supabase
        .from('mira-agent-model-generation-jobs')
        .select('final_posed_images')
        .eq('user_id', session.user.id)
        .eq('status', 'complete');
      
      if (selectedPackId !== 'all') {
        query = query.eq('pack_id', selectedPackId);
      }

      const { data, error } = await query;
      
      if (error) throw error;

      const allPoses = data
        .flatMap(job => job.final_posed_images || [])
        .filter(pose => pose.is_upscaled);
      
      const uniquePoses = Array.from(new Map(allPoses.map(pose => [pose.final_url, pose])).values());
      
      return uniquePoses;
    },
    enabled: !!session?.user,
  });

  const handleSelect = (url: string) => {
    if (onSelect) {
      onSelect(url);
    }
  };

  if (mode === 'get-all') {
    return (
      <div className="flex items-center gap-2">
        <Select value={selectedPackId} onValueChange={setSelectedPackId} disabled={isLoadingPacks}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select a pack..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allPacks')}</SelectItem>
            {packs?.map(pack => (
              <SelectItem key={pack.id} value={pack.id}>{pack.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={() => onUseEntirePack?.(poses || [])} disabled={isLoading || !poses || poses.length === 0}>
          {t('useEntirePack')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Label htmlFor="pack-filter" className="whitespace-nowrap">{t('filterByPack')}:</Label>
        <Select value={selectedPackId} onValueChange={setSelectedPackId} disabled={isLoadingPacks}>
          <SelectTrigger id="pack-filter">
            <SelectValue placeholder="Select a pack..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allPacks')}</SelectItem>
            {packs?.map(pack => (
              <SelectItem key={pack.id} value={pack.id}>{pack.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <div className="grid grid-cols-3 gap-2"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>
      ) : error ? (
        <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>
      ) : !poses || poses.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No upscaled models found in this pack.</p>
      ) : (
        <ScrollArea className="h-96">
          <div className="grid grid-cols-3 md:grid-cols-4 gap-2 pr-4">
            {poses.map((pose, index) => {
              const isSelected = selectedUrls?.has(pose.final_url);
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
        </ScrollArea>
      )}
    </div>
  );
};