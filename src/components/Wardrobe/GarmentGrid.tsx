import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Shirt, AlertTriangle, Info } from 'lucide-react';
import { SecureImageDisplay } from '@/components/VTO/SecureImageDisplay';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from '@/components/ui/button';
import { showSuccess } from '@/utils/toast';
import { Card, CardContent } from '@/components/ui/card';

interface Garment {
  id: string;
  name: string;
  storage_path: string;
  attributes: {
    intended_gender: 'male' | 'female' | 'unisex';
    type_of_fit: 'upper body' | 'lower body' | 'full body' | 'upper_body' | 'lower_body' | 'full_body';
    primary_color: string;
    style_tags?: string[];
  } | null;
}

interface GarmentGridProps {
  selectedFolderId: string | null;
}

export const GarmentGrid = ({ selectedFolderId }: GarmentGridProps) => {
  const { supabase, session } = useSession();

  const { data: garments, isLoading, error } = useQuery<Garment[]>({
    queryKey: ['garments', session?.user?.id, selectedFolderId],
    queryFn: async () => {
      if (!session?.user) return [];
      let query = supabase
        .from("mira-agent-garments")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });

      if (selectedFolderId === 'unassigned') {
        query = query.is('folder_id', null);
      } else if (selectedFolderId && selectedFolderId !== 'all') {
        query = query.eq('folder_id', selectedFolderId);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const handleInfoClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    showSuccess("Garment ID copied to clipboard!");
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, garmentId: string) => {
    e.dataTransfer.setData("garmentId", garmentId);
    e.dataTransfer.effectAllowed = "move";
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {[...Array(10)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)}
      </div>
    );
  }

  if (error) {
    return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>;
  }

  if (!garments || garments.length === 0) {
    return (
      <div className="text-center py-16">
        <Shirt className="mx-auto h-16 w-16 text-muted-foreground" />
        <h2 className="mt-4 text-xl font-semibold">No Garments Found</h2>
        <p className="mt-2 text-muted-foreground">This folder is empty. Try uploading some garments or moving them here.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
      {garments.map(garment => (
        <div
          key={garment.id}
          draggable
          onDragStart={(e) => handleDragStart(e, garment.id)}
          className="cursor-grab"
        >
          <Card className="overflow-hidden group relative">
            <CardContent className="p-0">
              <div className="aspect-square bg-muted">
                <SecureImageDisplay imageUrl={garment.storage_path} alt={garment.name} />
              </div>
              <div className="p-2 text-xs space-y-1 border-t">
                <p className="font-semibold truncate">{garment.name}</p>
                {garment.attributes && (
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline" className="capitalize">{garment.attributes.intended_gender}</Badge>
                    <Badge variant="secondary" className="capitalize">{garment.attributes.type_of_fit.replace(/_/g, ' ')}</Badge>
                  </div>
                )}
              </div>
            </CardContent>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute bottom-1 left-1 h-6 w-6 z-10 bg-black/50 hover:bg-black/70 text-white hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => handleInfoClick(e, garment.id)}
                  >
                    <Info className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" onClick={(e) => e.stopPropagation()}>
                  <p className="text-xs">Click to copy Garment ID</p>
                  <p className="text-xs font-mono max-w-xs break-all">{garment.id}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Card>
        </div>
      ))}
    </div>
  );
};