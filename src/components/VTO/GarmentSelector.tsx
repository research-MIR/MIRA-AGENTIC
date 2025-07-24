import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle, Loader2, Shirt } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { cn } from '@/lib/utils';
import { SecureImageDisplay } from './SecureImageDisplay';

interface Garment {
  id: string;
  name: string;
  storage_path: string;
  attributes: any;
}

interface GarmentSelectorProps {
  onSelect: (garments: Garment[]) => void;
  children: React.ReactNode; // For the upload tab
  multiSelect?: boolean;
}

export const GarmentSelector = ({ onSelect, children, multiSelect = true }: GarmentSelectorProps) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: garments, isLoading, error } = useQuery<Garment[]>({
    queryKey: ['wardrobeGarments', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-garments').select('*').eq('user_id', session.user.id);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const toggleSelection = (garment: Garment) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(garment.id)) {
        newSet.delete(garment.id);
      } else {
        if (!multiSelect) {
          newSet.clear();
        }
        newSet.add(garment.id);
      }
      return newSet;
    });
  };

  const handleAddSelected = () => {
    const selectedGarments = garments?.filter(g => selectedIds.has(g.id)) || [];
    onSelect(selectedGarments);
    setSelectedIds(new Set());
  };

  return (
    <Tabs defaultValue="upload">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="upload">{t('uploadNew')}</TabsTrigger>
        <TabsTrigger value="wardrobe">{t('selectFromWardrobe')}</TabsTrigger>
      </TabsList>
      <TabsContent value="upload" className="pt-4">
        {children}
      </TabsContent>
      <TabsContent value="wardrobe" className="pt-4">
        <div className="space-y-4">
          <ScrollArea className="h-48 border rounded-md">
            {isLoading ? (
              <div className="grid grid-cols-4 gap-2 p-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
            ) : error ? (
              <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>
            ) : !garments || garments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <p className="text-sm font-semibold">{t('wardrobeIsEmpty')}</p>
                <p className="text-xs text-muted-foreground">{t('wardrobeIsEmptyDesc')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2 p-2">
                {garments.map(garment => {
                  const isSelected = selectedIds.has(garment.id);
                  return (
                    <button key={garment.id} onClick={() => toggleSelection(garment)} className="relative aspect-square block w-full h-full group">
                      <SecureImageDisplay imageUrl={garment.storage_path} alt={garment.name} />
                      {isSelected && (
                        <div className="absolute inset-0 bg-primary/70 flex items-center justify-center rounded-md">
                          <CheckCircle className="h-8 w-8 text-primary-foreground" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
          <Button className="w-full" onClick={handleAddSelected} disabled={selectedIds.size === 0}>
            {t('addSelected')} ({selectedIds.size})
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
};