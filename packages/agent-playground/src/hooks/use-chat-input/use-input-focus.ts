'use client';

import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

interface IUseInputFocusParams {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  setIsInputFocused: Dispatch<SetStateAction<boolean>>;
}

export function useInputFocus({ inputRef, setIsInputFocused }: IUseInputFocusParams): void {
  useEffect(() => {
    const handleFocus = () => setIsInputFocused(true);
    const handleBlur = () => setIsInputFocused(false);
    const input = inputRef.current;

    if (input) {
      input.addEventListener('focus', handleFocus);
      input.addEventListener('blur', handleBlur);

      return () => {
        input.removeEventListener('focus', handleFocus);
        input.removeEventListener('blur', handleBlur);
      };
    }

    return;
  }, [inputRef, setIsInputFocused]);
}
