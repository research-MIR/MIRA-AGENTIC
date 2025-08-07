import { cn } from '@/lib/utils';
import { SecureImageDisplay } from './SecureImageDisplay';
import { BitStudioJob } from '@/types/vto';

interface BeforeAfterThumbnailProps {
  job: BitStudioJob;
  onClick: () => void;
  isSelected: boolean;
}

export const BeforeAfterThumbnail = ({ job, onClick, isSelected }: BeforeAfterThumbnailProps) => {
  const beforeUrl = job.source_person_image_url;
  const afterUrl = job.final_image_url;

  return (
    <button onClick={onClick} className={cn("border-2 rounded-lg p-1 flex-shrink-0 w-32 h-32", isSelected ? "border-primary" : "border-transparent")}>
      <div className="relative w-full h-full rounded-md overflow-hidden">
        <div className="absolute inset-0">
          <SecureImageDisplay imageUrl={beforeUrl || null} alt="Before" width={200} height={200} resize="cover" />
        </div>
        <div 
          className="absolute inset-0"
          style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
        >
          <SecureImageDisplay imageUrl={afterUrl || null} alt="After" width={200} height={200} resize="cover" />
        </div>
      </div>
    </button>
  );
};