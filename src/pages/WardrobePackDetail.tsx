import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Shirt, Plus, ArrowLeft, Trash2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { showError, showSuccess } from "@/utils/toast";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";
import { AddGarmentsModal } from "@/components/Wardrobe/AddGarmentsModal";

interface Garment {
  id: string;
  name: string;
  storage_path: string;
}

const WardrobePackDetail = () => {
  const { packId } = useParams();
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const { data: pack, isLoading: isLoadingPack } = useQuery({
    queryKey: ['garmentPack', packId],
    queryFn: async () => {
      if (!packId) return null;
      const { data, error } = await supabase.from('mira-agent-garment-packs').select('*').eq('id', packId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!packId,
  });

  const { data: garments, isLoading: isLoadingGarments, error } = useQuery<Garment[]>({
    queryKey: ['garmentsInPack', packId],
    queryFn: async () => {
      if (!packId) return [];
      const { data, error } = await supabase.rpc('get_garments_for_pack', { p_pack_id: packId });
      if (error) throw error;
      return data;
    },
    enabled: !!packId,
  });

  const handleRemoveGarment = async (garmentId: string) => {
    try {
      const { error } = await supabase.from('mira-agent-garment-pack-items').delete().eq('pack_id', packId).eq('garment_id', garmentId);
      if (error) throw error;
      showSuccess("Garment removed from pack.");
      queryClient.invalidateQueries({ queryKey: ['garmentsInPack', packId] });
    } catch (err: any) {
      showError(`Failed to remove garment: ${err.message}`);
    }
  };

  if (isLoadingPack) {
    return <div className="p-8"><Skeleton className="h-12 w-1/3" /><Skeleton className="mt-4 h-64 w-full" /></div>;
  }

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <Link to="/wardrobe-packs" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="h-4 w-4" />
            Back to All Packs
          </Link>
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold">{pack?.name || "Loading..."}</h1>
            <Button onClick={() => setIsAddModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Garments
            </Button>
          </div>
          <p className="text-muted-foreground mt-1">{pack?.description}</p>
        </header>

        {isLoadingGarments ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[...Array(12)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)}
          </div>
        ) : error ? (
          <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>
        ) : garments && garments.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {garments.map(garment => (
              <Card key={garment.id} className="overflow-hidden group relative">
                <CardContent className="p-0">
                  <div className="aspect-square bg-muted">
                    <SecureImageDisplay imageUrl={garment.storage_path} alt={garment.name} />
                  </div>
                  <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => handleRemoveGarment(garment.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <Shirt className="mx-auto h-16 w-16 text-muted-foreground" />
            <h2 className="mt-4 text-xl font-semibold">This pack is empty</h2>
            <p className="mt-2 text-muted-foreground">Click "Add Garments" to start building your collection.</p>
          </div>
        )}
      </div>
      <AddGarmentsModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        packId={packId!}
        existingGarmentIds={garments?.map(g => g.id) || []}
      />
    </>
  );
};

export default WardrobePackDetail;