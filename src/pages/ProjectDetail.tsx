import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowLeft } from "lucide-react";

const ProjectDetail = () => {
  const { projectId } = useParams();
  const { supabase, session } = useSession();

  const { data: project, isLoading, error } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase.from('mira-agent-projects').select('*, client:mira-agent-clients(id, name)').eq('id', projectId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-12 w-1/3" /></div>;
  }

  if (error || !project) {
    return <div className="p-8"><Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>Project not found.</AlertDescription></Alert></div>;
  }

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <Link to={`/clients/${project.client?.id}`} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="h-4 w-4" />
          Back to {project.client?.name}
        </Link>
        <h1 className="text-3xl font-bold">{project.name}</h1>
      </header>
      <div>
        <p>Project content will go here, including chats and gallery.</p>
      </div>
    </div>
  );
};

export default ProjectDetail;