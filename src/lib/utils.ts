import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const downloadImage = (url: string, filename: string) => {
  try {
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    // The following attributes are good practice for security and performance.
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error("Failed to initiate download:", error);
    // As a fallback, open the image in a new tab for the user to save manually.
    window.open(url, '_blank');
  }
};