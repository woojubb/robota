'use client';

import { useState, useCallback } from 'react';

export type TModalType =
    | 'configuration'
    | 'chat'
    | 'systemStatus'
    | 'workflowStatus'
    | 'createAgent'
    | 'addTool'
    | null;

export interface IUseModalReturn {
    activeModal: TModalType;
    isModalOpen: (modalType: TModalType) => boolean;
    openModal: (modalType: TModalType) => void;
    closeModal: () => void;
    toggleModal: (modalType: TModalType) => void;
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
    const [activeModal, setActiveModal] = useState<TModalType>(null);

    const isModalOpen = useCallback((modalType: TModalType) => {
        return activeModal === modalType;
    }, [activeModal]);

    const openModal = useCallback((modalType: TModalType) => {
        setActiveModal(modalType);
    }, []);

    const closeModal = useCallback(() => {
        setActiveModal(null);
    }, []);

    const toggleModal = useCallback((modalType: TModalType) => {
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
