import { useInfiniteQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare, FileText, CalendarCheck, Bot, Shirt } from "lucide-react";
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";

interface Activity {
  id: string;
  activity_type: string;
  details: {
    count: number;
    start_time: string;
    end_time: string;
    first_title: string;
    first_job_id?: string;
    first_pack_id?: string;
    details_array: {
        title: string;
        job_id?: string;
        pack_id?: string;
        due_date?: string;
    }[];
  };
  created_at: string;
}

const ActivityIcon = ({ type }: { type: string }) => {
  const cleanType = type.replace('grouped_', '');
  switch (cleanType) {
    case 'chat_added': return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
    case 'note_created': return <FileText className="h-4 w-4 text-muted-foreground" />;
    case 'deadline_created': return <CalendarCheck className="h-4 w-4 text-muted-foreground" />;
    case 'model_generation_started': return <Bot className="h-4 w-4 text-muted-foreground" />;
    case 'vto_job_started': return <Shirt className="h-4 w-4 text-muted-foreground" />;
    default: return null;
  }
};

const ActivityItem = ({ activity }: { activity: Activity }) => {
  const { count, start_time, end_time, first_title, first_job_id, first_pack_id, details_array } = activity.details;

  const renderContent = () => {
    const singleItemDetails = details_array?.[0];

    switch (activity.activity_type) {
      case 'grouped_chat_added':
        return (
          <p>
            Added {count} chats to the project, starting with <Link to={`/chat/${first_job_id}`} className="font-semibold text-primary hover:underline">"{first_title}"</Link>.
          </p>
        );
      case 'grouped_note_created':
        return <p>Created {count} notes, starting with <span className="font-semibold">"{first_title}"</span>.</p>;
      case 'grouped_deadline_created':
        return <p>Set {count} deadlines, starting with <span className="font-semibold">"{first_title}"</span>.</p>;
      case 'grouped_model_generation_started':
        return <p>Started {count} model generations in pack <Link to={`/model-packs/${first_pack_id}`} className="font-semibold text-primary hover:underline">details</Link>.</p>;
      case 'grouped_vto_job_started':
        return <p>Started {count} VTO jobs.</p>;
      case 'chat_added':
        if (!singleItemDetails) return null;
        return (
          <p>
            New chat <Link to={`/chat/${singleItemDetails.job_id}`} className="font-semibold text-primary hover:underline">"{singleItemDetails.title}"</Link> was added.
          </p>
        );
      case 'note_created':
        if (!singleItemDetails) return null;
        return <p>Note <span className="font-semibold">"{singleItemDetails.title}"</span> was created.</p>;
      case 'deadline_created':
        if (!singleItemDetails) return null;
        return <p>Deadline <span className="font-semibold">"{singleItemDetails.title}"</span> was set.</p>;
      case 'model_generation_started':
        if (!singleItemDetails) return null;
        return <p>Started model generation "{singleItemDetails.title}" in pack <Link to={`/model-packs/${singleItemDetails.pack_id}`} className="font-semibold text-primary hover:underline">details</Link>.</p>;
      case 'vto_job_started':
        if (!singleItemDetails) return null;
        return <p>Started VTO job "{singleItemDetails.title}".</p>;
      default:
        return <p>An unknown activity occurred.</p>;
    }
  };

  const renderTimestamp = () => {
      if (count > 1) {
          return `Started ${formatDistanceToNow(new Date(start_time), { addSuffix: true })} | Last update ${formatDistanceToNow(new Date(end_time), { addSuffix: true })}`;
      }
      return formatDistanceToNow(new Date(activity.created_at), { addSuffix: true });
  };

  return (
    <div className="flex items-start gap-3">
      <div className="mt-1">
        <ActivityIcon type={activity.activity_type} />
      </div>
      <div className="flex-1">
        <div className="text-sm">{renderContent()}</div>
        <p className="text-xs text-muted-foreground">{renderTimestamp()}</p>
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