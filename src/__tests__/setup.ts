globalThis.document = {
  addEventListener: () => {},
  getElementById: () => null,
  createElement: () => ({}),
  querySelector: () => null,
  querySelectorAll: () => [],
} as any;

if (!globalThis.window) {
  (globalThis as any).window = globalThis;
}

Object.defineProperty(globalThis, 'location', {
  value: { pathname: '/', search: '', hash: '' },
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, 'history', {
  value: { pushState: () => {} },
  writable: true,
  configurable: true,
});
