import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  buttonText: string;
  onButtonClick: () => void;
}

export const EmptyState = ({ icon, title, description, buttonText, onButtonClick }: EmptyStateProps) => {
  return (
    <div className="text-center py-16 flex flex-col items-center justify-center h-full">
      <div className="mx-auto h-12 w-12 text-muted-foreground">{icon}</div>
      <h2 className="mt-4 text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-muted-foreground max-w-xs">{description}</p>
      <Button className="mt-6" onClick={onButtonClick}>
        <Plus className="mr-2 h-4 w-4" />
        {buttonText}
      </Button>
    </div>
  );
};