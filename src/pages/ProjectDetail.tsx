import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Folder, MessageSquare, Image as ImageIcon, MoreVertical, Pencil, Trash2, ImagePlus, Loader2, Move } from "lucide-react";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { useSecureImage } from "@/hooks/useSecureImage";
import { useLanguage } from "@/context/LanguageContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import { ProjectImageManagerModal } from "@/components/ProjectImageManagerModal";
import { useDropzone } from "@/hooks/useDropzone";
import { cn } from "@/lib/utils";

interface Job {
  id: string;
  original_prompt: string;
  context: any;
  final_result: any;
}

interface ImageResult {
  publicUrl: string;
  storagePath: string;
  jobId: string;
}

const ProjectDetail = () => {
  const { projectId } = useParams();
  const { supabase, session } = useSession();
  const { showImage } = useImagePreview();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);
  const [isImageManagerOpen, setIsImageManagerOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  const { data: project, isLoading: isLoadingProject, refetch: refetchProject } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase.from('projects').select('name').eq('id', projectId).single();
      if (error) throw error;
      setNewProjectName(data.name);
      return data;
    },
    enabled: !!projectId,
  });

  const { data: jobs, isLoading: isLoadingJobs, refetch: refetchJobs } = useQuery<Job[]>({
    queryKey: ['projectJobs', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase.from('mira-agent-jobs').select('id, original_prompt, context, final_result').eq('project_id', projectId).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const projectImages = useMemo((): ImageResult[] => {
    if (!jobs) return [];
    const allImages: ImageResult[] = [];
    for (const job of jobs) {
      const jobImages = (job.final_result?.images || job.final_result?.final_generation_result?.response?.images || []);
      for (const image of jobImages) {
        if (image.publicUrl) allImages.push({ ...image, jobId: job.id });
      }
      if (job.context?.history) {
        for (const turn of job.context.history) {
          if (turn.role === 'function' && turn.parts[0]?.functionResponse?.response?.isImageGeneration) {
            const imagesInTurn = turn.parts[0].functionResponse.response.images;
            if (Array.isArray(imagesInTurn)) {
              for (const image of imagesInTurn) {
                if (!allImages.some(existing => existing.publicUrl === image.publicUrl)) {
                  allImages.push({ ...image, jobId: job.id });
                }
              }
            }
          }
        }
      }
    }
    return Array.from(new Map(allImages.map(item => [item.publicUrl, item])).values());
  }, [jobs]);

  const latestImageUrl = projectImages.length > 0 ? projectImages[0].publicUrl : null;
  const { displayUrl: latestImageDisplayUrl, isLoading: isLoadingLatestImage } = useSecureImage(latestImageUrl);

  const handleRenameProject = async () => {
    if (!newProjectName.trim() || !projectId) return;
    setIsUpdating(true);
    try {
      const { error } = await supabase.from('projects').update({ name: newProjectName }).eq('id', projectId);
      if (error) throw error;
      showSuccess("Project renamed.");
      await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['projectPreviews'] });
      setIsRenameModalOpen(false);
    } catch (err: any) {
      showError(`Failed to rename: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectId || !session?.user) return;
    setIsUpdating(true);
    try {
      const { error } = await supabase.rpc('delete_project_and_unassign_jobs', { p_project_id: projectId, p_user_id: session.user.id });
      if (error) throw error;
      showSuccess("Project deleted.");
      await queryClient.invalidateQueries({ queryKey: ['projectPreviews'] });
      await queryClient.invalidateQueries({ queryKey: ['jobHistory'] });
      navigate('/projects');
    } catch (err: any) {
      showError(`Failed to delete: ${err.message}`);
    } finally {
      setIsUpdating(false);
      setIsDeleteAlertOpen(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const jobDataString = e.dataTransfer.getData('application/json');
    if (!jobDataString || !projectId) return;
    const jobData = JSON.parse(jobDataString);
    if (jobData.project_id === projectId) return;

    setIsUpdating(true);
    try {
      const { error } = await supabase.rpc('update_job_project', { p_job_id: jobData.id, p_project_id: projectId });
      if (error) throw error;
      showSuccess(`Moved "${jobData.original_prompt}" to ${project?.name}.`);
      await Promise.all([
        refetchJobs(),
        queryClient.invalidateQueries({ queryKey: ['jobHistory'] }),
        queryClient.invalidateQueries({ queryKey: ['projectPreviews'] })
      ]);
    } catch (err: any) {
      showError(`Failed to move chat: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: handleDrop });

  if (isLoadingProject) {
    return <div className="p-8"><Skeleton className="h-12 w-1/3" /></div>;
  }

  if (!project) {
    return <div className="p-8"><Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>Project not found.</AlertDescription></Alert></div>;
  }

  return (
    <>
      <div className="p-4 md:p-8 h-screen flex flex-col" {...dropzoneProps}>
        <header className="pb-4 mb-8 border-b shrink-0 flex justify-between items-center">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            {isDraggingOver ? <Move className="h-8 w-8 text-primary" /> : <Folder className="h-8 w-8 text-primary" />}
            {project.name}
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setIsImageManagerOpen(true)}><ImagePlus className="h-4 w-4 mr-2" />Add Images</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setIsRenameModalOpen(true)}><Pencil className="mr-2 h-4 w-4" />Rename</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setIsDeleteAlertOpen(true)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 overflow-hidden relative">
          {(isUpdating || isLoadingJobs) && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}
          <div className="lg:col-span-1 flex flex-col h-full">
            <Card className="flex-1 flex flex-col">
              <CardHeader><CardTitle>{t.projectChatsTitle} ({jobs?.length || 0})</CardTitle></CardHeader>
              <CardContent className="flex-1 overflow-hidden"><ScrollArea className="h-full"><div className="space-y-2 pr-4">{jobs?.map(job => (<Link key={job.id} to={`/chat/${job.id}`} className="block p-2 rounded-md hover:bg-muted"><p className="font-medium truncate">{job.original_prompt || "Untitled Chat"}</p></Link>))}</div></ScrollArea></CardContent>
            </Card>
          </div>
          <div className="lg:col-span-2 flex flex-col gap-8 overflow-hidden">
            <Card>
              <CardHeader><CardTitle>{t.keyVisualTitle}</CardTitle><p className="text-sm text-muted-foreground">{t.keyVisualDescription}</p></CardHeader>
              <CardContent><div className="aspect-square max-h-64 mx-auto bg-muted rounded-lg flex items-center justify-center overflow-hidden">{isLoadingLatestImage ? <Skeleton className="w-full h-full" /> : latestImageDisplayUrl ? (<img src={latestImageDisplayUrl} alt="Latest project image" className="w-full h-full object-contain" />) : (<ImageIcon className="h-16 w-16 text-muted-foreground" />)}</div></CardContent>
            </Card>
            <Card className="flex-1 flex flex-col overflow-hidden">
              <CardHeader><CardTitle>{t.projectGalleryTitle} ({projectImages.length})</CardTitle></CardHeader>
              <CardContent className="flex-1 overflow-hidden"><ScrollArea className="h-full"><div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pr-4">{projectImages.map((image, index) => (<button key={image.publicUrl} onClick={() => showImage({ images: projectImages.map(img => ({ url: img.publicUrl, jobId: img.jobId })), currentIndex: index })} className="aspect-square block"><img src={image.publicUrl} alt={`Project image ${index + 1}`} className="w-full h-full object-cover rounded-md hover:opacity-80 transition-opacity" /></button>))}</div></ScrollArea></CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Modals and Dialogs */}
      <Dialog open={isRenameModalOpen} onOpenChange={setIsRenameModalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Project</DialogTitle></DialogHeader>
          <div className="py-4"><Label htmlFor="new-name">New Project Name</Label><Input id="new-name" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} /></div>
          <DialogFooter><Button variant="ghost" onClick={() => setIsRenameModalOpen(false)}>Cancel</Button><Button onClick={handleRenameProject} disabled={isUpdating}>{isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will delete the project "{project.name}". All chats within it will become unassigned. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteProject} disabled={isUpdating} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete Project</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {project && <ProjectImageManagerModal project={{ project_id: projectId!, project_name: project.name }} isOpen={isImageManagerOpen} onClose={() => setIsImageManagerOpen(false)} />}
    </>
  );
};

export default ProjectDetail;