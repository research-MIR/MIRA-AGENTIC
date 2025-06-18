import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Paperclip, X } from "lucide-react";

interface UploadedFile {
  name: string;
  path: string;
  previewUrl: string;
  isImage: boolean;
}

interface PromptInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onFileUpload: (files: FileList | null) => Promise<UploadedFile[]>;
  uploadedFiles: UploadedFile[];
  onRemoveFile: (index: number) => void;
  isJobRunning: boolean;
  isSending: boolean;
}

export const PromptInput = ({
  input,
  onInputChange,
  onSendMessage,
  onFileUpload,
  uploadedFiles,
  onRemoveFile,
  isJobRunning,
  isSending,
}: PromptInputProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onSendMessageRef = useRef(onSendMessage);

  useEffect(() => {
    onSendMessageRef.current = onSendMessage;
  }, [onSendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (onSendMessageRef.current) {
        onSendMessageRef.current();
      }
    }
  };

  return (
    <div className="p-4 flex items-start gap-2">
      <div id="file-upload-button">
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => onFileUpload(e.target.files)}
          className="hidden"
          id="file-upload"
          multiple
        />
        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="h-4 w-4" />
        </Button>
      </div>
      <div id="prompt-input-area" className="flex-1 relative min-w-0">
        <Textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about the file(s) or type a message... (Enter to send, Shift+Enter for new line)"
          className="pr-4 min-h-[40px] max-h-40"
          rows={1}
        />
        {uploadedFiles.length > 0 && (
          <div className="absolute right-2 top-2 flex items-center gap-2 bg-muted p-1 rounded-md text-sm max-w-[50%]">
            <div className="flex gap-2 overflow-x-auto p-1">
              {uploadedFiles.map((file, index) => (
                <div key={`${file.name}-${index}`} className="relative flex-shrink-0">
                  {file.isImage ? (
                    <img src={file.previewUrl} alt="Preview" className="h-6 w-6 rounded object-cover" />
                  ) : (
                    <div className="h-6 w-6 bg-secondary rounded flex items-center justify-center">
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveFile(index)}
                    className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 h-4 w-4 flex items-center justify-center"
                  >
                    <X className="h-2 w-2" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div id="send-button">
        <Button type="button" onClick={onSendMessage} disabled={isJobRunning || isSending}>
          <Send className="h-4 w-4" />
          <span className="sr-only">Send</span>
        </Button>
      </div>
    </div>
  );
};