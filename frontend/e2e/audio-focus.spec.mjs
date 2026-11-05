import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

// Throw-away local SFU credentials, never production credentials.
const base = 'http://127.0.0.1:7880';
function token(identity, room, admin = false) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = encode({ iss: 'devkey', sub: identity, iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600, video: admin
      ? { roomAdmin: true, roomCreate: true, room } : { roomJoin: true, room, canPublish: true, canSubscribe: true } });
  const body = encode({ alg: 'HS256', typ: 'JWT' }) + '.' + payload;
  return body + '.' + createHmac('sha256', 'secret').update(body).digest('base64url');
}

async function audible(page) {
  return page.evaluate(async () => {
    const fixture = window.audioFocusFixture;
    fixture.analysis ??= { context: new AudioContext(), tracks: new Map() };
    await fixture.analysis.context.resume();
    const result = [];
    for (const peer of fixture.room.remoteParticipants.values()) {
      const mic = [...peer.trackPublications.values()].find(p => p.source === 'microphone');
      const track = mic?.track?.mediaStreamTrack;
      if (!mic?.isSubscribed || !track) continue;
      let analyser = fixture.analysis.tracks.get(track.id);
      if (!analyser) {
        analyser = fixture.analysis.context.createAnalyser();
        analyser.fftSize = 2048;
        fixture.analysis.context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
        fixture.analysis.tracks.set(track.id, analyser);
      }
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      const energy = Math.sqrt(samples.reduce((sum, n) => sum + n * n, 0) / samples.length);
      if (energy > .03) result.push(peer.identity.split('|')[0]);
    }
    return result.sort();
  });
}

test('real SFU keeps all three pupils audible to teacher across focus, announcements, Back and re-entry', async ({ browser, request }, testInfo) => {
  const roomName = 'audio-qa-' + Date.now();
  const clients = new Map();
  const admin = token('test-controller', roomName, true);
  const matrix = {
    group: { teacher: ['a', 'b', 'c'], a: ['b', 'c', 'teacher'], b: ['a', 'c', 'teacher'], c: ['a', 'b', 'teacher'] },
    a: { teacher: ['a', 'b', 'c'], a: ['teacher'], b: ['c'], c: ['b'] },
    announceA: { teacher: ['a', 'b', 'c'], a: ['teacher'], b: ['c', 'teacher'], c: ['b', 'teacher'] },
    b: { teacher: ['a', 'b', 'c'], a: ['c'], b: ['teacher'], c: ['a'] },
  };
  async function check(expected) {
    await Promise.all(Object.entries(expected).map(async ([identity, wanted]) => {
      await expect.poll(() => audible(clients.get(identity).page), { timeout: 15000, message: identity + ' audible streams' }).toEqual([...wanted].sort());
      expect(await clients.get(identity).page.evaluate(() => window.audioFocusFixture.errors)).toEqual([]);
      await expect(clients.get(identity).page.getByTestId('error')).toHaveText('false');
    }));
  }
  try {
    for (const identity of ['teacher', 'a', 'b', 'c']) {
      const context = await browser.newContext();
      await context.addInitScript(config => { window.audioFocusTestConfig = config; }, { identity, token: token(identity + '|browser', roomName) });
      await context.route('**/api/v1/online-classes/audio-qa/audio-focus', async route => {
        if (identity !== 'teacher') return route.fulfill({ status: 403, json: { message: 'Forbidden' } });
        const body = route.request().postDataJSON();
        const focus = { version: 1, classId: 'audio-qa', teacherId: 'teacher', studentId: body.studentId, announceAll: body.announceAll };
        const response = await request.post(base + '/twirp/livekit.RoomService/UpdateRoomMetadata', {
          headers: { Authorization: 'Bearer ' + admin }, data: { room: roomName, metadata: JSON.stringify({ mcAudioFocus: focus }) },
        });
        expect(response.ok()).toBe(true);
        await route.fulfill({ json: focus });
      });
      const page = await context.newPage();
      clients.set(identity, { context, page });
      await page.goto('/e2e/fixtures/audio-focus.html');
      await expect(page.getByTestId('ready')).toHaveText('ready', { timeout: 20000 });
    }
    const teacher = clients.get('teacher').page;
    await check(matrix.group);
    await teacher.getByRole('button', { name: 'Open a', exact: true }).click();
    await check(matrix.a);
    await teacher.getByRole('button', { name: 'Announce', exact: true }).click();
    await check(matrix.announceA);
    await teacher.getByRole('button', { name: 'Announce', exact: true }).click();
    await check(matrix.a);
    await teacher.getByRole('button', { name: 'Open b', exact: true }).click();
    await check(matrix.b);
    await clients.get('b').page.reload();
    await expect(clients.get('b').page.getByTestId('ready')).toHaveText('ready', { timeout: 20000 });
    await check(matrix.b);
    await teacher.evaluate(() => window.audioFocusFixture.room.disconnect());
    await check({ a: ['b', 'c'], b: ['a', 'c'], c: ['a', 'b'] });
    await teacher.reload();
    await expect(teacher.getByTestId('ready')).toHaveText('ready', { timeout: 20000 });
    await check(matrix.b);
    await teacher.getByRole('button', { name: 'Back', exact: true }).click();
    await check(matrix.group);
    await testInfo.attach('audio-matrix', { body: JSON.stringify(matrix, null, 2), contentType: 'application/json' });
  } finally {
    await Promise.all([...clients.values()].map(client => client.context.close()));
    await request.post(base + '/twirp/livekit.RoomService/DeleteRoom', { headers: { Authorization: 'Bearer ' + admin }, data: { room: roomName } });
  }
});
