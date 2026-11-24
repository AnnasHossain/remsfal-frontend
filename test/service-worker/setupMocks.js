import { vi } from 'vitest';

// Store event listeners for tests
globalThis.eventListeners = {};

globalThis.self = {
  __WB_MANIFEST: [],
  addEventListener: vi.fn().mockImplementation((event, handler) => {
    if (!globalThis.eventListeners[event]) {
      globalThis.eventListeners[event] = [];
    }
    globalThis.eventListeners[event].push(handler);
  }),
  clients: {
    claim: vi.fn().mockResolvedValue(undefined),
    matchAll: vi.fn(),
    openWindow: vi.fn(),
  },
  navigator: { language: 'de-DE' },
  registration: { showNotification: vi.fn() },
  location: { origin: 'https://example.com' },
};

globalThis.caches = {
  open: vi.fn().mockResolvedValue({
    put: vi.fn().mockResolvedValue(),
    match: vi.fn().mockResolvedValue(null),
  }),
  keys: vi.fn().mockResolvedValue([]),
  delete: vi.fn().mockResolvedValue(true),
  match: vi.fn().mockResolvedValue(null),
};
