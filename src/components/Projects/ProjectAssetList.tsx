import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Plus, Loader2 } from 'lucide-react';
import { showError, showSuccess } from '@/utils/toast';
import { PackCard } from './PackCard';
import { AddPackModal } from './AddPackModal';
import { Skeleton } from '@/components/ui/skeleton';

interface Pack {
  pack_id: string;
  pack_name: string;
  pack_description: string | null;
}

interface ProjectAssetListProps {
  projectId: string;
  packType: 'model' | 'garment';
}

export const ProjectAssetList = ({ projectId, packType }: ProjectAssetListProps) => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const rpcName = packType === 'model' ? 'get_model_packs_for_project' : 'get_garment_packs_for_project';
  const linkTableName = packType === 'model' ? 'project_model_packs' : 'project_garment_packs';
  const linkColumnName = packType === 'model' ? 'model_pack_id' : 'garment_pack_id';
  const queryKey = `project${packType}Packs`;

  const { data: packs, isLoading } = useQuery<Pack[]>({
    queryKey: [queryKey, projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(rpcName, { p_project_id: projectId });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const handleRemove = async (packId: string) => {
    try {
      const { error } = await supabase.from(linkTableName).delete().eq('project_id', projectId).eq(linkColumnName, packId);
      if (error) throw error;
      showSuccess("Pack unlinked from project.");
      queryClient.invalidateQueries({ queryKey: [queryKey, projectId] });
    } catch (err: any) {
      showError(`Failed to remove pack: ${err.message}`);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add {packType === 'model' ? 'Model' : 'Garment'} Pack
          </Button>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : packs && packs.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {packs.map(pack => (
              <PackCard key={pack.pack_id} pack={pack} packType={packType} onRemove={handleRemove} />
            ))}
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">No {packType} packs linked to this project yet.</p>
        )}
      </div>
      <AddPackModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        projectId={projectId}
        packType={packType}
        existingPackIds={packs?.map(p => p.pack_id) || []}
      />
    </>
  );
};