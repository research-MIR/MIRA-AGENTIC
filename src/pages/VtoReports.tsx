import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { BarChart, CheckCircle, XCircle } from "lucide-react";

// Mock data for UI structure
const mockReports = [
  {
    pack_id: "pack-123",
    created_at: new Date().toISOString(),
    total_jobs: 100,
    passed_jobs: 85,
    failed_jobs: 15,
    failure_summary: {
      "Garment Mismatch": 5,
      "Anatomical Error": 7,
      "Pose Distortion": 3,
    }
  },
  {
    pack_id: "pack-456",
    created_at: new Date(Date.now() - 86400000).toISOString(), // Yesterday
    total_jobs: 50,
    passed_jobs: 40,
    failed_jobs: 10,
    failure_summary: {
      "Blending Artifacts": 8,
      "Pattern/Color Mismatch": 2,
    }
  }
];

const VtoReports = () => {
  const { t } = useLanguage();

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('vtoAnalysisReports')}</h1>
        <p className="text-muted-foreground">{t('vtoAnalysisReportsDescription')}</p>
      </header>
      <div className="space-y-4">
        {mockReports.map(report => (
          <Card key={report.pack_id}>
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                <span>Pack from {new Date(report.created_at).toLocaleString()}</span>
                <Link to={`/vto-reports/${report.pack_id}`}>
                  <Button variant="outline">{t('viewReport')}</Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h3 className="font-semibold text-sm">{t('overallPassRate')}</h3>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle className="h-5 w-5" />
                    <span className="text-2xl font-bold">{report.passed_jobs}</span>
                    <span>Passed</span>
                  </div>
                  <div className="flex items-center gap-2 text-destructive">
                    <XCircle className="h-5 w-5" />
                    <span className="text-2xl font-bold">{report.failed_jobs}</span>
                    <span>Failed</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-sm">{t('failureReasons')}</h3>
                {/* Placeholder for bar chart */}
                <div className="h-24 bg-muted rounded-md flex items-center justify-center text-muted-foreground">
                  <BarChart className="h-8 w-8" />
                  <p className="ml-2">Chart placeholder</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {mockReports.length === 0 && (
          <div className="text-center py-16">
            <h2 className="mt-4 text-xl font-semibold">{t('noReportsGenerated')}</h2>
            <p className="mt-2 text-muted-foreground">{t('noReportsGeneratedDescription')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VtoReports;