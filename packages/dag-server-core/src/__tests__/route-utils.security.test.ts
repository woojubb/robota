import { describe, expect, it } from 'vitest';
import { isAllowedInlineMediaType, sanitizeFileName } from '../routes/route-utils.js';

describe('isAllowedInlineMediaType', () => {
    it('allows safe image types', () => {
        expect(isAllowedInlineMediaType('image/png')).toBe(true);
        expect(isAllowedInlineMediaType('image/jpeg')).toBe(true);
        expect(isAllowedInlineMediaType('image/gif')).toBe(true);
        expect(isAllowedInlineMediaType('image/webp')).toBe(true);
    });

    it('allows safe document types', () => {
        expect(isAllowedInlineMediaType('application/pdf')).toBe(true);
        expect(isAllowedInlineMediaType('text/plain')).toBe(true);
        expect(isAllowedInlineMediaType('text/csv')).toBe(true);
        expect(isAllowedInlineMediaType('application/json')).toBe(true);
    });

    it('allows safe audio and video types', () => {
        expect(isAllowedInlineMediaType('audio/mpeg')).toBe(true);
        expect(isAllowedInlineMediaType('video/mp4')).toBe(true);
        expect(isAllowedInlineMediaType('video/webm')).toBe(true);
    });

    it('rejects text/html to prevent XSS', () => {
        expect(isAllowedInlineMediaType('text/html')).toBe(false);
    });

    it('rejects application/xhtml+xml', () => {
        expect(isAllowedInlineMediaType('application/xhtml+xml')).toBe(false);
    });

    it('rejects text/xml and application/xml', () => {
        expect(isAllowedInlineMediaType('text/xml')).toBe(false);
        expect(isAllowedInlineMediaType('application/xml')).toBe(false);
    });

    it('rejects application/javascript', () => {
        expect(isAllowedInlineMediaType('application/javascript')).toBe(false);
    });

    it('normalizes to lowercase', () => {
        expect(isAllowedInlineMediaType('Image/PNG')).toBe(true);
        expect(isAllowedInlineMediaType('TEXT/HTML')).toBe(false);
    });

    it('strips parameters before checking', () => {
        expect(isAllowedInlineMediaType('text/plain; charset=utf-8')).toBe(true);
        expect(isAllowedInlineMediaType('text/html; charset=utf-8')).toBe(false);
    });
});

describe('sanitizeFileName', () => {
    it('passes through safe file names unchanged', () => {
        expect(sanitizeFileName('document.pdf')).toBe('document.pdf');
        expect(sanitizeFileName('my-image_2024.png')).toBe('my-image_2024.png');
    });

    it('replaces double quotes with underscores', () => {
        expect(sanitizeFileName('file"name.txt')).toBe('file_name.txt');
    });

    it('replaces backslashes with underscores', () => {
        expect(sanitizeFileName('file\\name.txt')).toBe('file_name.txt');
    });

    it('replaces multiple dangerous characters', () => {
        expect(sanitizeFileName('"file\\name".txt')).toBe('_file_name_.txt');
    });

    it('handles empty string', () => {
        expect(sanitizeFileName('')).toBe('');
    });
});
