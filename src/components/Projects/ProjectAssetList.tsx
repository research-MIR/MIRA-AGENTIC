import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { showError, showSuccess } from "@/utils/toast";
import { PackCard } from "./PackCard";
import { AddPackModal } from "./AddPackModal";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "./EmptyState";
import { Users, Shirt } from "lucide-react";

interface Pack {
  pack_id: string;
  pack_name: string;
  pack_description: string | null;
  total_jobs?: number;
  unique_garment_count?: number;
  created_at: string;
  total_models?: number;
  female_models?: number;
  male_models?: number;
  upscaled_poses?: number;
}

interface ProjectAssetListProps {
  projectId: string;
  packType: 'model' | 'garment' | 'vto';
}

export const ProjectAssetList = ({ projectId, packType }: ProjectAssetListProps) => {
  const { supabase } = useSession();
  const queryClient = useQueryClient();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const rpcName = {
    model: 'get_model_packs_for_project',
    garment: 'get_garment_packs_for_project',
    vto: 'get_vto_packs_for_project',
  }[packType];

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

  const emptyStateConfig = {
    model: { icon: <Users size={48} />, title: "No Model Packs", description: "Link model packs to this project to organize your generated models.", buttonText: "Add Model Pack" },
    garment: { icon: <Shirt size={48} />, title: "No Garment Packs", description: "Link garment packs to this project to organize your wardrobe items.", buttonText: "Add Garment Pack" },
    vto: { icon: <Shirt size={48} />, title: "No VTO Packs", description: "Link VTO packs to this project to organize your virtual try-on jobs.", buttonText: "Add VTO Pack" },
  }[packType];

  return (
    <>
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add {packType === 'model' ? 'Model' : packType === 'garment' ? 'Garment' : 'VTO'} Pack
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
          <EmptyState 
            {...emptyStateConfig}
            onButtonClick={() => setIsAddModalOpen(true)}
          />
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