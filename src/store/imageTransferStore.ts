import { create } from 'zustand';

type VtoTarget = 'base' | 'pro-source';

interface ImageTransferState {
  imageUrlToTransfer: string | null;
  vtoTarget: VtoTarget | null;
  setImageUrlToTransfer: (url: string | null, vtoTarget?: VtoTarget | null) => void;
  consumeImageUrl: () => { url: string | null; vtoTarget: VtoTarget | null };
}

export const useImageTransferStore = create<ImageTransferState>((set, get) => ({
  imageUrlToTransfer: null,
  vtoTarget: null,
  setImageUrlToTransfer: (url, vtoTarget = null) => set({ imageUrlToTransfer: url, vtoTarget }),
  consumeImageUrl: () => {
    const { imageUrlToTransfer, vtoTarget } = get();
    set({ imageUrlToTransfer: null, vtoTarget: null }); // Clear after consuming
    return { url: imageUrlToTransfer, vtoTarget };
  },
}));