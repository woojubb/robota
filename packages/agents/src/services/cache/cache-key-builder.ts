import jsSHA from 'jssha';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { ICacheKey } from '../../interfaces/cache';

interface ICacheKeyOptions {
    temperature?: number;
    maxTokens?: number;
}

export class CacheKeyBuilder {
    build(
        messages: TUniversalMessage[],
        model: string,
        provider: string,
        options?: ICacheKeyOptions
    ): ICacheKey {
        const serializable = messages.map(m => ({
            role: m.role,
            content: m.content
        }));

        const payload = JSON.stringify({
            messages: serializable,
            model,
            provider,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens
        });

        return {
            hash: this.sha256(payload),
            model,
            provider
        };
    }

    computeIntegrityHash(content: string): string {
        return this.sha256(content);
    }

    private sha256(input: string): string {
        const shaObj = new jsSHA('SHA-256', 'TEXT');
        shaObj.update(input);
        return shaObj.getHash('HEX');
    }
}
