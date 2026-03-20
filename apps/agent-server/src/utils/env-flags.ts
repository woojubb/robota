export function resolveApiDocsEnabled(rawValue: string | undefined): boolean {
    if (typeof rawValue !== 'string') {
        return true;
    }
    const normalized = rawValue.trim().toLowerCase();
    return normalized !== '0' && normalized !== 'false' && normalized !== 'off';
}
