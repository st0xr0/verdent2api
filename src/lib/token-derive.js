import { createHash } from 'node:crypto';

export function deriveAgentApiTokenFromNonce(nonce) {
  if (typeof nonce !== 'string' || !nonce.trim()) {
    throw new Error('nonce_required');
  }

  return createHash('md5').update(`verdent_${nonce.trim()}_app`, 'utf8').digest('hex');
}
