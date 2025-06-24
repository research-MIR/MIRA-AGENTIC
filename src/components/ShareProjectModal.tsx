import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { Link, Copy, UserPlus, X, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback } from './ui/avatar';

interface Project {
  project_id: string;
  project_name: string;
  sharing_mode: 'private' | 'public_link' | 'restricted';
}

interface Collaborator {
  id: string;
  email: string;
}

interface ShareProjectModalProps {
  project: Project | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ShareProjectModal = ({ project, isOpen, onClose }: ShareProjectModalProps) => {
  const { supabase } = useSession();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('private');
  const [email, setEmail] = useState('');
  const [searchResults, setSearchResults] = useState<Collaborator[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const { data: collaborators, isLoading: isLoadingCollaborators } = useQuery<Collaborator[]>({
    queryKey: ['projectCollaborators', project?.project_id],
    queryFn: async () => {
      if (!project) return [];
      const { data, error } = await supabase.from('project_collaborators').select('user_id').eq('project_id', project.project_id);
      if (error) throw error;
      const userIds = data.map(c => c.user_id);
      if (userIds.length === 0) return [];
      const { data: users, error: usersError } = await supabase.rpc('get_user_auth_details', { user_ids: userIds });
      if (usersError) throw usersError;
      return users;
    },
    enabled: isOpen && !!project,
  });

  useEffect(() => {
    if (project) {
      setActiveTab(project.sharing_mode);
    }
  }, [project]);

  const handleTabChange = async (value: string) => {
    if (!project) return;
    const toastId = showLoading("Updating sharing settings...");
    try {
      const { error } = await supabase.from('projects').update({ sharing_mode: value }).eq('id', project.project_id);
      if (error) throw error;
      setActiveTab(value);
      queryClient.invalidateQueries({ queryKey: ['projectPreviews'] });
      dismissToast(toastId);
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    }
  };

  const handleCopyLink = () => {
    if (!project) return;
    const link = `${window.location.origin}/projects/${project.project_id}`;
    navigator.clipboard.writeText(link);
    showSuccess("Link copied to clipboard!");
  };

  const handleSearchUsers = async (query: string) => {
    setEmail(query);
    if (query.length < 3) {
      setSearchResults([]);
      return;
    }
    const { data, error } = await supabase.rpc('search_users_by_email', { p_email_query: query });
    if (error) {
      showError(error.message);
      return;
    }
    setSearchResults(data || []);
  };

  const handleAddCollaborator = async (user: Collaborator) => {
    if (!project) return;
    setIsLoading(true);
    try {
      const { error } = await supabase.from('project_collaborators').insert({ project_id: project.project_id, user_id: user.id });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['projectCollaborators', project.project_id] });
      setEmail('');
      setSearchResults([]);
    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveCollaborator = async (userId: string) => {
    if (!project) return;
    setIsLoading(true);
    try {
      const { error } = await supabase.from('project_collaborators').delete().eq('project_id', project.project_id).eq('user_id', userId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['projectCollaborators', project.project_id] });
    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share "{project?.project_name}"</DialogTitle>
          <DialogDescription>Manage access to your project.</DialogDescription>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="private">Private</TabsTrigger>
            <TabsTrigger value="public_link">Public Link</TabsTrigger>
            <TabsTrigger value="restricted">Invite Only</TabsTrigger>
          </TabsList>
          <TabsContent value="private" className="pt-4">
            <p className="text-sm text-muted-foreground">Only you can access this project.</p>
          </TabsContent>
          <TabsContent value="public_link" className="pt-4 space-y-4">
            <p className="text-sm text-muted-foreground">Anyone with the link can view this project.</p>
            <div className="flex items-center space-x-2">
              <Input value={`${window.location.origin}/projects/${project?.project_id}`} readOnly />
              <Button onClick={handleCopyLink}><Copy className="h-4 w-4" /></Button>
            </div>
          </TabsContent>
          <TabsContent value="restricted" className="pt-4 space-y-4">
            <p className="text-sm text-muted-foreground">Only invited people can access this project.</p>
            <div className="relative">
              <Input placeholder="Enter email to invite..." value={email} onChange={(e) => handleSearchUsers(e.target.value)} />
              {searchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg">
                  {searchResults.map(user => (
                    <div key={user.id} className="p-2 flex items-center justify-between hover:bg-muted">
                      <span className="text-sm">{user.email}</span>
                      <Button size="sm" onClick={() => handleAddCollaborator(user)} disabled={isLoading}><UserPlus className="h-4 w-4" /></Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Collaborators</h4>
              {isLoadingCollaborators ? <Loader2 className="h-5 w-5 animate-spin" /> : (
                collaborators?.map(user => (
                  <div key={user.id} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6"><AvatarFallback>{user.email.substring(0, 2).toUpperCase()}</AvatarFallback></Avatar>
                      <span className="text-sm">{user.email}</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRemoveCollaborator(user.id)} disabled={isLoading}><X className="h-4 w-4" /></Button>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};