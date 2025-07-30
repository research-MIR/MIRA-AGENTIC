import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { StatCard } from "@/components/Clients/StatCard";
import { MessageSquare, Bot, Shirt, FolderGit2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface ProjectDashboardProps {
  projectId: string;
}

export const ProjectDashboard = ({ projectId }: ProjectDashboardProps) => {
  const { supabase, session } = useSession();

  const { data: stats, isLoading } = useQuery({
    queryKey: ['projectDashboardStats', projectId, session?.user?.id],
    queryFn: async () => {
      if (!projectId || !session?.user) return null;
      const { data, error } = await supabase.rpc('get_project_dashboard_stats', { p_project_id: projectId, p_user_id: session.user.id }).single();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId && !!session?.user,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <StatCard title="Total Chats" value={stats?.chat_count ?? 0} icon={<MessageSquare className="h-6 w-6 text-muted-foreground" />} />
      <StatCard title="Total Models" value={stats?.model_count ?? 0} icon={<Bot className="h-6 w-6 text-muted-foreground" />} />
      <StatCard title="Total Garments" value={stats?.garment_count ?? 0} icon={<Shirt className="h-6 w-6 text-muted-foreground" />} />
      <StatCard title="Total VTO Jobs" value={stats?.vto_job_count ?? 0} icon={<FolderGit2 className="h-6 w-6 text-muted-foreground" />} />
    </div>
  );
};