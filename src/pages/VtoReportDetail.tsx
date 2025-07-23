import { useParams, Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";

// Mock data
const mockDetail = {
  pack_id: "pack-123",
  jobs: [
    { id: "job-1", status: "pass", imageUrl: "https://placehold.co/400x400/a3e635/3f3f46?text=PASS" },
    { id: "job-2", status: "fail", imageUrl: "https://placehold.co/400x400/ef4444/ffffff?text=FAIL" },
    { id: "job-3", status: "pass", imageUrl: "https://placehold.co/400x400/a3e635/3f3f46?text=PASS" },
    { id: "job-4", status: "pass", imageUrl: "https://placehold.co/400x400/a3e635/3f3f46?text=PASS" },
    { id: "job-5", status: "fail", imageUrl: "https://placehold.co/400x400/ef4444/ffffff?text=FAIL" },
  ]
};

const VtoReportDetail = () => {
  const { packId } = useParams();
  const { t } = useLanguage();

  const passedJobs = mockDetail.jobs.filter(j => j.status === 'pass');
  const failedJobs = mockDetail.jobs.filter(j => j.status === 'fail');

  const renderJobGrid = (jobs: typeof mockDetail.jobs) => (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
      {jobs.map(job => (
        <Card key={job.id} className="relative group cursor-pointer">
          <img src={job.imageUrl} className="w-full h-full object-cover rounded-md" />
          <Badge variant={job.status === 'pass' ? 'default' : 'destructive'} className="absolute top-2 right-2">{job.status.toUpperCase()}</Badge>
        </Card>
      ))}
    </div>
  );

  return (
    <div className="p-4 md:p-8 h-screen flex flex-col">
      <header className="pb-4 mb-8 border-b">
        <Link to="/vto-reports" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="h-4 w-4" />
          Back to All Reports
        </Link>
        <h1 className="text-3xl font-bold">{t('vtoReportDetailTitle')}</h1>
        <p className="text-muted-foreground">Pack ID: {packId}</p>
      </header>
      <Tabs defaultValue="all" className="w-full flex-1 flex flex-col">
        <TabsList>
          <TabsTrigger value="all">{t('allJobs')} ({mockDetail.jobs.length})</TabsTrigger>
          <TabsTrigger value="passed">{t('passedJobs')} ({passedJobs.length})</TabsTrigger>
          <TabsTrigger value="failed">{t('failedJobs')} ({failedJobs.length})</TabsTrigger>
        </TabsList>
        <div className="flex-1 overflow-y-auto mt-4">
          <TabsContent value="all">
            {renderJobGrid(mockDetail.jobs)}
          </TabsContent>
          <TabsContent value="passed">
            {renderJobGrid(passedJobs)}
          </TabsContent>
          <TabsContent value="failed">
            {renderJobGrid(failedJobs)}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};

export default VtoReportDetail;