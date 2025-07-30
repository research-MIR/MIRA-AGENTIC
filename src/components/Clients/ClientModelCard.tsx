import { Card, CardContent } from "@/components/ui/card";
import { Bot } from "lucide-react";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Skeleton } from "@/components/ui/skeleton";

interface Model {
  model_id: string;
  base_model_image_url: string | null;
  model_description: string;
  project_name: string;
}

const ImageDisplay = ({ url }: { url: string | null }) => {
  const { displayUrl, isLoading } = useSecureImage(url);
  if (isLoading) return <Skeleton className="w-full h-full" />;
  if (!displayUrl) return <div className="w-full h-full bg-muted flex items-center justify-center"><Bot className="h-10 w-10 text-muted-foreground" /></div>;
  return <img src={displayUrl} alt="Model" className="w-full h-full object-cover" />;
};

export const ClientModelCard = ({ model }: { model: Model }) => {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="aspect-square">
          <ImageDisplay url={model.base_model_image_url} />
        </div>
        <div className="p-2 border-t">
          <p className="text-xs font-semibold truncate">{model.model_description}</p>
          <p className="text-xs text-muted-foreground">Project: {model.project_name}</p>
        </div>
      </CardContent>
    </Card>
  );
};