import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle, Loader2, Users, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Pack {
  id: string;
  name?: string;
  pack_id?: string; // From RPC
  pack_name?: string; // From RPC
  metadata?: { name?: string };
  created_at?: string;
  total_jobs?: number;
  unique_garment_count?: number;
  total_models?: number;
  female_models?: number;
  male_models?: number;
  upscaled_poses?: number;
}

interface AddPackModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  packType: 'model' | 'garment' | 'vto';
  existingPackIds: string[];
}

export const AddPackModal = ({ isOpen, onClose, projectId, packType, existingPackIds }: AddPackModalProps) => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  const linkTableName = {
    model: 'project_model_packs',
    garment: 'project_garment_packs',
    vto: 'project_vto_packs',
  }[packType];

  const linkColumnName = {
    model: 'model_pack_id',
    garment: 'garment_pack_id',
    vto: 'vto_pack_job_id',
  }[packType];

  const queryKey = `project${packType}Packs`;

  const { data: availablePacks, isLoading } = useQuery<Pack[]>({
    queryKey: ['availablePacks', packType, session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];

      if (packType === 'vto') {
        const { data, error } = await supabase.rpc('get_vto_pack_summaries', { p_user_id: session.user.id });
        if (error) throw error;
        const mappedData = data.map((p: any) => ({
          id: p.pack_id,
          name: p.metadata?.name,
          created_at: p.created_at,
          total_jobs: p.total_jobs,
          unique_garment_count: p.unique_garment_count,
        }));
        return mappedData.filter((p: Pack) => !existingPackIds.includes(p.id));
      }
      
      if (packType === 'model') {
        const { data, error } = await supabase.rpc('get_user_model_pack_summaries', { p_user_id: session.user.id });
        if (error) throw error;
        // The RPC returns pack_id, pack_name, etc. We need to map them to a consistent 'id' and 'name'
        const mappedData = data.map((p: any) => ({ ...p, id: p.pack_id, name: p.pack_name }));
        return mappedData.filter((p: Pack) => !existingPackIds.includes(p.id));
      }

      // Fallback for garment packs
      const tableName = 'mira-agent-garment-packs';
      const selectString = 'id, name';
      const { data, error } = await supabase.from(tableName).select(selectString).eq('user_id', session.user.id);
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
      queryClient.invalidateQueries({ queryKey: [queryKey, projectId] });
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
          <DialogTitle>Add {packType === 'model' ? 'Model' : packType === 'garment' ? 'Garment' : 'VTO'} Packs</DialogTitle>
          <DialogDescription>Select from your existing packs to link them to this project.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-96 my-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pr-4">
            {isLoading ? (
              [...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
            ) : availablePacks && availablePacks.length > 0 ? (
              availablePacks.map(pack => {
                const isSelected = selectedIds.has(pack.id);
                const packName = pack.name || pack.metadata?.name || `Pack ${pack.id.substring(0, 8)}`;
                return (
                  <div key={pack.id} onClick={() => toggleSelection(pack.id)} className={cn("p-4 border rounded-md cursor-pointer relative", isSelected && "border-primary")}>
                    <p className="font-semibold truncate">{packName}</p>
                    {packType === 'vto' && pack.created_at && (
                        <div className="text-xs text-muted-foreground mt-2 space-y-1">
                            <p>Created: {new Date(pack.created_at).toLocaleDateString()}</p>
                            <div className="flex items-center gap-4">
                                <span>{pack.total_jobs} images</span>
                                <span>{pack.unique_garment_count} garments</span>
                            </div>
                        </div>
                    )}
                    {packType === 'model' && (
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground border-t pt-2">
                        <div className="flex items-center gap-1" title="Total Models"><Users className="h-3 w-3" /><span>{pack.total_models}</span></div>
                        <div className="flex items-center gap-1" title="Female Models"><span>♀</span><span>{pack.female_models}</span></div>
                        <div className="flex items-center gap-1" title="Male Models"><span>♂</span><span>{pack.male_models}</span></div>
                        <div className="flex items-center gap-1" title="Upscaled Poses"><Bot className="h-3 w-3" /><span>{pack.upscaled_poses}</span></div>
                      </div>
                    )}
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