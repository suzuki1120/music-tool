/**
 * Recorder — taps the master output and writes a 16-bit stereo WAV.
 *
 *   start() / stop() → Blob          (manual)
 *   armBars(n)                        auto-stop after n bars (set by the UI from the sequencer's onBar)
 */
class Recorder {
    constructor(engine) {
        this.engine = engine;
        this.node = null;
        this.sink = null;
        this.recording = false;
        this.chunksL = [];
        this.chunksR = [];
        this.frames = 0;
        this.startedAt = 0;
        this.onStateChange = null;
    }

    attach() {
        if (this.node || !this.engine.ctx || !this.engine.limiter) return;
        const ctx = this.engine.ctx;
        this.node = ctx.createScriptProcessor(4096, 2, 2);
        this.node.onaudioprocess = (e) => {
            const out = e.outputBuffer;
            for (let c = 0; c < out.numberOfChannels; c++) out.getChannelData(c).fill(0);
            if (!this.recording) return;
            const inb = e.inputBuffer;
            const l = inb.getChannelData(0);
            const r = inb.numberOfChannels > 1 ? inb.getChannelData(1) : l;
            this.chunksL.push(new Float32Array(l));
            this.chunksR.push(new Float32Array(r));
            this.frames += l.length;
        };
        this.sink = ctx.createGain();
        this.sink.gain.value = 0;
        this.engine.limiter.connect(this.node);
        this.node.connect(this.sink);
        this.sink.connect(ctx.destination);
    }

    start() {
        if (!this.engine.init()) return false;
        this.attach();
        if (!this.node) return false;
        this.chunksL = [];
        this.chunksR = [];
        this.frames = 0;
        this.recording = true;
        this.startedAt = this.engine.currentTime;
        if (this.onStateChange) this.onStateChange(true);
        return true;
    }

    get duration() {
        return this.engine.ctx ? this.frames / this.engine.ctx.sampleRate : 0;
    }

    stop() {
        if (!this.recording) return null;
        this.recording = false;
        const blob = this._encode();
        this.chunksL = [];
        this.chunksR = [];
        if (this.onStateChange) this.onStateChange(false);
        return blob;
    }

    _encode() {
        const rate = this.engine.ctx.sampleRate;
        const n = this.frames;
        const buffer = new ArrayBuffer(44 + n * 4);
        const view = new DataView(buffer);
        const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
        str(0, 'RIFF');
        view.setUint32(4, 36 + n * 4, true);
        str(8, 'WAVE');
        str(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);        // PCM
        view.setUint16(22, 2, true);        // stereo
        view.setUint32(24, rate, true);
        view.setUint32(28, rate * 4, true); // byte rate
        view.setUint16(32, 4, true);        // block align
        view.setUint16(34, 16, true);       // bits
        str(36, 'data');
        view.setUint32(40, n * 4, true);

        let off = 44;
        for (let c = 0; c < this.chunksL.length; c++) {
            const l = this.chunksL[c], r = this.chunksR[c];
            for (let i = 0; i < l.length; i++) {
                const a = Math.max(-1, Math.min(1, l[i]));
                const b = Math.max(-1, Math.min(1, r[i]));
                view.setInt16(off, a < 0 ? a * 0x8000 : a * 0x7FFF, true);
                view.setInt16(off + 2, b < 0 ? b * 0x8000 : b * 0x7FFF, true);
                off += 4;
            }
        }
        return new Blob([buffer], { type: 'audio/wav' });
    }
}
