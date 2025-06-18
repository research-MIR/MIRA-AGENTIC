import { create } from 'zustand';

interface Job {
  id: string;
  original_prompt: string;
  project_id: string | null;
}

interface ModalState {
  movingJob: Job | null;
  isMoveToProjectModalOpen: boolean;
  openMoveToProjectModal: (job: Job) => void;
  closeMoveToProjectModal: () => void;
}

export const useModalStore = create<ModalState>((set) => ({
  movingJob: null,
  isMoveToProjectModalOpen: false,
  openMoveToProjectModal: (job) => set({ movingJob: job, isMoveToProjectModalOpen: true }),
  closeMoveToProjectModal: () => set({ movingJob: null, isMoveToProjectModalOpen: false }),
}));