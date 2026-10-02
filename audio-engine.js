/**
 * AudioEngine — shared Web Audio context and master chain.
 *
 *   machines → input → [ChaosFX insert chain] → masterGain → performGain → compressor → limiter → out
 *
 *   input       : where TR-808 / TB-303 connect (pre-FX)
 *   masterGain  : user master volume
 *   performGain : automation only (stutter / tape-stop), keeps the master knob untouched
 *   pitchFactor : global pitch multiplier read by the machines on every trigger (tape stop)
 */
class AudioEngine {
    constructor() {
        this.ctx = null;
        this.input = null;
        this.masterGain = null;
        this.performGain = null;
        this.compressor = null;
        this.limiter = null;
        this.isInitialized = false;
        this.masterVolume = 0.75;
        this.pitchFactor = 1;
        this._noiseBuffer = null;
        this.onInit = null;
    }

    init() {
        if (this.isInitialized) return true;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;

        this.ctx = new AC({ latencyHint: 'interactive' });
        const ctx = this.ctx;

        this.input = ctx.createGain();
        this.input.gain.value = 1;

        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = this.masterVolume;

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

        this.input.connect(this.masterGain);
        this.masterGain.connect(this.performGain);
        this.performGain.connect(this.compressor);
        this.compressor.connect(this.limiter);
        this.limiter.connect(ctx.destination);

        this.isInitialized = true;
        if (this.onInit) this.onInit();
        return true;
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            return this.ctx.resume();
        }
        return Promise.resolve();
    }

    get currentTime() {
        return this.ctx ? this.ctx.currentTime : 0;
    }

    /** Destination for sound sources (pre-FX). */
    get dest() {
        return this.input;
    }

    setMasterVolume(value) {
        this.masterVolume = Math.max(0, Math.min(1, value));
        if (this.masterGain) {
            const now = this.ctx.currentTime;
            this.masterGain.gain.cancelScheduledValues(now);
            this.masterGain.gain.setTargetAtTime(this.masterVolume, now, 0.02);
        }
    }

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
}

const audioEngine = new AudioEngine();
