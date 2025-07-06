import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SecureImageDisplay } from "./SecureImageDisplay";
import { PlusCircle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

export interface QueueItem {
  person_url: string;
  garment_url: string;
  appendix?: string;
}

interface VtoReviewQueueProps {
  queue: QueueItem[];
}

export const VtoReviewQueue = ({ queue }: VtoReviewQueueProps) => {
  const { t } = useLanguage();

  if (queue.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <p>{t('queueEmpty')}</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('generationQueue')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-96">
          <div className="space-y-2 pr-4">
            {queue.map((item, index) => (
              <div key={index} className="flex gap-2 items-center bg-muted p-2 rounded-md">
                <div className="w-16 h-16 rounded-md overflow-hidden flex-shrink-0">
                  <SecureImageDisplay imageUrl={item.person_url} alt="Person" />
                </div>
                <PlusCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div className="w-16 h-16 rounded-md overflow-hidden flex-shrink-0">
                  <SecureImageDisplay imageUrl={item.garment_url} alt="Garment" />
                </div>
                {item.appendix && (
                  <p className="text-xs text-muted-foreground flex-1 truncate italic">"{item.appendix}"</p>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};