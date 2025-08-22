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
    width?: number;
    height?: number;
    resize?: 'cover' | 'contain';
}

const SecureImageWithHook = ({ imageUrl, alt, onClick, className, style, width, height, resize }: SecureImageDisplayProps) => {
    const { displayUrl, isLoading, error } = useSecureImage(imageUrl, { width, height, resize });
  
    if (isLoading) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)} style={style}><Loader2 className="h-6 w-6 animate-spin" /></div>;
    if (error) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)} style={style}><AlertTriangle className="h-6 w-6 text-destructive" /></div>;
    
    if (!displayUrl) {
        return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)} style={style}><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
    }

    return <img src={displayUrl} alt={alt} className={cn("max-w-full max-h-full object-contain rounded-md", !!onClick && "cursor-pointer", className)} onClick={onClick} style={style} />;
};

export const SecureImageDisplay = (props: SecureImageDisplayProps) => {
    const { imageUrl, alt, onClick, className, style } = props;
    const hasClickHandler = !!onClick;

    if (!imageUrl) {
        return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)} style={style}><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
    }

    // If it's a public Supabase URL, render it directly to avoid hook complexities.
    if (imageUrl.includes('/storage/v1/object/public/')) {
        return <img src={imageUrl} alt={alt} className={cn("max-w-full max-h-full object-contain rounded-md", hasClickHandler && "cursor-pointer", className)} onClick={onClick} style={style} />;
    }

    // For all other URLs (signed, blob, etc.), use the hook.
    return <SecureImageWithHook {...props} />;
};