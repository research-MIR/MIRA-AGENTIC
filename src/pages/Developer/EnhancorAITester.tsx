import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnhancorSingleTester } from '@/components/Developer/EnhancorSingleTester';
import { EnhancorBatchTester } from '@/components/Developer/EnhancorBatchTester';

const EnhancorAITester = () => {
  return (
    <div className="p-4 md:p-8 h-full overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">EnhancorAI Upscaler Tester</h1>
        <p className="text-muted-foreground">A developer tool to test the EnhancorAI service.</p>
      </header>
      <Tabs defaultValue="single" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md mx-auto">
          <TabsTrigger value="single">Single Test</TabsTrigger>
          <TabsTrigger value="batch">Batch Test</TabsTrigger>
        </TabsList>
        <TabsContent value="single">
          <EnhancorSingleTester />
        </TabsContent>
        <TabsContent value="batch">
          <EnhancorBatchTester />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default EnhancorAITester;