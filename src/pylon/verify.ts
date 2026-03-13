import type { WebhookVerificationResult } from './types';

const WEBHOOK_SECRET = process.env.PYLON_WEBHOOK_SECRET || '';

// Compute HMAC-SHA256 signature
async function computeSignature(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const data = encoder.encode(payload);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, data);
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time string comparison to prevent timing attacks
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  timestamp: string | null
): Promise<WebhookVerificationResult> {
  // Skip verification if no secret configured (development mode)
  if (!WEBHOOK_SECRET) {
    console.warn('PYLON_WEBHOOK_SECRET not configured - skipping signature verification');
    return { valid: true };
  }

  if (!signature) {
    return { valid: false, error: 'Missing signature header' };
  }

  if (!timestamp) {
    return { valid: false, error: 'Missing timestamp header' };
  }

  // Check timestamp is within 5 minutes to prevent replay attacks
  const timestampMs = parseInt(timestamp, 10) * 1000;
  const now = Date.now();
  const fiveMinutesMs = 5 * 60 * 1000;

  if (isNaN(timestampMs) || Math.abs(now - timestampMs) > fiveMinutesMs) {
    return { valid: false, error: 'Timestamp outside valid window' };
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = await computeSignature(signedPayload, WEBHOOK_SECRET);

  // Remove any prefix from signature (e.g., "sha256=")
  const providedSignature = signature.replace(/^sha256=/, '');

  if (!secureCompare(expectedSignature, providedSignature.toLowerCase())) {
    return { valid: false, error: 'Invalid signature' };
  }

  return { valid: true };
}

// Parse signature header (format: "t=timestamp,v1=signature")
export function parseSignatureHeader(header: string): { timestamp: string | null; signature: string | null } {
  const parts = header.split(',');
  let timestamp: string | null = null;
  let signature: string | null = null;

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') {
      timestamp = value;
    } else if (key === 'v1') {
      signature = value;
    }
  }

  return { timestamp, signature };
}
