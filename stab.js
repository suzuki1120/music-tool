/**
 * StabSynth — polyphonic chord stab (two detuned saws per chord tone → low pass with envelope → VCA)
 * through a stereo chorus, into its own mixer channel ('stab').
 *
 * trigger(note, octave, chordType, time, { gate, accent, velocity })
 */
class StabSynth {
    constructor(engine) {
        this.engine = engine;
        this.cutoff = 1400;      // Hz
        this.resonance = 4;      // 0..20 (Q)
        this.envMod = 55;        // 0..100
        this.decay = 0.28;       // filter decay s
        this.release = 0.22;     // amp release s
        this.detune = 12;        // cents
        this.chorus = 50;        // %
        this.level = 0.6;
        this.waveform = 'sawtooth';
        this.octave = 3;         // default chord octave 2..5
        this.out = null;
        this.onParamChange = null;
    }

    static get CHORDS() { return MusicGen.CHORDS; }
    static get CHORD_KEYS() { return MusicGen.CHORD_KEYS; }

    init() {
        if (this.out || !this.engine.ctx) return;
        const ctx = this.engine.ctx;
        this.out = ctx.createGain();
        this.out.gain.value = this.level;

        // chorus: dry + two modulated short delays
        this.chorusDry = ctx.createGain();
        this.chorusWet = ctx.createGain();
        this.chorusMerge = ctx.createChannelMerger(2);
        this.dlyL = ctx.createDelay(0.1);
        this.dlyR = ctx.createDelay(0.1);
        this.dlyL.delayTime.value = 0.012;
        this.dlyR.delayTime.value = 0.019;
        this.lfo = ctx.createOscillator();
        this.lfo.type = 'sine';
        this.lfo.frequency.value = 0.45;
        this.lfoGainL = ctx.createGain();
        this.lfoGainR = ctx.createGain();
        this.lfoGainL.gain.value = 0.0022;
        this.lfoGainR.gain.value = -0.0028;
        this.lfo.connect(this.lfoGainL);
        this.lfo.connect(this.lfoGainR);
        this.lfoGainL.connect(this.dlyL.delayTime);
        this.lfoGainR.connect(this.dlyR.delayTime);
        this.lfo.start();

        this.bus = ctx.createGain();       // voices sum here
        this.bus.connect(this.chorusDry);
        this.bus.connect(this.dlyL);
        this.bus.connect(this.dlyR);
        this.dlyL.connect(this.chorusMerge, 0, 0);
        this.dlyR.connect(this.chorusMerge, 0, 1);
        this.chorusMerge.connect(this.chorusWet);
        this.chorusDry.connect(this.out);
        this.chorusWet.connect(this.out);
        this._applyChorus();

        this.out.connect(this.engine.channelInput('stab'));
    }

    _now() { return this.engine.ctx ? this.engine.ctx.currentTime : 0; }
    _emit() { if (this.onParamChange) this.onParamChange(this.getParams()); }

    _applyChorus() {
        if (!this.chorusWet) return;
        const w = this.chorus / 100;
        const t = this._now();
        this.chorusWet.gain.setTargetAtTime(w * 0.8, t, 0.02);
        this.chorusDry.gain.setTargetAtTime(1 - w * 0.45, t, 0.02);
    }

    setCutoff(v) { this.cutoff = Math.max(100, Math.min(8000, v)); this._emit(); }
    setResonance(v) { this.resonance = Math.max(0, Math.min(20, v)); this._emit(); }
    setEnvMod(v) { this.envMod = Math.max(0, Math.min(100, v)); this._emit(); }
    setDecay(v) { this.decay = Math.max(0.03, Math.min(2, v)); this._emit(); }
    setRelease(v) { this.release = Math.max(0.03, Math.min(3, v)); this._emit(); }
    setDetune(v) { this.detune = Math.max(0, Math.min(50, v)); this._emit(); }
    setChorus(v) { this.chorus = Math.max(0, Math.min(100, v)); this._applyChorus(); this._emit(); }
    setLevel(v) { this.level = Math.max(0, Math.min(1, v)); if (this.out) this.out.gain.setTargetAtTime(this.level, this._now(), 0.02); this._emit(); }
    setWaveform(w) { this.waveform = w === 'square' ? 'square' : 'sawtooth'; this._emit(); }
    setOctave(o) { this.octave = Math.max(2, Math.min(5, parseInt(o) || 3)); this._emit(); }

    getParams() {
        return {
            cutoff: this.cutoff, resonance: this.resonance, envMod: this.envMod, decay: this.decay,
            release: this.release, detune: this.detune, chorus: this.chorus, level: this.level,
            waveform: this.waveform, octave: this.octave
        };
    }

    setParams(p) {
        if (!p) return;
        if (p.cutoff !== undefined) this.setCutoff(p.cutoff);
        if (p.resonance !== undefined) this.setResonance(p.resonance);
        if (p.envMod !== undefined) this.setEnvMod(p.envMod);
        if (p.decay !== undefined) this.setDecay(p.decay);
        if (p.release !== undefined) this.setRelease(p.release);
        if (p.detune !== undefined) this.setDetune(p.detune);
        if (p.chorus !== undefined) this.setChorus(p.chorus);
        if (p.level !== undefined) this.setLevel(p.level);
        if (p.waveform !== undefined) this.setWaveform(p.waveform);
        if (p.octave !== undefined) this.setOctave(p.octave);
    }

    noteToFreq(note, octave) {
        const semitone = MusicGen.NOTES.indexOf(note);
        if (semitone === -1) return 130.81;
        const midi = (octave + 1) * 12 + semitone;
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    trigger(note, octave, chordType, time, opts = {}) {
        if (!this.out) this.init();
        if (!this.out) return;
        if (this.engine.effectiveGain('stab') <= 0.002) return;
        const ctx = this.engine.ctx;
        const { gate = 0.2, accent = false, velocity = 1 } = opts;
        const chord = StabSynth.CHORDS[chordType] || StabSynth.CHORDS.min;
        const pf = this.engine.pitchFactor || 1;
        const base = this.noteToFreq(note, octave) * pf;

        // per-hit filter + VCA (polyphonic, so the filter is per chord hit)
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = this.resonance;
        const peak = Math.min(16000, this.cutoff + (this.envMod / 100) * 6000 * (accent ? 1.4 : 1));
        filter.frequency.setValueAtTime(peak, time);
        filter.frequency.exponentialRampToValueAtTime(Math.max(60, this.cutoff), time + Math.max(0.03, this.decay));

        const vca = ctx.createGain();
        const vol = 0.22 * velocity * (accent ? 1.5 : 1) / Math.sqrt(chord.iv.length);
        vca.gain.setValueAtTime(0, time);
        vca.gain.linearRampToValueAtTime(vol, time + 0.004);
        vca.gain.setValueAtTime(vol, time + gate);
        vca.gain.setTargetAtTime(0, time + gate, this.release / 4);
        const end = time + gate + this.release * 1.5 + 0.05;

        filter.connect(vca);
        vca.connect(this.bus);

        chord.iv.forEach((semis, i) => {
            const f = base * Math.pow(2, semis / 12);
            [-1, 1].forEach(sign => {
                const osc = ctx.createOscillator();
                osc.type = this.waveform;
                osc.frequency.value = f;
                osc.detune.value = sign * this.detune * (1 + i * 0.15);
                osc.connect(filter);
                osc.start(time);
                osc.stop(end);
            });
        });
    }
}
