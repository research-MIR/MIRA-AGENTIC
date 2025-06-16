import { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useSession } from "./SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Loader2 } from "lucide-react";

const DevPasswordScreen = ({ onAuthenticated }: { onAuthenticated: () => void }) => {
  const { supabase } = useSession();
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const toastId = showLoading("Verifying password...");
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-verify-dev-pass', { body: { password } });
      if (error) throw error;
      if (data.success) {
        sessionStorage.setItem('dev_authenticated', 'true');
        showSuccess("Access granted.");
        onAuthenticated();
      } else {
        showError("Incorrect password.");
      }
    } catch (err: any) {
      showError(err.message);
    } finally {
      dismissToast(toastId);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle>Developer Access Required</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">This section is for authorized developers only. Please enter the password to continue.</p>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <Label htmlFor="dev-password">Password</Label>
              <Input id="dev-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

const DevProtectedRoute = () => {
  const [isDevAuthenticated, setIsDevAuthenticated] = useState(false);

  useEffect(() => {
    const devAuthStatus = sessionStorage.getItem('dev_authenticated') === 'true';
    setIsDevAuthenticated(devAuthStatus);
  }, []);

  if (!isDevAuthenticated) {
    return <DevPasswordScreen onAuthenticated={() => setIsDevAuthenticated(true)} />;
  }

  return <Outlet />;
};

export default DevProtectedRoute;