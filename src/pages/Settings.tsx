import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useLanguage } from "@/context/LanguageContext";

const Settings = () => {
  const { session } = useSession();
  const { t } = useLanguage();

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('settings')}</h1>
        <p className="text-muted-foreground">{t('manageYourAccount')}</p>
      </header>
      <div className="max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>{t('accountInformation')}</CardTitle>
            <CardDescription>{t('yourAccountDetails')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('emailAddress')}</p>
              <p className="text-muted-foreground">{session?.user?.email || 'No email found.'}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Settings;