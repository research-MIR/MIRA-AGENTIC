import { useLanguage } from '@/context/LanguageContext';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { SecureImageDisplay } from './SecureImageDisplay';
import { VtoModel, ModelPack, AnalyzedGarment } from '@/types/vto';
import { isPoseCompatible } from '@/lib/vto-utils';

interface ModelPoseSelectorProps {
  mode: 'single' | 'multiple' | 'get-all';
  selectedUrls?: Set<string>;
  onSelect?: (urls: string[]) => void;
  onUseEntirePack?: (models: VtoModel[]) => void;
  models: VtoModel[];
  isLoading: boolean;
  error: Error | null;
  packs: ModelPack[] | undefined;
  isLoadingPacks: boolean;
  selectedPackId: string;
  setSelectedPackId: (id: string) => void;
  garmentFilter?: AnalyzedGarment | null;
  isStrict: boolean;
}

export const ModelPoseSelector = ({
  mode,
  selectedUrls,
  onSelect,
  onUseEntirePack,
  models,
  isLoading,
  error,
  packs,
  isLoadingPacks,
  selectedPackId,
  setSelectedPackId,
  garmentFilter,
  isStrict,
}: ModelPoseSelectorProps) => {
  const { t } = useLanguage();

  const handleSelect = (model: VtoModel) => {
    if (onSelect) {
      const poseUrls = model.poses.map(p => p.final_url);
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
              const { compatible, reason } = isPoseCompatible(garmentFilter, model, isStrict);
              const isSelected = model.poses.length > 0 && model.poses.some(p => selectedUrls?.has(p.final_url));
              
              return (
                <button 
                  key={model.jobId} 
                  onClick={() => handleSelect(model)} 
                  disabled={!compatible}
                  className={cn(
                    "relative aspect-square block w-full h-full group",
                    !compatible && "opacity-50 cursor-not-allowed"
                  )}
                  title={!compatible ? reason : `Select model ${model.jobId}`}
                >
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