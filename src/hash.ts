import { createHash } from 'node:crypto';

export function hashText(text: string): string {
	return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}
