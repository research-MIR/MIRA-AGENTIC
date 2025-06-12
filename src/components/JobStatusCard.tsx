import { Card, CardContent } from "@/components/ui/card";
import { Bot, Loader2 } from "lucide-react";

interface JobStatusCardProps {
  message: string;
}

export const JobStatusCard = ({ message }: JobStatusCardProps) => {
  return (
    <Card className="max-w-lg bg-secondary/50">
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary rounded-full text-primary-foreground">
            <Bot size={20} />
          </div>
          <div className="flex-1">
            <p className="font-semibold">Working on it...</p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{message}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};