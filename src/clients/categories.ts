import type { CallCategory, ClientConfig } from './types';

/** Categories every client gets regardless of its Retell tools (see deriveCategory in lib/retell). */
const PRODUCT_CALL_CATEGORIES: Record<string, CallCategory> = {
  general: { label: 'General', tone: 'slate' },
  transfer_only: { label: 'Transfer only', tone: 'rose' },
};

export function callCategoriesFor(client: ClientConfig): Record<string, CallCategory> {
  return { ...PRODUCT_CALL_CATEGORIES, ...client.callCategories };
}
