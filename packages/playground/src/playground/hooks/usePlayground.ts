'use client';

import { useEffect, useState } from 'react';

// Wire to services surface to ensure linkage without direct coupling here
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as PlaygroundServices from '../services';

export interface IPlaygroundState {
    ready: boolean;
}

export function usePlayground(): IPlaygroundState {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        // Minimal boot: future place to initialize event services/subscribers
        setReady(true);
    }, []);

    return { ready };
}


