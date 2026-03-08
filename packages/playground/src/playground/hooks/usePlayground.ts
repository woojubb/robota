'use client';

import { useEffect, useState } from 'react';

export interface IPlaygroundBootState {
    ready: boolean;
}

export function usePlaygroundBoot(): IPlaygroundBootState {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        // Minimal boot: future place to initialize event services/subscribers
        setReady(true);
    }, []);

    return { ready };
}


