import { Badge } from "@/components/ui/badge";
import { Loader2, Wand2, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

interface PackStatusIndicatorProps {
  status: 'idle' | 'in_progress' | 'failed' | 'complete';
  totalPoses: number;
  upscaledPoses: number;
}

export const PackStatusIndicator = ({ status, totalPoses, upscaledPoses }: PackStatusIndicatorProps) => {
  if (status === 'in_progress') {
    return <Badge variant="secondary"><Loader2 className="mr-2 h-4 w-4 animate-spin" />In Progress</Badge>;
  }

  if (status === 'failed') {
    return <Badge variant="destructive"><XCircle className="mr-2 h-4 w-4" />Failed</Badge>;
  }

  if (status === 'complete') {
    if (totalPoses === 0) {
      return <Badge variant="outline">Ready for Poses</Badge>;
    }
    if (upscaledPoses === totalPoses) {
      return <Badge className="bg-green-600 hover:bg-green-700"><CheckCircle className="mr-2 h-4 w-4" />Ready for VTO ({upscaledPoses}/{totalPoses})</Badge>;
    }
    if (upscaledPoses > 0) {
      return <Badge variant="secondary" className="bg-yellow-500 text-black hover:bg-yellow-600"><AlertTriangle className="mr-2 h-4 w-4" />Almost Ready ({upscaledPoses}/{totalPoses})</Badge>;
    }
    return <Badge variant="default"><Wand2 className="mr-2 h-4 w-4" />Ready for Upscaling ({upscaledPoses}/{totalPoses})</Badge>;
  }

  return null; // Idle or other states don't need a badge
};