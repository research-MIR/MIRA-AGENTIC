import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, Layers } from "lucide-react";
import { BitStudioJob } from "@/types/vto";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";
import { useState } from "react";
import { ImageCompareModal } from "@/components/ImageCompareModal";

interface VtoJobCardProps {
  job: BitStudioJob;
  onRemove: (jobId: string) => void;
}

export const VtoJobCard = ({ job, onRemove }: VtoJobCardProps) => {
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  return (
    <>
      <Card className="group relative">
        <CardContent className="p-2">
          <div className="aspect-square bg-muted rounded-md overflow-hidden">
            <SecureImageDisplay imageUrl={job.final_image_url} alt={`VTO Job ${job.id}`} />
          </div>
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <Button size="sm" onClick={() => setIsCompareModalOpen(true)}>
              <Layers className="mr-2 h-4 w-4" />
              Compare
            </Button>
          </div>
        </CardContent>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => onRemove(job.id)}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </Card>
      {isCompareModalOpen && job.source_person_image_url && job.final_image_url && (
        <ImageCompareModal
          isOpen={isCompareModalOpen}
          onClose={() => setIsCompareModalOpen(false)}
          beforeUrl={job.source_person_image_url}
          afterUrl={job.final_image_url}
        />
      )}
    </>
  );
};