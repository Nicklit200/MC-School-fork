import { describe, expect, it } from 'vitest';
import { translations } from './translations';

/**
 * DE is typed as `Record<keyof typeof ru, string>`, so a missing key is already
 * a compile error. These tests catch what the type cannot: an empty string, or
 * a German entry left as its Russian original.
 */
describe('translations', () => {
  const ru = translations.RU;
  const de = translations.DE;

  it('defines the same keys in both languages', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(ru).sort());
  });

  it('has no blank values', () => {
    for (const [key, value] of Object.entries(ru)) {
      expect(value.trim(), `RU ${key} is blank`).not.toBe('');
    }
    for (const [key, value] of Object.entries(de)) {
      expect(value.trim(), `DE ${key} is blank`).not.toBe('');
    }
  });

  it('covers every online-class key in both languages', () => {
    const onlineClassKeys = Object.keys(ru).filter((key) => key.startsWith('onlineClass.'));

    expect(onlineClassKeys.length).toBeGreaterThan(20);
    for (const key of onlineClassKeys) {
      expect(de[key as keyof typeof de], `DE missing ${key}`).toBeTruthy();
    }
  });

  it('does not leave Cyrillic text in the German set', () => {
    const cyrillic = /[Ѐ-ӿ]/;
    const untranslated = Object.entries(de)
      // Proper nouns are intentionally identical across languages.
      .filter(([key]) => key !== 'app.name')
      .filter(([, value]) => cyrillic.test(value))
      .map(([key]) => key);

    expect(untranslated).toEqual([]);
  });
});
