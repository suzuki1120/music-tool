/**
 * AudioEngine — shared Web Audio context, mixer channels and master chain.
 *
 *   voice → channel(id) [pan → level → sends] → duckBus (sidechain) → input → [ChaosFX inserts] → masterGain
 *                                   └ kick bypasses the duck bus and feeds input directly
 *   masterGain → hp → lp (DJ isolator) → performGain → compressor → limiter → destination
 *                                                                     ├→ analyser (LCD scope)
 *                                                                     └→ recorder tap
 *   channel sends → sendDelay / sendReverb buses → ChaosFX delay / reverb → masterGain (returns)
 *
 *   mixState(id) holds the user facing mixer values even before the context exists, so saved
 *   sessions can be restored before the first user gesture.
 */
class AudioEngine {
    constructor() {
        this.ctx = null;
        this.input = null;
        this.duckBus = null;
        this.sendDelay = null;
        this.sendReverb = null;
        this.masterGain = null;
        this.hp = null;
        this.lp = null;
        this.performGain = null;
        this.compressor = null;
        this.limiter = null;
        this.analyser = null;
        this.isInitialized = false;
        this.masterVolume = 0.75;
        this.pitchFactor = 1;
        this._noiseBuffer = null;
        this.onInit = null;
        this.onMixChange = null;   // (id) → UI refresh

        this.mix = {};             // id → { level, pan, mute, solo, sendDelay, sendReverb, autoMute }
        this.channels = {};        // id → nodes
        this.noDuck = new Set(['kick']);
        this.sidechain = { enabled: false, depth: 0.55, release: 0.18 };
        this.filterValue = 0;      // -100 (low pass) … 0 (flat) … +100 (high pass)
        this.filterAuto = null;    // { from, to, t0, t1 } while a song section sweeps the filter
    }

    init() {
        if (this.isInitialized) return true;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;

        this.ctx = new AC({ latencyHint: 'interactive' });
        const ctx = this.ctx;

        this.input = ctx.createGain();
        this.duckBus = ctx.createGain();
        this.duckBus.connect(this.input);

        this.sendDelay = ctx.createGain();
        this.sendReverb = ctx.createGain();

        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = this.masterVolume;

        this.hp = ctx.createBiquadFilter();
        this.hp.type = 'highpass';
        this.hp.frequency.value = 20;
        this.hp.Q.value = 0.7;
        this.lp = ctx.createBiquadFilter();
        this.lp.type = 'lowpass';
        this.lp.frequency.value = 20000;
        this.lp.Q.value = 0.7;

        this.performGain = ctx.createGain();
        this.performGain.gain.value = 1;

        // Glue compressor
        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -14;
        this.compressor.knee.value = 12;
        this.compressor.ratio.value = 3;
        this.compressor.attack.value = 0.004;
        this.compressor.release.value = 0.2;

        // Brick-wall-ish safety limiter
        this.limiter = ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -2;
        this.limiter.knee.value = 0;
        this.limiter.ratio.value = 20;
        this.limiter.attack.value = 0.001;
        this.limiter.release.value = 0.08;

        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.6;

        this.input.connect(this.masterGain);
        this.masterGain.connect(this.hp);
        this.hp.connect(this.lp);
        this.lp.connect(this.performGain);
        this.performGain.connect(this.compressor);
        this.compressor.connect(this.limiter);
        this.limiter.connect(ctx.destination);
        this.limiter.connect(this.analyser);

        this.isInitialized = true;
        this._applyFilter(this.filterValue, ctx.currentTime);
        Object.keys(this.mix).forEach(id => this.channel(id));
        if (this.onInit) this.onInit();
        return true;
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') return this.ctx.resume();
        return Promise.resolve();
    }

    get currentTime() { return this.ctx ? this.ctx.currentTime : 0; }

    /** Pre-FX sum (used for anything that has no mixer channel). */
    get dest() { return this.input; }

    setMasterVolume(value) {
        this.masterVolume = Math.max(0, Math.min(1, value));
        if (this.masterGain) {
            const now = this.ctx.currentTime;
            this.masterGain.gain.cancelScheduledValues(now);
            this.masterGain.gain.setTargetAtTime(this.masterVolume, now, 0.02);
        }
    }

    // ---------------------------------------------------------------- mixer
    mixState(id) {
        if (!this.mix[id]) {
            this.mix[id] = { level: 0.8, pan: 0, mute: false, solo: false, sendDelay: 1, sendReverb: 1, autoMute: false };
        }
        return this.mix[id];
    }

    /** Lazily build the channel strip nodes for `id`. */
    channel(id) {
        if (!this.ctx) return null;
        if (this.channels[id]) return this.channels[id];
        const ctx = this.ctx;
        const ch = { in: ctx.createGain(), pan: null, out: ctx.createGain(), sendD: ctx.createGain(), sendR: ctx.createGain() };
        ch.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
        ch.in.connect(ch.pan);
        ch.pan.connect(ch.out);
        ch.out.connect(this.noDuck.has(id) ? this.input : this.duckBus);
        ch.out.connect(ch.sendD);
        ch.out.connect(ch.sendR);
        ch.sendD.connect(this.sendDelay);
        ch.sendR.connect(this.sendReverb);
        this.channels[id] = ch;
        this._applyChannel(id, ctx.currentTime, true);
        return ch;
    }

    /** Where a voice should connect. Falls back to the pre-FX input before the context exists. */
    channelInput(id) {
        const ch = this.channel(id);
        return ch ? ch.in : this.input;
    }

    _anySolo() {
        return Object.keys(this.mix).some(k => this.mix[k].solo);
    }

    effectiveGain(id) {
        const m = this.mixState(id);
        if (m.mute || m.autoMute) return 0;
        if (this._anySolo() && !m.solo) return 0;
        return m.level;
    }

    _applyChannel(id, time, immediate = false) {
        const ch = this.channels[id];
        if (!ch) return;
        const m = this.mixState(id);
        const t = time ?? this.ctx.currentTime;
        const g = this.effectiveGain(id);
        if (immediate) {
            ch.out.gain.value = g;
            if (ch.pan.pan) ch.pan.pan.value = m.pan;
            ch.sendD.gain.value = m.sendDelay;
            ch.sendR.gain.value = m.sendReverb;
            return;
        }
        ch.out.gain.cancelScheduledValues(t);
        ch.out.gain.setTargetAtTime(g, t, 0.012);
        if (ch.pan.pan) ch.pan.pan.setTargetAtTime(m.pan, t, 0.02);
        ch.sendD.gain.setTargetAtTime(m.sendDelay, t, 0.02);
        ch.sendR.gain.setTargetAtTime(m.sendReverb, t, 0.02);
    }

    _applyAll(time) {
        Object.keys(this.channels).forEach(id => this._applyChannel(id, time));
    }

    setLevel(id, v) { this.mixState(id).level = Math.max(0, Math.min(1, v)); this._applyChannel(id); this._emit(id); }
    setPan(id, v) { this.mixState(id).pan = Math.max(-1, Math.min(1, v)); this._applyChannel(id); this._emit(id); }
    setSend(id, which, v) {
        const m = this.mixState(id);
        if (which === 'delay') m.sendDelay = Math.max(0, Math.min(1, v)); else m.sendReverb = Math.max(0, Math.min(1, v));
        this._applyChannel(id);
        this._emit(id);
    }
    setMute(id, on) { this.mixState(id).mute = !!on; this._applyChannel(id); this._emit(id); }
    setSolo(id, on) { this.mixState(id).solo = !!on; this._applyAll(); this._emit(id); }
    clearSolo() { Object.keys(this.mix).forEach(k => { this.mix[k].solo = false; }); this._applyAll(); this._emit(null); }

    /** Mutes driven by the song arranger — separate from the user's own mute buttons. */
    setAutoMute(id, on, time) {
        this.mixState(id).autoMute = !!on;
        this._applyChannel(id, time);
    }
    clearAutoMutes(time) {
        Object.keys(this.mix).forEach(k => { this.mix[k].autoMute = false; });
        this._applyAll(time);
        this._emit(null);
    }

    _emit(id) { if (this.onMixChange) this.onMixChange(id); }

    // ---------------------------------------------------------------- sidechain
    setSidechain(opts = {}) {
        if (opts.enabled !== undefined) this.sidechain.enabled = !!opts.enabled;
        if (opts.depth !== undefined) this.sidechain.depth = Math.max(0, Math.min(1, opts.depth));
        if (opts.release !== undefined) this.sidechain.release = Math.max(0.03, Math.min(1, opts.release));
        if (!this.sidechain.enabled && this.duckBus) {
            const t = this.ctx.currentTime;
            this.duckBus.gain.cancelScheduledValues(t);
            this.duckBus.gain.setTargetAtTime(1, t, 0.02);
        }
    }

    /** Called on every kick hit — pumps everything that is not the kick. */
    duck(time) {
        if (!this.sidechain.enabled || !this.duckBus) return;
        const g = this.duckBus.gain;
        const d = this.sidechain.depth;
        g.cancelScheduledValues(time);
        g.setValueAtTime(1, time);
        g.linearRampToValueAtTime(1 - d, time + 0.006);
        g.setTargetAtTime(1, time + 0.02, this.sidechain.release / 3);
    }

    // ---------------------------------------------------------------- master filter
    /**
     * value: -100 … 100. Negative sweeps a low pass down to 120 Hz, positive sweeps a high pass up to 8 kHz.
     */
    setFilter(value, { time } = {}) {
        this._stopSweep();
        this.filterValue = Math.max(-100, Math.min(100, Number(value) || 0));
        if (!this.ctx) return;
        this._applyFilter(this.filterValue, time ?? this.ctx.currentTime);
    }

    _filterFreqs(v) {
        const a = Math.min(1, Math.abs(v) / 100);
        const lp = v < 0 ? 20000 * Math.pow(120 / 20000, a) : 20000;
        const hp = v > 0 ? 20 * Math.pow(8000 / 20, a) : 20;
        const q = 0.7 + 0.9 * a;
        return { lp, hp, q };
    }

    _applyFilter(v, time) {
        const { lp, hp, q } = this._filterFreqs(v);
        [[this.lp.frequency, lp], [this.hp.frequency, hp]].forEach(([param, val]) => {
            param.cancelScheduledValues(time);
            param.setTargetAtTime(val, time, 0.02);
        });
        this.lp.Q.setTargetAtTime(q, time, 0.05);
        this.hp.Q.setTargetAtTime(q, time, 0.05);
    }

    /**
     * Song automation: sweep from → to between audio times t0 and t1.
     * Driven by a timer (not AudioParam ramps) so a sweep can be interrupted or re-targeted at any bar.
     */
    sweepFilter(from, to, t0, t1) {
        if (!this.ctx) return;
        this._stopSweep();
        this.filterAuto = { from, to, t0, t1: Math.max(t0 + 0.05, t1) };
        const tickFn = () => {
            if (!this.filterAuto) return;
            const now = this.ctx.currentTime;
            if (now < this.filterAuto.t0) return;
            this._applyFilter(this.displayFilterValue(), now);
            if (now >= this.filterAuto.t1) this._stopSweep(true);
        };
        this._sweepTimer = setInterval(tickFn, 40);
        tickFn();
    }

    _stopSweep(keepState = false) {
        if (this._sweepTimer) { clearInterval(this._sweepTimer); this._sweepTimer = null; }
        if (!keepState) this.filterAuto = null;
    }

    /** Current filter value for display while a sweep runs. */
    displayFilterValue() {
        const a = this.filterAuto;
        if (!a || !this.ctx) return this.filterValue;
        const t = this.ctx.currentTime;
        if (t >= a.t1) return a.to;
        if (t <= a.t0) return a.from;
        return a.from + (a.to - a.from) * ((t - a.t0) / (a.t1 - a.t0));
    }

    // ---------------------------------------------------------------- utilities
    /** Cached white-noise buffer shared by the drum voices. */
    getNoiseBuffer() {
        if (this._noiseBuffer) return this._noiseBuffer;
        const sampleRate = this.ctx.sampleRate;
        const length = sampleRate * 2;
        const buffer = this.ctx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        this._noiseBuffer = buffer;
        return buffer;
    }

    /** Audio-clock time → performance.now() milliseconds (Web MIDI timestamps). */
    audioTimeToPerf(t) {
        if (!this.ctx) return performance.now();
        return performance.now() + (t - this.ctx.currentTime) * 1000;
    }
}

const audioEngine = new AudioEngine();
