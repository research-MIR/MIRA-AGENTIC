import { useInfiniteQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare, Bot, Shirt } from "lucide-react";
import { formatDistanceToNow } from 'date-fns';
import { Link } from "react-router-dom";

interface Activity {
  id: string;
  activity_type: string;
  details: {
    title: string;
    job_id?: string;
    pack_id?: string;
    project_name: string;
    project_id: string;
  };
  created_at: string;
}

const ActivityIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'chat_added': return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
    case 'model_generation_started': return <Bot className="h-4 w-4 text-muted-foreground" />;
    case 'vto_job_started': return <Shirt className="h-4 w-4 text-muted-foreground" />;
    default: return null;
  }
};

const ActivityItem = ({ activity }: { activity: Activity }) => {
  const { title, job_id, project_name, project_id } = activity.details;

  const renderContent = () => {
    switch (activity.activity_type) {
      case 'chat_added':
        return <p>New chat <Link to={`/chat/${job_id}`} className="font-semibold text-primary hover:underline">"{title}"</Link> was added to project <Link to={`/projects/${project_id}`} className="font-semibold text-primary hover:underline">{project_name}</Link>.</p>;
      case 'model_generation_started':
        return <p>Started model generation "{title}" in project <Link to={`/projects/${project_id}`} className="font-semibold text-primary hover:underline">{project_name}</Link>.</p>;
      case 'vto_job_started':
        return <p>Started VTO job for "{title}" in project <Link to={`/projects/${project_id}`} className="font-semibold text-primary hover:underline">{project_name}</Link>.</p>;
      default:
        return <p>An unknown activity occurred.</p>;
    }
  };

  return (
    <div className="flex items-start gap-3">
      <div className="mt-1"><ActivityIcon type={activity.activity_type} /></div>
      <div className="flex-1">
        <div className="text-sm">{renderContent()}</div>
        <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}</p>
      </div>
    </div>
  );
};

export const ClientActivityFeed = ({ clientId }: { clientId: string }) => {
  const { supabase, session } = useSession();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery<Activity[]>({
    queryKey: ['clientActivity', clientId],
    queryFn: async ({ pageParam = 0 }) => {
      const { data, error } = await supabase.rpc('get_client_activity', {
        p_client_id: clientId,
        p_user_id: session!.user.id,
        p_limit: 10,
        p_offset: pageParam * 10,
      });
      if (error) throw error;
      return data || [];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => lastPage.length === 10 ? allPages.length : undefined,
    enabled: !!clientId && !!session?.user,
  });

  const activities = data?.pages.flatMap(page => page) ?? [];

  if (isLoading) return <div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (activities.length === 0) return <p className="text-sm text-muted-foreground text-center py-4">No activity yet.</p>;

  return (
    <div className="space-y-4">
      {activities.map(activity => <ActivityItem key={activity.id} activity={activity} />)}
      {hasNextPage && (
        <Button variant="outline" className="w-full" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Load More
        </Button>
      )}
    </div>
  );
};