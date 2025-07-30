import { useInfiniteQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare, FileText, CalendarCheck } from "lucide-react";
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";

interface Activity {
  id: string;
  activity_type: 'chat_added' | 'note_created' | 'deadline_created';
  details: {
    title: string;
    job_id?: string;
    due_date?: string;
  };
  created_at: string;
}

const ActivityIcon = ({ type }: { type: Activity['activity_type'] }) => {
  switch (type) {
    case 'chat_added': return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
    case 'note_created': return <FileText className="h-4 w-4 text-muted-foreground" />;
    case 'deadline_created': return <CalendarCheck className="h-4 w-4 text-muted-foreground" />;
    default: return null;
  }
};

const ActivityItem = ({ activity }: { activity: Activity }) => {
  const renderContent = () => {
    switch (activity.activity_type) {
      case 'chat_added':
        return (
          <p>
            New chat <Link to={`/chat/${activity.details.job_id}`} className="font-semibold text-primary hover:underline">"{activity.details.title}"</Link> was added.
          </p>
        );
      case 'note_created':
        return <p>Note <span className="font-semibold">"{activity.details.title}"</span> was created.</p>;
      case 'deadline_created':
        return <p>Deadline <span className="font-semibold">"{activity.details.title}"</span> was set.</p>;
      default:
        return <p>An unknown activity occurred.</p>;
    }
  };

  return (
    <div className="flex items-start gap-3">
      <div className="mt-1">
        <ActivityIcon type={activity.activity_type} />
      </div>
      <div className="flex-1">
        <div className="text-sm">{renderContent()}</div>
        <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}</p>
      </div>
    </div>
  );
};

export const ProjectHistoryFeed = ({ projectId }: { projectId: string }) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery<Activity[]>({
    queryKey: ['projectActivity', projectId],
    queryFn: async ({ pageParam = 0 }) => {
      const { data, error } = await supabase.rpc('get_project_activity', {
        p_project_id: projectId,
        p_limit: 10,
        p_offset: pageParam * 10,
      });
      if (error) throw error;
      return data || [];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === 10 ? allPages.length : undefined;
    },
    enabled: !!projectId && !!session?.user,
  });

  const activities = data?.pages.flatMap(page => page) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recentActivity')}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : error ? (
          <p className="text-destructive text-sm">Failed to load activity.</p>
        ) : activities.length > 0 ? (
          <div className="space-y-4">
            {activities.map(activity => <ActivityItem key={activity.id} activity={activity} />)}
            {hasNextPage && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t('showOlder')}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">No activity yet.</p>
        )}
      </CardContent>
    </Card>
  );
};