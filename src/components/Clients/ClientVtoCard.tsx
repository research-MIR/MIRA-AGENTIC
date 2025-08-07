import { Card, CardContent } from "@/components/ui/card";
import { Shirt } from "lucide-react";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Skeleton } from "@/components/ui/skeleton";

interface VtoJob {
  job_id: string;
  final_image_url: string | null;
  project_name: string;
}

const ImageDisplay = ({ url }: { url: string | null }) => {
  const { displayUrl, isLoading } = useSecureImage(url);
  if (isLoading) return <Skeleton className="w-full h-full" />;
  if (!displayUrl) return <div className="w-full h-full bg-muted flex items-center justify-center"><Shirt className="h-10 w-10 text-muted-foreground" /></div>;
  return <img src={displayUrl} alt="VTO Result" className="w-full h-full object-cover" />;
};

export const ClientVtoCard = ({ job }: { job: VtoJob }) => {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="aspect-square">
          <ImageDisplay url={job.final_image_url} />
        </div>
        <div className="p-2 border-t">
          <p className="text-xs text-muted-foreground">Project: {job.project_name}</p>
        </div>
      </CardContent>
    </Card>
  );
};