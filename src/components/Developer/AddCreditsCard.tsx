import { useState, useEffect } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, UserPlus, CheckCircle } from "lucide-react";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";

interface SearchedUser {
  id: string;
  email: string;
}

export const AddCreditsCard = () => {
  const { supabase } = useSession();
  const [emailQuery, setEmailQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchedUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<SearchedUser | null>(null);
  const [creditsToAdd, setCreditsToAdd] = useState<number | ''>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const search = setTimeout(() => {
      if (emailQuery.length < 3) {
        setSearchResults([]);
        return;
      }
      setIsSearching(true);
      supabase.rpc('search_auth_users_by_email', { p_email_query: emailQuery })
        .then(({ data, error }) => {
          if (error) {
            showError(`User search failed: ${error.message}`);
            setSearchResults([]);
          } else {
            setSearchResults(data || []);
          }
        })
        .finally(() => setIsSearching(false));
    }, 500); // Debounce search

    return () => clearTimeout(search);
  }, [emailQuery, supabase]);

  const handleAddCredits = async () => {
    if (!selectedUser || !creditsToAdd || creditsToAdd <= 0) {
      showError("Please select a user and enter a positive number of credits.");
      return;
    }
    setIsLoading(true);
    const toastId = showLoading(`Adding ${creditsToAdd} credits to ${selectedUser.email}...`);
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-admin-add-credits', {
        body: { user_id: selectedUser.id, credits_to_add: creditsToAdd }
      });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(data.message);
      // Reset form
      setEmailQuery('');
      setSelectedUser(null);
      setCreditsToAdd('');
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to add credits: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectUser = (user: SearchedUser) => {
    setSelectedUser(user);
    setEmailQuery(user.email);
    setSearchResults([]);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Image Credits</CardTitle>
        <CardDescription>Add image generation credits to a user's account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 relative">
          <Label htmlFor="user-search">Search User by Email</Label>
          <Input
            id="user-search"
            value={emailQuery}
            onChange={(e) => {
              setEmailQuery(e.target.value);
              setSelectedUser(null); // Clear selection when typing
            }}
            placeholder="Start typing an email..."
            disabled={!!selectedUser}
          />
          {isSearching && <Loader2 className="absolute right-2 top-8 h-4 w-4 animate-spin" />}
          {searchResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-lg">
              {searchResults.map(user => (
                <div key={user.id} className="p-2 flex items-center justify-between hover:bg-muted cursor-pointer" onClick={() => handleSelectUser(user)}>
                  <span className="text-sm">{user.email}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedUser && (
          <div className="p-2 bg-muted rounded-md flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Selected: {selectedUser.email}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSelectedUser(null); setEmailQuery(''); }}>Change</Button>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="credits-to-add">Credits to Add</Label>
          <Input
            id="credits-to-add"
            type="number"
            value={creditsToAdd}
            onChange={(e) => setCreditsToAdd(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="e.g., 1000"
            min="1"
          />
        </div>
        <Button onClick={handleAddCredits} disabled={isLoading || !selectedUser || !creditsToAdd || creditsToAdd <= 0}>
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
          Add Credits
        </Button>
      </CardContent>
    </Card>
  );
};