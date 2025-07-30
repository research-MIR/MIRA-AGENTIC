import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { differenceInDays } from 'date-fns';
import { useSecureImage } from "@/hooks/useSecureImage";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageIcon, MessageSquare } from "lucide-react";

interface RecentProjectItemProps {
  project: {
    project_id: string;
    project_name: string;
    project_updated_at: string;
    chat_count: number;
    key_visual_url: string | null;
  };
}

const ImageDisplay = ({ url, alt }: { url: string | null, alt: string }) => {
  const { displayUrl, isLoading } = useSecureImage(url);
  if (isLoading) return <Skeleton className="w-full h-full" />;
  if (!displayUrl) return <div className="w-full h-full bg-muted flex items-center justify-center"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
  return <img src={displayUrl} alt={alt} className="w-full h-full object-cover" />;
};

export const RecentProjectItem = ({ project }: RecentProjectItemProps) => {
  const daysSinceUpdate = differenceInDays(new Date(), new Date(project.project_updated_at));
  const status = daysSinceUpdate <= 7 ? 'Active' : 'Idle';

  return (
    <Link to={`/projects/${project.project_id}`} className="block p-3 rounded-lg hover:bg-muted border">
      <div className="flex gap-4">
        <div className="w-24 h-16 bg-muted rounded-md overflow-hidden flex-shrink-0">
          <ImageDisplay url={project.key_visual_url} alt={project.project_name} />
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="flex justify-between items-start">
            <p className="font-semibold truncate pr-2">{project.project_name}</p>
            <Badge variant={status === 'Active' ? 'default' : 'secondary'}>{status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
            <MessageSquare className="h-3 w-3" />
            {project.chat_count} chats
          </p>
        </div>
      </div>
    </Link>
  );
};