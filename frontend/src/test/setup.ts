import '@testing-library/jest-dom/vitest';

// jsdom implements neither matchMedia nor the media-device APIs, both of which
// the class UI queries on mount. Tests that care about device behaviour stub
// these explicitly; this keeps everything else from crashing on import.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
