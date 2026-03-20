'use client';

import { useState, useCallback } from 'react';

export type TModalKind =
  | 'configuration'
  | 'chat'
  | 'systemStatus'
  | 'workflowStatus'
  | 'createAgent'
  | 'addTool'
  | null;

export interface IUseModalReturn {
  activeModal: TModalKind;
  isModalOpen: (modalKind: TModalKind) => boolean;
  openModal: (modalKind: TModalKind) => void;
  closeModal: () => void;
  toggleModal: (modalKind: TModalKind) => void;
}

/**
 * Modal State Management Hook
 *
 * Features:
 * - Single modal system (only one modal open at a time)
 * - Type-safe modal types
 * - Easy open/close/toggle functions
 */
export function useModal(): IUseModalReturn {
  const [activeModal, setActiveModal] = useState<TModalKind>(null);

  const isModalOpen = useCallback(
    (modalKind: TModalKind) => {
      return activeModal === modalKind;
    },
    [activeModal],
  );

  const openModal = useCallback((modalKind: TModalKind) => {
    setActiveModal(modalKind);
  }, []);

  const closeModal = useCallback(() => {
    setActiveModal(null);
  }, []);

  const toggleModal = useCallback(
    (modalKind: TModalKind) => {
      if (activeModal === modalKind) {
        setActiveModal(null);
      } else {
        setActiveModal(modalKind);
      }
    },
    [activeModal],
  );

  return {
    activeModal,
    isModalOpen,
    openModal,
    closeModal,
    toggleModal,
  };
}
