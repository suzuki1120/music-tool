class TB303 {
    constructor(engine) {
        this.engine = engine;
        this.cutoff = 800;
        this.resonance = 15;
        this.envMod = 50;
        this.decay = 0.3;
        this.accentLevel = 50;
        this.waveform = 'sawtooth';
        this.slideTime = 0.06;
        this.lastFreq = null;
    }

    setCutoff(value) { this.cutoff = value; }
    setResonance(value) { this.resonance = value; }
    setEnvMod(value) { this.envMod = value; }
    setDecay(value) { this.decay = value; }
    setAccent(value) { this.accentLevel = value; }
    setWaveform(type) { this.waveform = type; }

    noteToFreq(note, octave) {
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const semitone = notes.indexOf(note);
        if (semitone === -1) return 261.63;
        const midi = (octave + 1) * 12 + semitone;
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    trigger(note, octave, time, options = {}) {
        const ctx = this.engine.ctx;
        const dest = this.engine.masterGain;
        const { accent = false, slide = false, gate = 0.8 } = options;

        const freq = this.noteToFreq(note, octave);
        const accentMul = accent ? 1 + (this.accentLevel / 100) : 1;

        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const ampEnv = ctx.createGain();
        const distortion = ctx.createWaveShaper();

        osc.type = this.waveform;

        if (slide && this.lastFreq) {
            osc.frequency.setValueAtTime(this.lastFreq, time);
            osc.frequency.exponentialRampToValueAtTime(freq, time + this.slideTime);
        } else {
            osc.frequency.setValueAtTime(freq, time);
        }

        filter.type = 'lowpass';
        filter.Q.value = this.resonance;

        const envAmount = (this.envMod / 100) * 4000 * accentMul;
        const baseFreq = Math.min(this.cutoff * accentMul, 18000);
        const peakFreq = Math.min(baseFreq + envAmount, 18000);

        filter.frequency.setValueAtTime(peakFreq, time);
        filter.frequency.exponentialRampToValueAtTime(
            Math.max(baseFreq, 20),
            time + this.decay
        );

        const volume = 0.35 * accentMul;
        ampEnv.gain.setValueAtTime(0, time);
        ampEnv.gain.linearRampToValueAtTime(volume, time + 0.005);

        const stepDuration = gate;
        if (!slide) {
            ampEnv.gain.setValueAtTime(volume, time + stepDuration * 0.7);
            ampEnv.gain.exponentialRampToValueAtTime(0.001, time + stepDuration);
        } else {
            ampEnv.gain.setValueAtTime(volume, time + stepDuration);
        }

        distortion.curve = this._makeDistortionCurve(accent ? 20 : 5);
        distortion.oversample = '2x';

        osc.connect(filter);
        filter.connect(distortion);
        distortion.connect(ampEnv);
        ampEnv.connect(dest);

        osc.start(time);
        osc.stop(time + stepDuration + 0.1);

        this.lastFreq = freq;
    }

    _makeDistortionCurve(amount) {
        const samples = 256;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
        }
        return curve;
    }

    reset() {
        this.lastFreq = null;
    }
}
