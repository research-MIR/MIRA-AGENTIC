import React from 'react';
import { cn } from '@/lib/utils';
import { useSecureImage } from '@/hooks/useSecureImage';
import { Loader2, AlertTriangle, Image as ImageIcon } from 'lucide-react';

interface SecureImageDisplayProps {
    imageUrl: string | null;
    alt: string;
    onClick?: (e: React.MouseEvent<HTMLImageElement>) => void;
    className?: string;
    style?: React.CSSProperties;
}

export const SecureImageDisplay = ({ imageUrl, alt, onClick, className, style }: SecureImageDisplayProps) => {
    const { displayUrl, isLoading, error } = useSecureImage(imageUrl);
    const hasClickHandler = !!onClick;
  
    if (!imageUrl) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)} style={style}><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
    if (isLoading) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)} style={style}><Loader2 className="h-6 w-6 animate-spin" /></div>;
    if (error) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)} style={style}><AlertTriangle className="h-6 w-6 text-destructive" /></div>;
    
    return <img src={displayUrl} alt={alt} className={cn("max-w-full max-h-full object-contain rounded-md", hasClickHandler && "cursor-pointer", className)} onClick={onClick} style={style} />;
};