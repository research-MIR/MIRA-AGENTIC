import { Card, CardContent } from "@/components/ui/card";
import { Shirt } from "lucide-react";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Skeleton } from "@/components/ui/skeleton";

interface Garment {
  garment_id: string;
  garment_name: string;
  storage_path: string;
  project_name: string;
}

const ImageDisplay = ({ url }: { url: string | null }) => {
  const { displayUrl, isLoading } = useSecureImage(url);
  if (isLoading) return <Skeleton className="w-full h-full" />;
  if (!displayUrl) return <div className="w-full h-full bg-muted flex items-center justify-center"><Shirt className="h-10 w-10 text-muted-foreground" /></div>;
  return <img src={displayUrl} alt="Garment" className="w-full h-full object-cover" />;
};

export const ClientGarmentCard = ({ garment }: { garment: Garment }) => {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="aspect-square">
          <ImageDisplay url={garment.storage_path} />
        </div>
        <div className="p-2 border-t">
          <p className="text-xs font-semibold truncate">{garment.garment_name}</p>
          <p className="text-xs text-muted-foreground">Project: {garment.project_name}</p>
        </div>
      </CardContent>
    </Card>
  );
};