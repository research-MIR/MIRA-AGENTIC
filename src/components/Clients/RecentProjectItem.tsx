import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Link } from "react-router-dom";

interface RecentProjectItemProps {
  project: {
    id: string;
    name: string;
    code: string;
    status: 'completato' | 'in elaborazione' | 'attivo';
    productCount: number;
    progress: number;
  };
}

export const RecentProjectItem = ({ project }: RecentProjectItemProps) => {
  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'completato': return 'default';
      case 'in elaborazione': return 'secondary';
      case 'attivo': return 'outline';
      default: return 'secondary';
    }
  };

  return (
    <Link to={`/projects/${project.id}`} className="block p-4 rounded-lg hover:bg-muted">
      <div className="flex justify-between items-center mb-2">
        <div>
          <p className="font-semibold">{project.name}</p>
          <p className="text-xs text-muted-foreground">{project.code}</p>
        </div>
        <Badge variant={getStatusVariant(project.status)}>{project.status}</Badge>
      </div>
      <div className="flex items-center gap-4">
        <Progress value={project.progress} className="h-2" />
        <span className="text-sm font-medium">{project.progress}%</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{project.productCount} prodotti</p>
    </Link>
  );
};