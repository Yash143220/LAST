// Push-to-talk capture. Runs in the audio thread: mono input -> 8 kHz -> 8-bit companded bytes, 100 ms per packet (800 bytes).
const MU = 255;
const LOG = Math.log1p(MU);
function encode(x) {
  x = Math.max(-1, Math.min(1, x));
  const y = Math.log1p(MU * Math.abs(x)) / LOG;       // 0..1
  return ((x < 0 ? 1 : 0) << 7) | Math.round(y * 127);
}
class PttCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 8000; this.pos = 0; this.acc = 0; this.n = 0;
    this.out = new Uint8Array(800); this.i = 0; this.on = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; };
  }
  process(inputs) {
    if (!this.on) return false;
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let k = 0; k < ch.length; k++) {
      this.acc += ch[k]; this.n++; this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        this.out[this.i++] = encode(this.acc / this.n); this.acc = 0; this.n = 0;
        if (this.i === this.out.length) { this.port.postMessage(this.out.buffer, [this.out.buffer]); this.out = new Uint8Array(800); this.i = 0; }
      }
    }
    return true;
  }
}
registerProcessor('ptt-capture', PttCapture);
