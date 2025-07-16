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
}

interface ModelPack {
  id: string;
  name: string;
}

export interface VtoModel {
  jobId: string;
  baseModelUrl: string | null;
  poses: Pose[];
}

interface ModelPoseSelectorProps {
  mode: 'single' | 'multiple' | 'get-all';
  selectedUrls?: Set<string>;
  onSelect?: (urls: string[]) => void;
  onUseEntirePack?: (models: VtoModel[]) => void;
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

  const { data: models, isLoading, error } = useQuery<VtoModel[]>({
    queryKey: ['vtoPackModels', session?.user?.id, selectedPackId],
    queryFn: async () => {
      if (!session?.user) return [];
      let query = supabase
        .from('mira-agent-model-generation-jobs')
        .select('id, base_model_image_url, final_posed_images')
        .eq('user_id', session.user.id)
        .eq('status', 'complete');
      
      if (selectedPackId !== 'all') {
        query = query.eq('pack_id', selectedPackId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return data
        .map(job => ({
          jobId: job.id,
          baseModelUrl: job.base_model_image_url,
          poses: (job.final_posed_images || []).filter((p: any) => p.is_upscaled)
        }))
        .filter(model => model.poses.length > 0);
    },
    enabled: !!session?.user,
  });

  const handleSelect = (poseUrls: string[]) => {
    if (onSelect) {
      onSelect(poseUrls);
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
        <Button onClick={() => onUseEntirePack?.(models || [])} disabled={isLoading || !models || models.length === 0}>
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
      ) : !models || models.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No upscaled models found in this pack.</p>
      ) : (
        <ScrollArea className="h-96">
          <div className="grid grid-cols-3 md:grid-cols-4 gap-2 pr-4">
            {models.map((model) => {
              const isSelected = model.poses.length > 0 && model.poses.some(p => selectedUrls?.has(p.final_url));
              return (
                <button key={model.jobId} onClick={() => handleSelect(model.poses.map(p => p.final_url))} className="relative aspect-square block w-full h-full group">
                  <SecureImageDisplay imageUrl={model.baseModelUrl} alt={`Model ${model.jobId}`} />
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