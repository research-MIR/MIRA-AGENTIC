import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { PlusCircle, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";

interface ChatHeaderProps {
  jobId?: string;
  chatTitle: string;
  isOwner: boolean;
  onDeleteChat: () => void;
}

export const ChatHeader = ({ jobId, chatTitle, isOwner, onDeleteChat }: ChatHeaderProps) => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <header className="border-b p-4 md:p-6 flex justify-between items-center shrink-0">
      <div>
        <h1 className="text-2xl font-bold truncate">{jobId ? chatTitle : t.newChat}</h1>
        <p className="text-muted-foreground">{t.agentInteraction}</p>
      </div>
      <div className="flex items-center gap-2">
        <LanguageSwitcher />
        <ThemeToggle />
        {jobId && isOwner && (
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="destructive" size="icon" title={t.deleteChat}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>{t.deleteConfirmationTitle}</AlertDialogTitle><AlertDialogDescription>{t.deleteConfirmationDescription}</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>{t.cancel}</AlertDialogCancel><AlertDialogAction onClick={onDeleteChat}>{t.delete}</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Button id="new-chat-button" variant="outline" onClick={() => navigate("/chat")}><PlusCircle className="mr-2 h-4 w-4" />{t.newChat}</Button>
      </div>
    </header>
  );
};