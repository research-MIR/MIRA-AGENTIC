import { Card, CardContent } from "@/components/ui/card";
import { Plus } from "lucide-react";

interface NewClientCardProps {
  onClick: () => void;
}

export const NewClientCard = ({ onClick }: NewClientCardProps) => {
  return (
    <button onClick={onClick} className="w-full h-full">
      <Card className="border-dashed h-full hover:border-primary hover:text-primary transition-all duration-200">
        <CardContent className="p-4 flex flex-col items-center justify-center h-full">
          <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center mb-2">
            <Plus className="h-6 w-6" />
          </div>
          <p className="font-semibold">New Client</p>
          <p className="text-sm text-muted-foreground">Create a new client to start</p>
        </CardContent>
      </Card>
    </button>
  );
};