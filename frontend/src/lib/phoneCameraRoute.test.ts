import { describe, expect, it } from 'vitest';
import { phoneCameraEntryRoute } from './phoneCameraRoute';

describe('public camera QR entry', () => {
  it('restores the public route while preserving the fragment-only pairing secret', () => {
    expect(phoneCameraEntryRoute('/', '?mindcraftiCamera=1', '#cameraId=abc&token=secret'))
      .toBe('/phone-camera#cameraId=abc&token=secret');
  });

  it('keeps unrelated query parameters without promoting the secret into the query', () => {
    expect(phoneCameraEntryRoute('/', '?lang=de&mindcraftiCamera=1', '#token=secret'))
      .toBe('/phone-camera?lang=de#token=secret');
  });

  it('does not override lesson navigation or accept a different flag value', () => {
    expect(phoneCameraEntryRoute('/teacher/lessons', '?mindcraftiCamera=1', '#token=secret')).toBeNull();
    expect(phoneCameraEntryRoute('/', '?mindcraftiCamera=0', '#token=secret')).toBeNull();
    expect(phoneCameraEntryRoute('/', '?mindcraftiReturn=lesson', '')).toBeNull();
  });
});
