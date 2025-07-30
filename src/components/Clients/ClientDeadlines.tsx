import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CalendarCheck, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";

interface Deadline {
  deadline_id: string;
  title: string;
  due_date: string | null;
  status: 'pending' | 'completed';
  category: string | null;
  project_id: string;
  project_name: string;
}

export const ClientDeadlines = ({ clientId }: { clientId: string }) => {
  const { supabase, session } = useSession();

  const { data: deadlines, isLoading, error } = useQuery<Deadline[]>({
    queryKey: ['clientDeadlines', clientId],
    queryFn: async () => {
      if (!clientId || !session?.user) return [];
      const { data, error } = await supabase.rpc('get_client_deadlines', {
        p_client_id: clientId,
        p_user_id: session.user.id,
      });
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientId && !!session?.user,
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (error) return <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>;
  if (!deadlines || deadlines.length === 0) return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Deadlines</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground text-center py-4">No upcoming deadlines.</p>
      </CardContent>
    </Card>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Deadlines</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {deadlines.map(deadline => (
            <div key={deadline.deadline_id} className="flex items-center justify-between">
              <div>
                <p className="font-medium">{deadline.title}</p>
                <p className="text-xs text-muted-foreground">
                  In project: <Link to={`/projects/${deadline.project_id}`} className="hover:underline">{deadline.project_name}</Link>
                </p>
              </div>
              <div className="flex items-center gap-2">
                {deadline.category && <Badge variant="secondary">{deadline.category}</Badge>}
                <span className="text-sm font-semibold">{deadline.due_date ? format(new Date(deadline.due_date), 'MMM dd') : 'No date'}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};