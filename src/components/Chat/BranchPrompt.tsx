import { Button } from "@/components/ui/button";
import { GitBranch } from "lucide-react";

interface BranchPromptProps {
  onBranch: () => void;
}

export const BranchPrompt = ({ onBranch }: BranchPromptProps) => {
  return (
    <div className="p-4 text-center text-sm text-muted-foreground bg-muted/50 border-t">
      <p className="mb-2">This is a shared, read-only chat.</p>
      <Button onClick={onBranch}>
        <GitBranch className="mr-2 h-4 w-4" />
        Branch from here to continue chatting
      </Button>
    </div>
  );
};