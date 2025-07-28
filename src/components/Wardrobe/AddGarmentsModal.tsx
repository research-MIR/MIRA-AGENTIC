import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SecureImageDisplay } from '@/components/VTO/SecureImageDisplay';

interface Garment {
  id: string;
  name: string;
  storage_path: string;
}

interface AddGarmentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  packId: string;
  existingGarmentIds: string[];
}

export const AddGarmentsModal = ({ isOpen, onClose, packId, existingGarmentIds }: AddGarmentsModalProps) => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  const { data: allGarments, isLoading, error } = useQuery<Garment[]>({
    queryKey: ['allGarmentsForPack', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-garments').select('id, name, storage_path').eq('user_id', session.user.id);
      if (error) throw error;
      return data.filter(g => !existingGarmentIds.includes(g.id));
    },
    enabled: isOpen,
  });

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleAdd = async () => {
    if (selectedIds.size === 0) return;
    setIsAdding(true);
    const toastId = showLoading(`Adding ${selectedIds.size} garments...`);
    try {
      const itemsToInsert = Array.from(selectedIds).map(garment_id => ({ pack_id: packId, garment_id }));
      const { error } = await supabase.from('mira-agent-garment-pack-items').insert(itemsToInsert);
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(`${selectedIds.size} garments added to pack.`);
      queryClient.invalidateQueries({ queryKey: ['garmentsInPack', packId] });
      queryClient.invalidateQueries({ queryKey: ['allGarmentsForPack'] });
      setSelectedIds(new Set());
      onClose();
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to add garments: ${err.message}`);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add Garments to Pack</DialogTitle>
          <DialogDescription>Select garments from your wardrobe to add to this pack.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-96 my-4">
          <div className="grid grid-cols-4 gap-4 pr-4">
            {isLoading ? (
              [...Array(8)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)
            ) : error ? (
              <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>
            ) : allGarments && allGarments.length > 0 ? (
              allGarments.map(garment => {
                const isSelected = selectedIds.has(garment.id);
                return (
                  <div key={garment.id} className="relative cursor-pointer" onClick={() => toggleSelection(garment.id)}>
                    <SecureImageDisplay imageUrl={garment.storage_path} alt={garment.name} />
                    {isSelected && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-md">
                        <CheckCircle className="h-8 w-8 text-white" />
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <p className="col-span-4 text-center text-muted-foreground">Your wardrobe is empty or all items are already in this pack.</p>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAdd} disabled={isAdding || selectedIds.size === 0}>
            {isAdding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add {selectedIds.size} Garment(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};