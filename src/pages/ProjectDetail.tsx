import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Folder, MessageSquare, Image as ImageIcon, MoreVertical, Pencil, Trash2, ImagePlus, Loader2, Move, Info, X, Star, ListMinus } from "lucide-react";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { useSecureImage } from "@/hooks/useSecureImage";
import { useLanguage } from "@/context/LanguageContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
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

interface ProjectPreview {
  project_id: string;
  project_name: string;
  chat_count: number;
  latest_image_url: string | null;
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
  const [isManageChatsModalOpen, setIsManageChatsModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [jobToDelete, setJobToDelete] = useState<string | null>(null);
  const [jobBeingRemoved, setJobBeingRemoved] = useState<string | null>(null);

  const { data: allProjects, isLoading: isLoadingProject } = useQuery<ProjectPreview[]>({
    queryKey: ["projectPreviews", session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.rpc('get_project_previews', { p_user_id: session.user.id });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const project = useMemo(() => allProjects?.find(p => p.project_id === projectId), [allProjects, projectId]);

  useEffect(() => {
    if (project) {
      setNewProjectName(project.project_name);
    }
  }, [project]);

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

  const { displayUrl: keyVisualDisplayUrl, isLoading: isLoadingKeyVisual } = useSecureImage(project?.latest_image_url);

  const handleRenameProject = async () => {
    if (!newProjectName.trim() || !projectId) return;
    setIsUpdating(true);
    try {
      const { error } = await supabase.from('projects').update({ name: newProjectName }).eq('id', projectId);
      if (error) throw error;
      showSuccess("Project renamed.");
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
      showSuccess(`Moved "${jobData.original_prompt}" to ${project?.project_name}.`);
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

  const handleRemoveChat = async (jobId: string) => {
    if (!session?.user) return;
    setJobBeingRemoved(jobId);
    try {
      const { error } = await supabase.rpc('unassign_job_from_project', { p_job_id: jobId, p_user_id: session.user.id });
      if (error) throw error;
      showSuccess("Chat removed from project.");
      await Promise.all([
        refetchJobs(),
        queryClient.invalidateQueries({ queryKey: ['jobHistory'] }),
        queryClient.invalidateQueries({ queryKey: ['projectPreviews'] })
      ]);
    } catch (err: any) {
      showError(`Failed to remove chat: ${err.message}`);
    } finally {
      setJobBeingRemoved(null);
    }
  };

  const handleConfirmDeleteJob = async () => {
    if (!jobToDelete) return;
    setIsUpdating(true);
    try {
      const { error } = await supabase.rpc('delete_mira_agent_job', { p_job_id: jobToDelete });
      if (error) throw error;
      showSuccess("Image and its source job deleted.");
      await Promise.all([
        refetchJobs(),
        queryClient.invalidateQueries({ queryKey: ['projectPreviews'] })
      ]);
    } catch (err: any) {
      showError(`Failed to delete image: ${err.message}`);
    } finally {
      setIsUpdating(false);
      setJobToDelete(null);
    }
  };

  const handleSetKeyVisual = async (imageUrl: string) => {
    if (!projectId) return;
    const toastId = showLoading("Setting key visual...");
    try {
      const { error } = await supabase.rpc('set_project_key_visual', { p_project_id: projectId, p_image_url: imageUrl });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess("Key visual updated.");
      await queryClient.invalidateQueries({ queryKey: ['projectPreviews'] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to set key visual: ${err.message}`);
    }
  };

  if (isLoadingProject) {
    return <div className="p-8"><Skeleton className="h-12 w-1/3" /></div>;
  }

  if (!project) {
    return <div className="p-8"><Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>Project not found.</AlertDescription></Alert></div>;
  }

  return (
    <>
      <div className={cn("p-4 md:p-8 h-screen flex flex-col transition-all", isDraggingOver && "ring-2 ring-primary ring-offset-4 ring-offset-background rounded-lg")} {...dropzoneProps}>
        <header className="pb-4 mb-4 border-b shrink-0 flex justify-between items-center">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            {isDraggingOver ? <Move className="h-8 w-8 text-primary" /> : <Folder className="h-8 w-8 text-primary" />}
            {project.project_name}
          </h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setIsRenameModalOpen(true)}><Pencil className="mr-2 h-4 w-4" />Rename</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setIsDeleteAlertOpen(true)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <Alert className="mb-8 shrink-0">
          <Info className="h-4 w-4" />
          <AlertTitle>{t('howProjectsWork')}</AlertTitle>
          <AlertDescription>{t('projectDetailDropInfo')}</AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 overflow-hidden relative">
          {(isUpdating || isLoadingJobs) && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10 rounded-lg">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          )}
          <div className="lg:col-span-1 flex flex-col h-full">
            <Card className="flex-1 flex flex-col">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{t('projectChatsTitle')} ({jobs?.length || 0})</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setIsManageChatsModalOpen(true)}>
                  <ListMinus className="h-4 w-4 mr-2" />
                  Manage
                </Button>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="space-y-1 pr-4">
                    {jobs?.map(job => (
                      <Link key={job.id} to={`/chat/${job.id}`} className="block p-2 rounded-md hover:bg-muted">
                        <span className="font-medium text-sm truncate block">{job.original_prompt || "Untitled Chat"}</span>
                      </Link>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
          <div className="lg:col-span-2 flex flex-col gap-8 overflow-hidden">
            <Card>
              <CardHeader><CardTitle>{t('keyVisualTitle')}</CardTitle><p className="text-sm text-muted-foreground">{t('keyVisualDescription')}</p></CardHeader>
              <CardContent><div className="aspect-square max-h-64 mx-auto bg-muted rounded-lg flex items-center justify-center overflow-hidden">{isLoadingKeyVisual ? <Skeleton className="w-full h-full" /> : keyVisualDisplayUrl ? (<img src={keyVisualDisplayUrl} alt="Latest project image" className="w-full h-full object-contain" />) : (<ImageIcon className="h-16 w-16 text-muted-foreground" />)}</div></CardContent>
            </Card>
            <Card className="flex-1 flex flex-col overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{t('projectGalleryTitle')} ({projectImages.length})</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setIsImageManagerOpen(true)}><ImagePlus className="h-4 w-4 mr-2" />Add Images</Button>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 pr-4">
                    {projectImages.map((image, index) => (
                      <div key={image.publicUrl} className="group relative">
                        <button onClick={() => showImage({ images: projectImages.map(img => ({ url: img.publicUrl, jobId: img.jobId })), currentIndex: index })} className="aspect-square block w-full h-full">
                          <img src={image.publicUrl} alt={`Project image ${index + 1}`} className="w-full h-full object-cover rounded-md hover:opacity-80 transition-opacity" />
                        </button>
                        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                          <Button variant="secondary" size="icon" className="h-7 w-7" title="Set as Key Visual" onClick={() => handleSetKeyVisual(image.publicUrl)}>
                            <Star className="h-4 w-4" />
                          </Button>
                          <Button variant="destructive" size="icon" className="h-7 w-7" title="Delete Image & Source Job" onClick={() => setJobToDelete(image.jobId)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
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
          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will delete the project "{project.project_name}". All chats within it will become unassigned. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteProject} disabled={isUpdating} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete Project</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isManageChatsModalOpen} onOpenChange={setIsManageChatsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Chats in "{project.project_name}"</DialogTitle>
            <DialogDescription>Remove chats from this project. They will not be deleted, only unassigned.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] my-4">
            <div className="space-y-2 pr-4">
              {jobs?.map(job => (
                <div key={job.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                  <span className="text-sm truncate pr-2">{job.original_prompt || "Untitled Chat"}</span>
                  <Button variant="destructive" size="sm" onClick={() => handleRemoveChat(job.id)} disabled={jobBeingRemoved === job.id}>
                    {jobBeingRemoved === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button onClick={() => setIsManageChatsModalOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!jobToDelete} onOpenChange={(open) => !open && setJobToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete Image and Source Job?</AlertDialogTitle><AlertDialogDescription>This will permanently delete the image and the job that created it. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleConfirmDeleteJob} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {project && <ProjectImageManagerModal project={{ project_id: projectId!, project_name: project.project_name }} isOpen={isImageManagerOpen} onClose={() => setIsImageManagerOpen(false)} />}
    </>
  );
};

export default ProjectDetail;