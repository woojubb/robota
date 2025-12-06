'use client';

import { useState, useCallback } from 'react';

export type ModalType =
    | 'configuration'
    | 'chat'
    | 'systemStatus'
    | 'authDebug'
    | 'workflowStatus'
    | 'createAgent'
    | null;

export interface UseModalReturn {
    activeModal: ModalType;
    isModalOpen: (modalType: ModalType) => boolean;
    openModal: (modalType: ModalType) => void;
    closeModal: () => void;
    toggleModal: (modalType: ModalType) => void;
}

/**
 * Modal State Management Hook
 * 
 * Features:
 * - Single modal system (only one modal open at a time)
 * - Type-safe modal types
 * - Easy open/close/toggle functions
 */
export function useModal(): UseModalReturn {
    const [activeModal, setActiveModal] = useState<ModalType>(null);

    const isModalOpen = useCallback((modalType: ModalType) => {
        return activeModal === modalType;
    }, [activeModal]);

    const openModal = useCallback((modalType: ModalType) => {
        setActiveModal(modalType);
    }, []);

    const closeModal = useCallback(() => {
        setActiveModal(null);
    }, []);

    const toggleModal = useCallback((modalType: ModalType) => {
        if (activeModal === modalType) {
            setActiveModal(null);
        } else {
            setActiveModal(modalType);
        }
    }, [activeModal]);

    return {
        activeModal,
        isModalOpen,
        openModal,
        closeModal,
        toggleModal
    };
}
