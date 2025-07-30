import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router-dom";
import { differenceInDays } from 'date-fns';

interface RecentProjectItemProps {
  project: {
    project_id: string;
    project_name: string;
    project_updated_at: string;
    chat_count: number;
  };
}

export const RecentProjectItem = ({ project }: RecentProjectItemProps) => {
  const daysSinceUpdate = differenceInDays(new Date(), new Date(project.project_updated_at));
  const status = daysSinceUpdate <= 7 ? 'attivo' : 'in elaborazione';
  const progress = (project.chat_count * 10) % 101; // Placeholder progress

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'completato': return 'default';
      case 'in elaborazione': return 'secondary';
      case 'attivo': return 'outline';
      default: return 'secondary';
    }
  };

  return (
    <Link to={`/projects/${project.project_id}`} className="block p-4 rounded-lg hover:bg-muted">
      <div className="flex justify-between items-center mb-2">
        <div>
          <p className="font-semibold">{project.project_name}</p>
          <p className="text-xs text-muted-foreground">PRJ-{project.project_id.substring(0, 6)}</p>
        </div>
        <Badge variant={getStatusVariant(status)}>{status}</Badge>
      </div>
      <div className="flex items-center gap-4">
        <Progress value={progress} className="h-2" />
        <span className="text-sm font-medium">{progress}%</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{project.chat_count} prodotti</p>
    </Link>
  );
};