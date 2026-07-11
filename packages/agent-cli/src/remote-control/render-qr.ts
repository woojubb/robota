import QRCode from 'qrcode';

/**
 * Render a scannable QR code as a terminal string (REMOTE-008). The operator scans it on a device to open
 * the pairing link (whose fragment carries the high-entropy secret). Best-effort — callers fall back to the
 * plain link if this rejects.
 */
export function renderQrToTerminal(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'terminal', small: true });
}
