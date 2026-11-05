import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RoomAudioRenderer, RoomContext } from '@livekit/components-react';
import { Room, Track } from 'livekit-client';
import { useClassAudioFocus } from '../../src/features/online-classes/useClassAudioFocus';

const config = (window as any).audioFocusTestConfig;
const room = new Room({ adaptiveStream: false, dynacast: false });
const frequencies: Record<string, number> = { teacher: 440, a: 550, b: 660, c: 770 };
const errors: string[] = [];
(window as any).audioFocusFixture = { room, errors, ready: false };

function AudioFixture() {
  const audio = useClassAudioFocus('audio-qa', 'teacher', config.identity === 'teacher');
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  useEffect(() => {
    let active = true;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const destination = context.createMediaStreamDestination();
    oscillator.frequency.value = frequencies[config.identity];
    oscillator.connect(destination); oscillator.start();
    void (async () => {
      await context.resume();
      await room.connect('ws://127.0.0.1:7880', config.token);
      await room.localParticipant.publishTrack(destination.stream.getAudioTracks()[0], { source: Track.Source.Microphone });
      if (active) { setReady(true); (window as any).audioFocusFixture.ready = true; }
    })().catch(error => { errors.push(String(error)); if (active) setStartupError(String(error)); });
    return () => { active = false; void room.disconnect(); oscillator.stop(); void context.close(); };
  }, []);
  return <>
    <h1>{config.identity}</h1><p data-testid="ready">{ready ? 'ready' : 'connecting'}</p>
    <p data-testid="startup-error">{startupError}</p>
    <p data-testid="focus">{audio.focus?.studentId ?? 'group'}:{String(audio.focus?.announceAll ?? false)}</p>
    <p data-testid="error">{String(audio.error)}</p>
    {config.identity === 'teacher' && <>
      {['a', 'b', 'c'].map(pupil => <button key={pupil} onClick={() => audio.change(pupil)}>Open {pupil}</button>)}
      <button onClick={() => audio.change(null)}>Back</button>
      <button onClick={() => audio.change(audio.focus?.studentId ?? null, !audio.focus?.announceAll)}>Announce</button>
    </>}
    <RoomAudioRenderer />
  </>;
}
createRoot(document.getElementById('root')!).render(<RoomContext.Provider value={room}><AudioFixture /></RoomContext.Provider>);
