import { describe, expect, it } from 'vitest';
import { canHearClassAudio, parseAudioFocus } from './audioFocus';
import type { ClassAudioFocus } from '../../api/onlineClasses';

const focus: ClassAudioFocus = { version: 1, classId: 'class', teacherId: 'teacher', studentId: 'a', announceAll: false };
describe('class listening layout', () => {
  it('keeps every pupil audible to the teacher in group, focus and announcement modes', () => {
    for (const mode of [null, focus, { ...focus, announceAll: true }]) {
      for (const pupil of ['a', 'b', 'c']) expect(canHearClassAudio('teacher', pupil, 'teacher', mode)).toBe(true);
    }
  });
  it('isolates the selected conversation while remaining pupils can talk to one another', () => {
    expect(canHearClassAudio('a', 'teacher', 'teacher', focus)).toBe(true);
    for (const pupil of ['b', 'c']) {
      expect(canHearClassAudio(pupil, 'teacher', 'teacher', focus)).toBe(false);
      expect(canHearClassAudio(pupil, 'a', 'teacher', focus)).toBe(false);
      expect(canHearClassAudio('a', pupil, 'teacher', focus)).toBe(false);
    }
    expect(canHearClassAudio('b', 'c', 'teacher', focus)).toBe(true);
    expect(canHearClassAudio('c', 'b', 'teacher', focus)).toBe(true);
  });
  it('announces the teacher to everyone while the selected pupil still answers only the teacher', () => {
    const announcement = { ...focus, announceAll: true };
    for (const pupil of ['a', 'b', 'c']) expect(canHearClassAudio(pupil, 'teacher', 'teacher', announcement)).toBe(true);
    expect(canHearClassAudio('b', 'a', 'teacher', announcement)).toBe(false);
  });
  it('restores group audio when focus is cleared', () => {
    for (const listener of ['teacher', 'a', 'b', 'c']) {
      for (const speaker of ['teacher', 'a', 'b', 'c']) expect(canHearClassAudio(listener, speaker, 'teacher', null)).toBe(true);
    }
  });
  it('accepts only matching server room metadata', () => {
    const encode = (value: unknown) => JSON.stringify({ mcAudioFocus: value });
    expect(parseAudioFocus(encode(focus), 'class', 'teacher')).toEqual(focus);
    for (const invalid of [{ ...focus, version: 2 }, { ...focus, classId: 'other' },
      { ...focus, teacherId: 'pupil' }, { ...focus, studentId: 4 }, { ...focus, studentId: 'teacher' },
      { ...focus, studentId: null, announceAll: true }]) {
      expect(parseAudioFocus(encode(invalid), 'class', 'teacher')).toBeNull();
    }
    expect(parseAudioFocus('{bad', 'class', 'teacher')).toBeNull();
    expect(parseAudioFocus(encode(focus), 'class', null)).toBeNull();
  });
});
