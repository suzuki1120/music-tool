/**
 * TB-303 style monosynth — persistent oscillator / filter / VCA like the real unit,
 * so slides are true legato glides and accents retrigger the envelopes.
 *
 * trigger(note, octave, time, { accent, legato, tie, gate, velocity, lock })
 *   legato : this note is reached by a slide from the previous step (no envelope retrigger, pitch glides)
 *   tie    : this note slides INTO the next step (gate held open until the next trigger)
 *   gate   : seconds the note is held before release
 *   lock   : per-step parameter lock { cutoff, resonance, envMod, decay } — overrides the knobs for this step only
 */
class TB303 {
    constructor(engine) {
        this.engine = engine;

        this.cutoff = 800;        // Hz 100..5000
        this.resonance = 15;      // 0..30 (UI units)
        this.envMod = 50;         // 0..100
        this.decay = 0.3;         // s
        this.accentLevel = 50;    // 0..100
        this.drive = 20;          // 0..100 overdrive
        this.waveform = 'sawtooth';
        this.level = 0.8;
        this.slideTime = 0.07;

        this.lastFreq = null;     // last *base* frequency (without pitch factor)
        this.lastTriggerTime = -1;
        this.onParamChange = null;

        this.oscSaw = null;
    }

    init() {
        if (this.oscSaw || !this.engine.ctx) return;
        const ctx = this.engine.ctx;

        this.oscSaw = ctx.createOscillator();
        this.oscSaw.type = 'sawtooth';
        this.oscSqr = ctx.createOscillator();
        this.oscSqr.type = 'square';

        this.sawGain = ctx.createGain();
        this.sqrGain = ctx.createGain();
        this.sawGain.gain.value = this.waveform === 'sawtooth' ? 1 : 0;
        this.sqrGain.gain.value = this.waveform === 'square' ? 0.8 : 0;

        this.filter = ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = this.cutoff;
        this.filter.Q.value = this._q(this.resonance);

        this.driveIn = ctx.createGain();
        this.driveNode = ctx.createWaveShaper();
        this.driveNode.oversample = '2x';
        this.driveOut = ctx.createGain();
        this._applyDrive();

        this.vca = ctx.createGain();
        this.vca.gain.value = 0;

        this.out = ctx.createGain();
        this.out.gain.value = this.level;

        this.oscSaw.connect(this.sawGain);
        this.oscSqr.connect(this.sqrGain);
        this.sawGain.connect(this.filter);
        this.sqrGain.connect(this.filter);
        this.filter.connect(this.driveIn);
        this.driveIn.connect(this.driveNode);
        this.driveNode.connect(this.driveOut);
        this.driveOut.connect(this.vca);
        this.vca.connect(this.out);
        this.out.connect(this.engine.channelInput('303'));

        this.oscSaw.start();
        this.oscSqr.start();
    }

    // ---------------------------------------------------------------- params
    _now() { return this.engine.ctx ? this.engine.ctx.currentTime : 0; }

    _q(res) {
        const r = Math.max(0, Math.min(30, res)) / 30;
        return 0.6 + Math.pow(r, 1.6) * 20;
    }

    _applyDrive() {
        if (!this.driveNode) return;
        const d = this.drive / 100;
        const amount = 1.5 + d * 14;              // curve hardness
        const pre = 1 + d * 5;                    // input gain
        this.driveNode.curve = this._makeDriveCurve(amount);
        this.driveIn.gain.setTargetAtTime(pre, this._now(), 0.02);
        this.driveOut.gain.setTargetAtTime(1 / Math.pow(pre, 0.6), this._now(), 0.02);
    }

    setCutoff(value) {
        this.cutoff = Math.max(60, Math.min(8000, value));
        if (this.filter && this._now() > this.lastTriggerTime + this.decay) {
            this.filter.frequency.setTargetAtTime(this.cutoff, this._now(), 0.02);
        }
        this._emit();
    }
    setResonance(value) {
        this.resonance = Math.max(0, Math.min(30, value));
        if (this.filter) this.filter.Q.setTargetAtTime(this._q(this.resonance), this._now(), 0.02);
        this._emit();
    }
    setEnvMod(value) { this.envMod = Math.max(0, Math.min(100, value)); this._emit(); }
    setDecay(value) { this.decay = Math.max(0.03, Math.min(3, value)); this._emit(); }
    setAccent(value) { this.accentLevel = Math.max(0, Math.min(100, value)); this._emit(); }
    setDrive(value) { this.drive = Math.max(0, Math.min(100, value)); this._applyDrive(); this._emit(); }
    setWaveform(type) {
        this.waveform = type === 'square' ? 'square' : 'sawtooth';
        if (this.sawGain) {
            const t = this._now();
            this.sawGain.gain.setTargetAtTime(this.waveform === 'sawtooth' ? 1 : 0, t, 0.01);
            this.sqrGain.gain.setTargetAtTime(this.waveform === 'square' ? 0.8 : 0, t, 0.01);
        }
        this._emit();
    }
    setLevel(value) {
        this.level = Math.max(0, Math.min(1, value));
        if (this.out) this.out.gain.setTargetAtTime(this.level, this._now(), 0.02);
        this._emit();
    }

    getParams() {
        return {
            cutoff: this.cutoff, resonance: this.resonance, envMod: this.envMod,
            decay: this.decay, accent: this.accentLevel, drive: this.drive, waveform: this.waveform, level: this.level
        };
    }

    setParams(p) {
        if (!p) return;
        if (p.cutoff !== undefined) this.setCutoff(p.cutoff);
        if (p.resonance !== undefined) this.setResonance(p.resonance);
        if (p.envMod !== undefined) this.setEnvMod(p.envMod);
        if (p.decay !== undefined) this.setDecay(p.decay);
        if (p.accent !== undefined) this.setAccent(p.accent);
        if (p.drive !== undefined) this.setDrive(p.drive);
        if (p.waveform !== undefined) this.setWaveform(p.waveform);
        if (p.level !== undefined) this.setLevel(p.level);
    }

    _emit() { if (this.onParamChange) this.onParamChange(this.getParams()); }

    // ----------------------------------------------------------------- notes
    static get NOTES() { return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']; }

    noteToFreq(note, octave) {
        const semitone = TB303.NOTES.indexOf(note);
        if (semitone === -1) return 65.41;
        const midi = (octave + 1) * 12 + semitone;
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    trigger(note, octave, time, options = {}) {
        if (!this.oscSaw) this.init();
        if (!this.oscSaw) return;
        if (this.engine.effectiveGain('303') <= 0.002 && !options.force) return;

        const { accent = false, legato = false, tie = false, gate = 0.1, velocity = 1, lock = null } = options;
        const pf = this.engine.pitchFactor || 1;
        const baseFreq = this.noteToFreq(note, octave);
        const freq = baseFreq * pf;
        const acc = this.accentLevel / 100;

        // parameter locks override the panel for this step only
        const cutoff = lock && lock.cutoff !== undefined ? lock.cutoff : this.cutoff;
        const resonance = lock && lock.resonance !== undefined ? lock.resonance : this.resonance;
        const envMod = lock && lock.envMod !== undefined ? lock.envMod : this.envMod;
        const decay = lock && lock.decay !== undefined ? lock.decay : this.decay;

        // --- pitch
        [this.oscSaw, this.oscSqr].forEach(osc => {
            const f = osc.frequency;
            f.cancelScheduledValues(time);
            if (legato && this.lastFreq) {
                f.setValueAtTime(this.lastFreq * pf, time);
                f.exponentialRampToValueAtTime(freq, time + this.slideTime);
            } else {
                f.setValueAtTime(freq, time);
            }
        });

        // --- resonance (scheduled so locks land on the step)
        this.filter.Q.cancelScheduledValues(time);
        this.filter.Q.setValueAtTime(this._q(resonance), time);

        // --- filter envelope (not retriggered on legato notes — the glide keeps the running envelope)
        if (!legato) {
            const envAmount = (envMod / 100) * 5200 * (accent ? 1 + 0.9 * acc : 1);
            const base = cutoff;
            const peak = Math.min(base + envAmount, 16000);
            const dec = Math.max(0.03, decay * (accent ? 0.75 : 1));
            const fq = this.filter.frequency;
            fq.cancelScheduledValues(time);
            fq.setValueAtTime(peak, time);
            fq.exponentialRampToValueAtTime(Math.max(base, 40), time + dec);
        }

        // --- VCA
        const vol = 0.55 * velocity * (accent ? 1 + 0.7 * acc : 1);
        const g = this.vca.gain;
        g.cancelScheduledValues(time);
        if (legato) {
            g.setTargetAtTime(vol, time, 0.012);
        } else {
            g.setValueAtTime(0, time);
            g.linearRampToValueAtTime(vol, time + 0.004);
        }
        const end = time + gate;
        g.setTargetAtTime(0, end, tie ? 0.02 : 0.01);

        this.lastFreq = baseFreq;
        this.lastTriggerTime = time;
    }

    /** Re-pitch the running oscillator (tape stop / brake). */
    bendTo(pitchFactor) {
        if (!this.oscSaw || !this.lastFreq) return;
        const t = this._now();
        [this.oscSaw, this.oscSqr].forEach(osc => {
            osc.frequency.cancelScheduledValues(t);
            osc.frequency.setTargetAtTime(Math.max(1, this.lastFreq * pitchFactor), t, 0.02);
        });
    }

    allNotesOff() {
        if (!this.vca) return;
        const t = this._now();
        this.vca.gain.cancelScheduledValues(t);
        this.vca.gain.setTargetAtTime(0, t, 0.02);
    }

    reset() {
        this.lastFreq = null;
        this.lastTriggerTime = -1;
        this.allNotesOff();
    }

    _makeDriveCurve(amount) {
        const samples = 1024;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
        }
        return curve;
    }
}
