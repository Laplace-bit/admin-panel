import { createContext } from 'react';

/**
 * Scrolls to a Global overrides (`endpoints.all`) setting on the same page.
 * Provided by the AI providers tab, so an "Overridden by Global" chip there
 * links to the value that wins (D11); elsewhere the chip has no link.
 */
export const GlobalRevealContext = createContext<((path: string) => void) | null>(null);
