import { describe, expect, it } from 'vitest';
import {
  MAX_PACKET_BYTES,
  chatEvent,
  encodeEvent,
  handEvent,
  parseClassEvent,
  parseControlEvent,
  reactionEvent,
} from './events';

const CLASS_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_CLASS = '22222222-2222-2222-2222-222222222222';

function pack(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe('class event protocol', () => {
  it('round-trips the events we send', () => {
    expect(parseClassEvent(encodeEvent(handEvent(CLASS_ID, true)), CLASS_ID)).toMatchObject({
      type: 'hand',
      raised: true,
    });
    expect(parseClassEvent(encodeEvent(reactionEvent(CLASS_ID, 'clap')), CLASS_ID)).toMatchObject({
      type: 'reaction',
      emoji: 'clap',
    });
    expect(
      parseClassEvent(encodeEvent(chatEvent(CLASS_ID, 'client-1', 'hello')), CLASS_ID),
    ).toMatchObject({ type: 'chat', body: 'hello' });
  });

  it('drops an event addressed to a different class', () => {
    // Being in a room is not a licence to inject into another class's state.
    const foreign = encodeEvent(handEvent(OTHER_CLASS, true));

    expect(parseClassEvent(foreign, CLASS_ID)).toBeNull();
  });

  it('drops malformed JSON without throwing', () => {
    expect(parseClassEvent(new TextEncoder().encode('{not json'), CLASS_ID)).toBeNull();
  });

  it('drops an oversized packet', () => {
    const huge = pack({
      v: 1,
      type: 'chat',
      classId: CLASS_ID,
      id: 'x',
      at: 1,
      clientMessageId: 'c',
      body: 'a'.repeat(MAX_PACKET_BYTES),
    });

    expect(huge.byteLength).toBeGreaterThan(MAX_PACKET_BYTES);
    expect(parseClassEvent(huge, CLASS_ID)).toBeNull();
  });

  it('rejects an unknown reaction rather than rendering arbitrary text', () => {
    const spoofed = pack({
      v: 1,
      type: 'reaction',
      classId: CLASS_ID,
      id: 'x',
      at: 1,
      emoji: '<img src=x onerror=alert(1)>',
    });

    expect(parseClassEvent(spoofed, CLASS_ID)).toBeNull();
  });

  it('rejects an unknown event type and an unknown version', () => {
    expect(
      parseClassEvent(pack({ v: 1, type: 'mystery', classId: CLASS_ID, id: 'x', at: 1 }), CLASS_ID),
    ).toBeNull();
    expect(
      parseClassEvent(
        pack({ v: 2, type: 'hand', classId: CLASS_ID, id: 'x', at: 1, raised: true }),
        CLASS_ID,
      ),
    ).toBeNull();
  });

  it('rejects pointer coordinates outside the normalized surface', () => {
    const base = { v: 1, type: 'pointer', classId: CLASS_ID, id: 'x', at: 1, targetId: 'board' };

    expect(parseClassEvent(pack({ ...base, x: 0.5, y: 0.5 }), CLASS_ID)).toMatchObject({
      type: 'pointer',
    });
    expect(parseClassEvent(pack({ ...base, x: 1.5, y: 0.5 }), CLASS_ID)).toBeNull();
    expect(parseClassEvent(pack({ ...base, x: -0.1, y: 0.5 }), CLASS_ID)).toBeNull();
  });

  it('rejects an empty or over-long chat body', () => {
    const base = { v: 1, type: 'chat', classId: CLASS_ID, id: 'x', at: 1, clientMessageId: 'c' };

    expect(parseClassEvent(pack({ ...base, body: '' }), CLASS_ID)).toBeNull();
    expect(parseClassEvent(pack({ ...base, body: 'a'.repeat(2001) }), CLASS_ID)).toBeNull();
  });

  it('ignores a role claimed inside a packet', () => {
    // Authority comes from the server, never from payload contents.
    const claiming = parseClassEvent(
      pack({ v: 1, type: 'hand', classId: CLASS_ID, id: 'x', at: 1, raised: true, role: 'HOST' }),
      CLASS_ID,
    );

    expect(claiming).not.toBeNull();
    expect(Object.keys(claiming as object)).not.toContain('trustedRole');
  });

  it('parses a server control event and rejects a foreign one', () => {
    const control = pack({
      v: 1,
      type: 'unmute-request',
      classId: CLASS_ID,
      userId: 'user-1',
      version: 1,
    });

    expect(parseControlEvent(control, CLASS_ID)).toMatchObject({ type: 'unmute-request' });
    expect(parseControlEvent(control, OTHER_CLASS)).toBeNull();
  });
});
