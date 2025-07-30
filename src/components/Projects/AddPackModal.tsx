import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Pack {
  id: string;
  name: string;
}

interface AddPackModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  packType: 'model' | 'garment';
  existingPackIds: string[];
}

export const AddPackModal = ({ isOpen, onClose, projectId, packType, existingPackIds }: AddPackModalProps) => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  const tableName = packType === 'model' ? 'mira-agent-model-packs' : 'mira-agent-garment-packs';
  const linkTableName = packType === 'model' ? 'project_model_packs' : 'project_garment_packs';
  const linkColumnName = packType === 'model' ? 'model_pack_id' : 'garment_pack_id';

  const { data: availablePacks, isLoading } = useQuery<Pack[]>({
    queryKey: ['availablePacks', packType, session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from(tableName).select('id, name').eq('user_id', session.user.id);
      if (error) throw error;
      return data.filter(p => !existingPackIds.includes(p.id));
    },
    enabled: isOpen,
  });

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const handleAddPacks = async () => {
    if (selectedIds.size === 0) return;
    setIsAdding(true);
    const toastId = showLoading(`Adding ${selectedIds.size} pack(s)...`);
    try {
      const itemsToInsert = Array.from(selectedIds).map(packId => ({
        project_id: projectId,
        [linkColumnName]: packId,
      }));
      const { error } = await supabase.from(linkTableName).insert(itemsToInsert);
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(`${selectedIds.size} pack(s) added to project.`);
      queryClient.invalidateQueries({ queryKey: [`project${packType}Packs`, projectId] });
      onClose();
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to add packs: ${err.message}`);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add {packType === 'model' ? 'Model' : 'Garment'} Packs</DialogTitle>
          <DialogDescription>Select from your existing packs to link them to this project.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-96 my-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pr-4">
            {isLoading ? (
              [...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
            ) : availablePacks && availablePacks.length > 0 ? (
              availablePacks.map(pack => {
                const isSelected = selectedIds.has(pack.id);
                return (
                  <div key={pack.id} onClick={() => toggleSelection(pack.id)} className={cn("p-4 border rounded-md cursor-pointer relative", isSelected && "border-primary")}>
                    <p className="font-semibold">{pack.name}</p>
                    {isSelected && <CheckCircle className="h-5 w-5 text-primary absolute top-2 right-2" />}
                  </div>
                );
              })
            ) : (
              <p className="col-span-full text-center text-muted-foreground">No other packs available to add.</p>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleAddPacks} disabled={isAdding || selectedIds.size === 0}>
            {isAdding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Selected ({selectedIds.size})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};