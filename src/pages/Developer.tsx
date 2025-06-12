import { useState, useEffect } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";
import { Loader2 } from "lucide-react";

const Developer = () => {
  const { supabase } = useSession();
  const { t } = useLanguage();
  const [isDevAuthenticated, setIsDevAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const devAuthStatus = sessionStorage.getItem('dev_authenticated') === 'true';
    if (devAuthStatus) setIsDevAuthenticated(true);
  }, []);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const toastId = showLoading("Verifying password...");
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-verify-dev-pass', { body: { password } });
      if (error) throw error;
      if (data.success) {
        sessionStorage.setItem('dev_authenticated', 'true');
        setIsDevAuthenticated(true);
        showSuccess("Access granted.");
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

  if (!isDevAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full">
        <Card className="w-full max-w-sm">
          <CardHeader><CardTitle>{t.enterDeveloperPassword}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <Label htmlFor="dev-password">Password</Label>
                <Input id="dev-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t.submit}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t.developerTools}</h1>
        <p className="text-muted-foreground">{t.developerToolsDescription}</p>
      </header>
      <div className="space-y-4">
        <Card>
            <CardHeader>
                <CardTitle>More tools coming soon</CardTitle>
            </CardHeader>
            <CardContent>
                <p>This area is reserved for future developer-specific tools and diagnostics.</p>
            </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Developer;