import { useCallback, useEffect, useRef, useState } from 'react';
import { socket, emit } from './socket.js';

const MU = 255;
const OUT_RATE = 24000;   // 8 kHz packets are upsampled x3 (some Safari versions reject buffers below 22 kHz)

function decode(bytes) {
  const n = bytes.length, out = new Float32Array(n * 3);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i], y = (b & 127) / 127;
    const x = ((Math.pow(1 + MU, y) - 1) / MU) * (b & 128 ? -1 : 1);
    for (let k = 0; k < 3; k++) out[i * 3 + k] = prev + ((x - prev) * (k + 1)) / 3;   // linear upsample
    prev = x;
  }
  return out;
}

export const radioSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode && (window.AudioContext || window.webkitAudioContext));

/**
 * Walkie-talkie: hold to talk, release to stop. One speaker per channel at a time (the server enforces it).
 * Audio is relayed live by the server to the player's channel only and is never recorded.
 */
export function useRadio({ channel, active }) {
  const [talking, setTalking] = useState(false);
  const [speaker, setSpeaker] = useState(null);
  const [error, setError] = useState('');
  const [muted, setMutedState] = useState(false);
  const r = useRef({ ctx: null, gain: null, next: 0, stream: null, node: null, src: null, wantTalk: false, idleT: null, ready: false }).current;
  const mutedRef = useRef(false);

  const ensureCtx = useCallback(async () => {
    if (!r.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      r.ctx = new AC(); r.gain = r.ctx.createGain(); r.gain.connect(r.ctx.destination);
    }
    if (r.ctx.state !== 'running') await r.ctx.resume();
    return r.ctx;
  }, [r]);

  const beep = useCallback((freq, ms = 70) => {
    const c = r.ctx; if (!c || mutedRef.current) return;
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = freq; g.gain.value = 0.05; o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime + ms / 1000);
  }, [r]);

  // Browsers only allow sound after a tap: unlock audio on the first touch inside the game.
  useEffect(() => {
    if (!active) return;
    const unlock = () => { ensureCtx().catch(() => {}); };
    addEventListener('pointerdown', unlock, { once: true });
    return () => removeEventListener('pointerdown', unlock);
  }, [active, ensureCtx]);

  // incoming audio
  useEffect(() => {
    if (!active) return;
    const idle = () => { setSpeaker(null); r.next = 0; };
    const bump = () => { clearTimeout(r.idleT); r.idleT = setTimeout(idle, 1500); };
    const onTalking = ({ name }) => { setSpeaker(name); bump(); };
    const onIdle = () => { clearTimeout(r.idleT); idle(); beep(420, 50); };
    const onChunk = ({ d }) => {
      bump();
      if (mutedRef.current || !r.ctx || r.ctx.state !== 'running') return;
      const f = decode(new Uint8Array(d));
      const buf = r.ctx.createBuffer(1, f.length, OUT_RATE); buf.copyToChannel(f, 0);
      const src = r.ctx.createBufferSource(); src.buffer = buf; src.connect(r.gain);
      const t = Math.max(r.ctx.currentTime + 0.14, r.next);   // small jitter buffer
      src.start(t); r.next = t + buf.duration;
    };
    socket.on('voice:talking', onTalking); socket.on('voice:idle', onIdle); socket.on('voice:chunk', onChunk);
    return () => { socket.off('voice:talking', onTalking); socket.off('voice:idle', onIdle); socket.off('voice:chunk', onChunk); clearTimeout(r.idleT); };
  }, [active, r, beep]);

  const releaseMic = useCallback(() => { r.stream?.getTracks().forEach((t) => t.stop()); r.stream = null; }, [r]);

  const stop = useCallback(() => {
    r.wantTalk = false;
    if (r.node) { try { r.node.port.postMessage('stop'); r.node.disconnect(); r.src?.disconnect(); } catch { /* ignore */ } r.node = null; r.src = null; emit('voice:end'); beep(420, 50); }
    r.stream?.getAudioTracks().forEach((t) => { t.enabled = false; });
    setTalking(false);
  }, [r, beep]);

  const start = useCallback(async () => {
    if (!channel) { setError('No radio right now.'); return; }
    if (!radioSupported()) { setError('This browser does not support the radio.'); return; }
    r.wantTalk = true; setError('');
    try {
      const ctx = await ensureCtx();
      if (!r.stream) r.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      r.stream.getAudioTracks().forEach((t) => { t.enabled = true; });
      if (!r.wantTalk) { r.stream.getAudioTracks().forEach((t) => { t.enabled = false; }); return; }   // released while the permission prompt was open
      if (!r.ready) { await ctx.audioWorklet.addModule('/ptt-worklet.js'); r.ready = true; }
      const res = await emit('voice:start');
      if (!res.ok) { setError(res.error || 'Channel busy.'); r.stream.getAudioTracks().forEach((t) => { t.enabled = false; }); return; }
      if (!r.wantTalk) { emit('voice:end'); r.stream.getAudioTracks().forEach((t) => { t.enabled = false; }); return; }
      r.src = ctx.createMediaStreamSource(r.stream);
      r.node = new AudioWorkletNode(ctx, 'ptt-capture');
      r.node.port.onmessage = (e) => { if (r.node) socket.emit('voice:chunk', { d: new Uint8Array(e.data) }); };
      r.src.connect(r.node);
      setTalking(true); beep(700, 60);
      setTimeout(() => { if (r.node && r.wantTalk) stop(); }, 29000);   // server limit is 30 s per transmission
    } catch (e) {
      setError(e?.name === 'NotAllowedError' ? 'Microphone blocked. Allow it in your browser settings to use the radio.' : 'Could not start the microphone.');
    }
  }, [channel, ensureCtx, r, beep, stop]);

  // leaving the channel (e.g. incubating) or the screen: stop talking and release the microphone
  useEffect(() => { if (!channel) stop(); }, [channel]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { stop(); releaseMic(); r.ctx?.close?.().catch(() => {}); r.ctx = null; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setMuted = (m) => { mutedRef.current = m; setMutedState(m); };
  return { talking, speaker, error, muted, setMuted, start, stop, supported: radioSupported() };
}
