export function replaceAttemptSegment(path: string[], nextAttempt: number): string[] {
    const replaced = path.map((entry) => (entry.startsWith('attempt:') ? `attempt:${nextAttempt}` : entry));
    if (!replaced.some((entry) => entry.startsWith('attempt:'))) {
        replaced.push(`attempt:${nextAttempt}`);
    }
    return replaced;
}
