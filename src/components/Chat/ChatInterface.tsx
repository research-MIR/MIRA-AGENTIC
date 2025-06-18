import { useState, useRef, useEffect } from "react";
import { FileDropzone } from "@/components/FileDropzone";
import { ControlPanel } from "./ControlPanel";
import { PromptInput } from "./PromptInput";
import { MessageList } from "./MessageList";
import { BranchPrompt } from "./BranchPrompt";
import { ChatHeader } from "./ChatHeader";
import { useChatManager } from "@/hooks/useChatManager";
import { useFileUpload } from "@/hooks/useFileUpload";

export const ChatInterface = () => {
  const {
    jobId,
    jobData,
    messages,
    chatTitle,
    isJobRunning,
    isSending,
    isOwner,
    jobSettings,
    setJobSettings,
    sendMessage,
    deleteChat,
    branchChat,
  } = useChatManager();

  const {
    uploadedFiles,
    setUploadedFiles,
    handleFileUpload,
    removeFile,
    isDragging,
    setIsDragging,
  } = useFileUpload();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = () => {
    const textToSend = input;
    const filesToSend = [...uploadedFiles];
    const isSilent = textToSend.startsWith("I choose image number");

    if ((!textToSend.trim() && filesToSend.length === 0) || isJobRunning || isSending) {
      return;
    }

    if (!isSilent) {
      // Optimistic UI update is now handled inside the hook, but we can keep it here if we want
    }
    
    setInput("");
    setUploadedFiles([]);
    sendMessage(textToSend, filesToSend, isSilent);
  };

  const handleRefinementComplete = (newImageUrl: string) => {
    // This logic needs to be moved into the hook or handled differently
    console.log("Refinement complete, new URL:", newImageUrl);
  };

  const lastMessageWithHistory = [...messages].reverse().find(m => m.historyIndex !== undefined);
  const lastHistoryIndex = lastMessageWithHistory?.historyIndex;

  return (
    <div className="flex flex-col h-full relative" onDragEnter={() => setIsDragging(true)}>
      {isDragging && <FileDropzone onDrop={handleFileUpload} onDragStateChange={setIsDragging} />}
      
      <ChatHeader
        jobId={jobId}
        jobData={jobData}
        chatTitle={chatTitle}
        isOwner={isOwner}
        onDeleteChat={deleteChat}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-6 space-y-4">
          <MessageList 
            messages={messages} 
            jobId={jobId} 
            onRefinementComplete={handleRefinementComplete} 
            onSendMessage={handleSendMessage}
            onBranch={branchChat}
            isOwner={isOwner}
          />
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t shrink-0 sticky bottom-0 bg-background">
        <ControlPanel
          selectedModelId={jobSettings.selectedModelId}
          onModelChange={(val) => setJobSettings(s => ({ ...s, selectedModelId: val }))}
          isDesignerMode={jobSettings.isDesignerMode}
          onDesignerModeChange={(val) => setJobSettings(s => ({ ...s, isDesignerMode: val }))}
          ratioMode={jobSettings.ratioMode}
          onRatioModeChange={(val) => setJobSettings(s => ({ ...s, ratioMode: val }))}
          numImagesMode={jobSettings.numImagesMode}
          onNumImagesModeChange={(val) => setJobSettings(s => ({ ...s, numImagesMode: val }))}
          isJobActive={!!jobId}
        />
        {isOwner ? (
          <PromptInput
            input={input}
            onInputChange={setInput}
            onFileUpload={handleFileUpload}
            uploadedFiles={uploadedFiles}
            onRemoveFile={removeFile}
            isJobRunning={isJobRunning}
            isSending={isSending}
            onSendMessage={handleSendMessage}
          />
        ) : (
          jobId && lastHistoryIndex !== undefined ? (
            <BranchPrompt onBranch={() => branchChat(lastHistoryIndex)} />
          ) : null
        )}
      </div>
    </div>
  );
};