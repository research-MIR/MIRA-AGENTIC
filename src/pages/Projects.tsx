import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Folder, MessageSquare, Image as ImageIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { useSecureImage } from "@/hooks/useSecureImage";

interface ProjectPreview {
  project_id: string;
  project_name: string;
  chat_count: number;
  latest_image_url: string | null;
}

const ProjectCard = ({ project }: { project: ProjectPreview }) => {
  const { displayUrl, isLoading } = useSecureImage(project.latest_image_url);

  return (
    <Link to={`/projects/${project.project_id}`}>
      <Card className="hover:border-primary transition-colors h-full flex flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Folder className="h-5 w-5 text-primary" />
            <span>{project.project_name}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1">
          <div className="aspect-video bg-muted rounded-md flex items-center justify-center overflow-hidden">
            {isLoading ? (
              <Skeleton className="w-full h-full" />
            ) : displayUrl ? (
              <img src={displayUrl} alt={project.project_name} className="w-full h-full object-cover" />
            ) : (
              <ImageIcon className="h-12 w-12 text-muted-foreground" />
            )}
          </div>
        </CardContent>
        <CardFooter>
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            <span>{project.chat_count} {project.chat_count === 1 ? 'chat' : 'chats'}</span>
          </div>
        </CardFooter>
      </Card>
    </Link>
  );
};

const Projects = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();

  const { data: projects, isLoading, error } = useQuery<ProjectPreview[]>({
    queryKey: ["projectPreviews", session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.rpc('get_project_previews', { p_user_id: session.user.id });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">Projects</h1>
        <p className="text-muted-foreground">Organize your work into projects.</p>
      </header>
      
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map(project => <ProjectCard key={project.project_id} project={project} />)}
        </div>
      ) : (
        <div className="text-center py-16">
          <Folder className="mx-auto h-16 w-16 text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">No projects yet</h2>
          <p className="mt-2 text-muted-foreground">Create projects by moving chats into them from the sidebar.</p>
        </div>
      )}
    </div>
  );
};

export default Projects;