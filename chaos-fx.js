/**
 * ChaosFX — master insert chain + sends + performance effects + pattern tools.
 *
 *   engine.input → bitcrush → wavefold → drive → ringmod → phaser → trance gate → autopan → post → engine.masterGain
 *   engine.sendDelay  (per-channel sends) → delay  (mono / ping-pong / reverse) → engine.masterGain
 *   engine.sendReverb (per-channel sends) → reverb (+ freeze)                  → engine.masterGain
 *
 *   Each insert has a real dry/wet crossfade, so MIX behaves like a mix knob and OFF is truly bypassed.
 */
class ChaosFX {
    constructor(engine) {
        this.engine = engine;
        this._initialized = false;

        this.bitCrushEnabled = false;
        this.delayEnabled = false;
        this.reverbEnabled = false;
        this.reverbFrozen = false;
        this.phaserEnabled = false;
        this.ringModEnabled = false;
        this.waveFolderEnabled = false;
        this.autoPanEnabled = false;
        this.driveEnabled = false;
        this.gateEnabled = false;
        this.earthquakeOn = false;
        this.glitchJumpEnabled = false;
        this.chaosLFOEnabled = false;
        this.polyEnabled = false;
        this.drunkMode = false;

        this.probability = 100;

        this.bitDepth = 8;
        this.sampleRateReduce = 1;
        this.crushMix = 50;

        this.delayTime = 4;        // 16ths
        this.delayFeedback = 50;   // %
        this.delayFilterFreq = 3000;
        this.delayMix = 30;
        this.delayMode = 'normal';
        this._bpm = 128;

        this.reverbDecay = 2.5;
        this.reverbMix = 40;

        this.phaserRate = 0.5;
        this.phaserDepth = 800;
        this.phaserMix = 50;

        this.ringModFreq = 200;
        this.ringModMix = 50;

        this.foldAmount = 5;
        this.foldMix = 50;

        this.driveAmount = 40;     // %
        this.driveTone = 4000;     // Hz
        this.driveMix = 100;

        this.gatePattern = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1];
        this.gateRate = '16';      // '8' | '16' | '32'
        this.gateDepth = 100;      // %
        this.gateSmooth = 8;       // ms

        this.autoPanRate = 2;
        this.autoPanDepth = 80;

        this.polySteps = 16;
        this.timeStretch = 100;

        this.stutterRate = 8;
        this.stutterDecay = 30;

        this._chaosLFOInterval = null;
        this._tape = null;
    }

    init() {
        if (!this.engine.ctx || this._initialized) return;
        this._initialized = true;
        const ctx = this.engine.ctx;

        // Take over routing: input → chain → masterGain
        try { this.engine.input.disconnect(this.engine.masterGain); } catch (e) { /* not connected */ }

        this.bitCrush = this._setupBitCrusher();
        this.fold = this._setupWaveFolder();
        this.driveIns = this._setupDrive();
        this.ring = this._setupRingMod();
        this.phaser = this._setupPhaser();
        this.gate = this._setupGate();

        this.autoPanNode = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
        this.post = ctx.createGain();

        this.engine.input.connect(this.bitCrush.in);
        this.bitCrush.out.connect(this.fold.in);
        this.fold.out.connect(this.driveIns.in);
        this.driveIns.out.connect(this.ring.in);
        this.ring.out.connect(this.phaser.in);
        this.phaser.out.connect(this.gate.in);
        this.gate.out.connect(this.autoPanNode);
        this.autoPanNode.connect(this.post);
        this.post.connect(this.engine.masterGain);

        this._setupAutoPanLFO();
        this._setupDelay();
        this._setupReverb();

        // re-apply any state set before the context existed
        this.toggleBitCrush(this.bitCrushEnabled);
        this.toggleWaveFolder(this.waveFolderEnabled);
        this.toggleDrive(this.driveEnabled);
        this.toggleRingMod(this.ringModEnabled);
        this.togglePhaser(this.phaserEnabled);
        this.toggleGate(this.gateEnabled);
        this.toggleAutoPan(this.autoPanEnabled);
        this.toggleReverb(this.reverbEnabled);
        this.setPhaserRate(this.phaserRate);
        this.setPhaserDepth(this.phaserDepth);
        this.setRingModFreq(this.ringModFreq);
        this.setAutoPanRate(this.autoPanRate);
        this.setFoldAmount(this.foldAmount);
        this.setDriveAmount(this.driveAmount);
        this.setDriveTone(this.driveTone);
        this._buildReverbIR(this.reverbFrozen ? 14 : this.reverbDecay);
    }

    // ------------------------------------------------------------ insert helper
    _makeInsert(fxNode, fxOut = fxNode) {
        const ctx = this.engine.ctx;
        const ins = { in: ctx.createGain(), out: ctx.createGain(), dry: ctx.createGain(), wet: ctx.createGain(), enabled: false, mix: 0.5 };
        ins.dry.gain.value = 1;
        ins.wet.gain.value = 0;
        ins.in.connect(ins.dry);
        ins.dry.connect(ins.out);
        ins.in.connect(fxNode);
        fxOut.connect(ins.wet);
        ins.wet.connect(ins.out);
        ins.apply = () => {
            const t = ctx.currentTime;
            const wet = ins.enabled ? ins.mix : 0;
            ins.wet.gain.setTargetAtTime(wet, t, 0.015);
            ins.dry.gain.setTargetAtTime(1 - wet, t, 0.015);
        };
        return ins;
    }

    // ------------------------------------------------------------ bit crusher
    _setupBitCrusher() {
        const ctx = this.engine.ctx;
        const node = ctx.createScriptProcessor(512, 1, 1);
        let phase = 0, last = 0;
        node.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            const output = e.outputBuffer.getChannelData(0);
            const levels = Math.pow(2, this.bitDepth - 1);
            const rate = Math.max(1, this.sampleRateReduce);
            for (let i = 0; i < input.length; i++) {
                phase++;
                if (phase >= rate) {
                    phase = 0;
                    last = Math.round(input[i] * levels) / levels;
                }
                output[i] = last;
            }
        };
        return this._makeInsert(node);
    }

    toggleBitCrush(enabled) {
        this.bitCrushEnabled = enabled;
        if (!this.bitCrush) return;
        this.bitCrush.enabled = enabled;
        this.bitCrush.mix = this.crushMix / 100;
        this.bitCrush.apply();
    }
    setBitDepth(v) { this.bitDepth = Math.max(1, Math.min(16, v)); }
    setSampleRateReduce(v) { this.sampleRateReduce = Math.max(1, v); }
    setCrushMix(v) { this.crushMix = v; if (this.bitCrush) { this.bitCrush.mix = v / 100; this.bitCrush.apply(); } }

    // ------------------------------------------------------------ wave folder
    _setupWaveFolder() {
        const ctx = this.engine.ctx;
        this.waveFolderNode = ctx.createWaveShaper();
        this.waveFolderNode.oversample = '4x';
        this._updateFoldCurve(this.foldAmount);
        const trim = ctx.createGain();
        trim.gain.value = 0.7;
        this.waveFolderNode.connect(trim);
        return this._makeInsert(this.waveFolderNode, trim);
    }

    _updateFoldCurve(amount) {
        const samples = 2048;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            curve[i] = Math.sin(x * amount * Math.PI * 0.5);
        }
        this.waveFolderNode.curve = curve;
    }

    toggleWaveFolder(enabled) {
        this.waveFolderEnabled = enabled;
        if (!this.fold) return;
        this.fold.enabled = enabled;
        this.fold.mix = this.foldMix / 100;
        this.fold.apply();
    }
    setFoldAmount(v) { this.foldAmount = v; if (this.waveFolderNode) this._updateFoldCurve(v); }
    setFoldMix(v) { this.foldMix = v; if (this.fold) { this.fold.mix = v / 100; this.fold.apply(); } }

    // ------------------------------------------------------------ overdrive
    _setupDrive() {
        const ctx = this.engine.ctx;
        this.drivePre = ctx.createGain();
        this.driveShaper = ctx.createWaveShaper();
        this.driveShaper.oversample = '4x';
        this.driveToneNode = ctx.createBiquadFilter();
        this.driveToneNode.type = 'lowpass';
        this.driveToneNode.Q.value = 0.5;
        this.drivePost = ctx.createGain();
        this.drivePre.connect(this.driveShaper);
        this.driveShaper.connect(this.driveToneNode);
        this.driveToneNode.connect(this.drivePost);
        this._updateDriveCurve();
        return this._makeInsert(this.drivePre, this.drivePost);
    }

    _updateDriveCurve() {
        if (!this.driveShaper) return;
        const d = this.driveAmount / 100;
        const k = 1 + d * 24;
        const n = 2048;
        const curve = new Float32Array(n);
        const norm = Math.tanh(k);
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1;
            // asymmetric soft clip → a little even harmonic content
            const y = Math.tanh(k * x + d * 0.15 * x * x) / norm;
            curve[i] = y;
        }
        this.driveShaper.curve = curve;
        const t = this.engine.ctx.currentTime;
        this.drivePre.gain.setTargetAtTime(1 + d * 2.5, t, 0.02);
        this.drivePost.gain.setTargetAtTime(0.85 / (1 + d * 0.9), t, 0.02);
    }

    toggleDrive(enabled) {
        this.driveEnabled = enabled;
        if (!this.driveIns) return;
        this.driveIns.enabled = enabled;
        this.driveIns.mix = this.driveMix / 100;
        this.driveIns.apply();
    }
    setDriveAmount(v) { this.driveAmount = Math.max(0, Math.min(100, v)); this._updateDriveCurve(); }
    setDriveTone(v) { this.driveTone = v; if (this.driveToneNode) this.driveToneNode.frequency.setTargetAtTime(v, this.engine.ctx.currentTime, 0.02); }
    setDriveMix(v) { this.driveMix = v; if (this.driveIns) { this.driveIns.mix = v / 100; this.driveIns.apply(); } }

    // ------------------------------------------------------------ ring mod
    _setupRingMod() {
        const ctx = this.engine.ctx;
        const ringGain = ctx.createGain();
        ringGain.gain.value = 0;
        this.ringCarrier = ctx.createOscillator();
        this.ringCarrier.type = 'sine';
        this.ringCarrier.frequency.value = this.ringModFreq;
        this.ringCarrier.connect(ringGain.gain);
        this.ringCarrier.start();
        return this._makeInsert(ringGain);
    }

    toggleRingMod(enabled) {
        this.ringModEnabled = enabled;
        if (!this.ring) return;
        this.ring.enabled = enabled;
        this.ring.mix = this.ringModMix / 100;
        this.ring.apply();
    }
    setRingModFreq(v) { this.ringModFreq = v; if (this.ringCarrier) this.ringCarrier.frequency.setTargetAtTime(v, this.engine.ctx.currentTime, 0.01); }
    setRingModMix(v) { this.ringModMix = v; if (this.ring) { this.ring.mix = v / 100; this.ring.apply(); } }

    // ------------------------------------------------------------ phaser
    _setupPhaser() {
        const ctx = this.engine.ctx;
        this.phaserStages = [];
        const bases = [600, 900, 1300, 1800];
        bases.forEach(f => {
            const ap = ctx.createBiquadFilter();
            ap.type = 'allpass';
            ap.frequency.value = f;
            ap.Q.value = 0.9;
            this.phaserStages.push(ap);
        });
        for (let i = 0; i < this.phaserStages.length - 1; i++) this.phaserStages[i].connect(this.phaserStages[i + 1]);

        this.phaserLFO = ctx.createOscillator();
        this.phaserLFO.type = 'sine';
        this.phaserLFO.frequency.value = this.phaserRate;
        this.phaserLFOGain = ctx.createGain();
        this.phaserLFOGain.gain.value = this.phaserDepth * 0.3;
        this.phaserLFO.connect(this.phaserLFOGain);
        this.phaserStages.forEach(s => this.phaserLFOGain.connect(s.frequency));
        this.phaserLFO.start();

        const fb = ctx.createGain();
        fb.gain.value = 0.35;
        this.phaserStages[this.phaserStages.length - 1].connect(fb);
        fb.connect(this.phaserStages[0]);

        return this._makeInsert(this.phaserStages[0], this.phaserStages[this.phaserStages.length - 1]);
    }

    togglePhaser(enabled) {
        this.phaserEnabled = enabled;
        if (!this.phaser) return;
        this.phaser.enabled = enabled;
        this.phaser.mix = this.phaserMix / 100;
        this.phaser.apply();
    }
    setPhaserRate(v) { this.phaserRate = v; if (this.phaserLFO) this.phaserLFO.frequency.setTargetAtTime(v, this.engine.ctx.currentTime, 0.02); }
    setPhaserDepth(v) { this.phaserDepth = v; if (this.phaserLFOGain) this.phaserLFOGain.gain.setTargetAtTime(v * 0.3, this.engine.ctx.currentTime, 0.02); }
    setPhaserMix(v) { this.phaserMix = v; if (this.phaser) { this.phaser.mix = v / 100; this.phaser.apply(); } }

    // ------------------------------------------------------------ trance gate
    _setupGate() {
        const ctx = this.engine.ctx;
        this.gateGain = ctx.createGain();
        this.gateGain.gain.value = 1;
        const ins = this._makeInsert(this.gateGain);
        ins.mix = 1;
        return ins;
    }

    toggleGate(enabled) {
        this.gateEnabled = enabled;
        if (!this.gate) return;
        this.gate.enabled = enabled;
        this.gate.mix = 1;
        this.gate.apply();
        if (!enabled) {
            const t = this.engine.ctx.currentTime;
            this.gateGain.gain.cancelScheduledValues(t);
            this.gateGain.gain.setTargetAtTime(1, t, 0.01);
        }
    }
    setGateRate(r) { this.gateRate = ['8', '16', '32'].includes(String(r)) ? String(r) : '16'; }
    setGateDepth(v) { this.gateDepth = Math.max(0, Math.min(100, v)); }
    setGateSmooth(ms) { this.gateSmooth = Math.max(1, Math.min(60, ms)); }
    setGatePattern(arr) { if (Array.isArray(arr) && arr.length === 16) this.gatePattern = arr.map(v => v ? 1 : 0); }
    toggleGateStep(i) { this.gatePattern[i] = this.gatePattern[i] ? 0 : 1; }
    randomGatePattern() {
        const p = [];
        for (let i = 0; i < 16; i++) p.push(i % 4 === 0 ? 1 : (Math.random() < 0.5 ? 1 : 0));
        this.gatePattern = p;
        return p;
    }
    static get GATE_PRESETS() {
        return {
            'OFFBEAT': [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
            'TRANCE':  [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1],
            'TRIPLET': [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
            'CHOP':    [1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0],
            'STAB':    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
        };
    }

    /** Sequencer step hook — schedule the gate shape for this 16th. */
    onStep(tick, time, dur) {
        if (!this.gateEnabled || !this.gateGain) return;
        const g = this.gateGain.gain;
        const floor = 1 - this.gateDepth / 100;
        const tc = this.gateSmooth / 1000 / 3;
        const set = (idx, t) => {
            const open = this.gatePattern[((idx % 16) + 16) % 16];
            g.setTargetAtTime(open ? 1 : floor, t, tc);
        };
        if (this.gateRate === '32') {
            set(tick * 2, time);
            set(tick * 2 + 1, time + dur / 2);
        } else if (this.gateRate === '8') {
            if (tick % 2 === 0) set(tick / 2, time);
        } else {
            set(tick, time);
        }
    }

    // ------------------------------------------------------------ auto pan
    _setupAutoPanLFO() {
        const ctx = this.engine.ctx;
        if (!this.autoPanNode.pan) return;
        this.autoPanLFO = ctx.createOscillator();
        this.autoPanLFO.type = 'sine';
        this.autoPanLFO.frequency.value = this.autoPanRate;
        this.autoPanLFOGain = ctx.createGain();
        this.autoPanLFOGain.gain.value = 0;
        this.autoPanLFO.connect(this.autoPanLFOGain);
        this.autoPanLFOGain.connect(this.autoPanNode.pan);
        this.autoPanLFO.start();
    }

    toggleAutoPan(enabled) {
        this.autoPanEnabled = enabled;
        if (!this.autoPanLFOGain) return;
        const t = this.engine.ctx.currentTime;
        this.autoPanLFOGain.gain.setTargetAtTime(enabled ? this.autoPanDepth / 100 : 0, t, 0.05);
    }
    setAutoPanRate(v) { this.autoPanRate = v; if (this.autoPanLFO) this.autoPanLFO.frequency.setTargetAtTime(v, this.engine.ctx.currentTime, 0.02); }
    setAutoPanDepth(v) { this.autoPanDepth = v; if (this.autoPanLFOGain && this.autoPanEnabled) this.autoPanLFOGain.gain.setTargetAtTime(v / 100, this.engine.ctx.currentTime, 0.02); }

    // ------------------------------------------------------------ delay
    _setupDelay() {
        const ctx = this.engine.ctx;
        this.delaySend = ctx.createGain();
        this.delaySend.gain.value = 0;
        this.engine.sendDelay.connect(this.delaySend);

        this.delayReturn = ctx.createGain();
        this.delayReturn.gain.value = 1;
        this.delayReturn.connect(this.engine.masterGain);

        // --- mono
        const m = {};
        m.delay = ctx.createDelay(5);
        m.filter = ctx.createBiquadFilter();
        m.filter.type = 'lowpass';
        m.fb = ctx.createGain();
        m.out = ctx.createGain();
        m.out.gain.value = 0;
        this.delaySend.connect(m.delay);
        m.delay.connect(m.filter);
        m.filter.connect(m.fb);
        m.fb.connect(m.delay);
        m.filter.connect(m.out);
        m.out.connect(this.delayReturn);
        this.dlyMono = m;

        // --- ping pong
        const p = {};
        p.left = ctx.createDelay(5);
        p.right = ctx.createDelay(5);
        p.filterL = ctx.createBiquadFilter(); p.filterL.type = 'lowpass';
        p.filterR = ctx.createBiquadFilter(); p.filterR.type = 'lowpass';
        p.fb = ctx.createGain();
        p.merger = ctx.createChannelMerger(2);
        p.out = ctx.createGain();
        p.out.gain.value = 0;
        this.delaySend.connect(p.left);
        p.left.connect(p.filterL);
        p.filterL.connect(p.right);
        p.right.connect(p.filterR);
        p.filterR.connect(p.fb);
        p.fb.connect(p.left);
        p.filterL.connect(p.merger, 0, 0);
        p.filterR.connect(p.merger, 0, 1);
        p.merger.connect(p.out);
        p.out.connect(this.delayReturn);
        this.dlyPing = p;

        // --- reverse (chunk recorder played backwards)
        const r = {};
        r.proc = ctx.createScriptProcessor(1024, 1, 1);
        r.maxLen = Math.floor(ctx.sampleRate * 4);
        r.rec = new Float32Array(r.maxLen);
        r.play = new Float32Array(r.maxLen);
        r.len = Math.floor(ctx.sampleRate * 0.5);
        r.pendingLen = r.len;
        r.pos = 0;
        r.proc.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            const output = e.outputBuffer.getChannelData(0);
            for (let i = 0; i < input.length; i++) {
                r.rec[r.pos] = input[i];
                const edge = Math.min(r.pos, r.len - 1 - r.pos);
                const fade = edge < 256 ? edge / 256 : 1;
                output[i] = r.play[r.len - 1 - r.pos] * fade;
                r.pos++;
                if (r.pos >= r.len) {
                    const tmp = r.rec; r.rec = r.play; r.play = tmp;
                    r.pos = 0;
                    r.len = r.pendingLen;
                }
            }
        };
        r.filter = ctx.createBiquadFilter();
        r.filter.type = 'lowpass';
        r.fb = ctx.createGain();
        r.out = ctx.createGain();
        r.out.gain.value = 0;
        this.delaySend.connect(r.proc);
        r.proc.connect(r.filter);
        r.filter.connect(r.fb);
        r.fb.connect(r.proc);
        r.filter.connect(r.out);
        r.out.connect(this.delayReturn);
        this.dlyRev = r;

        this.updateDelay(this._bpm);
    }

    toggleDelay(enabled) {
        this.delayEnabled = enabled;
        this.updateDelay(this._bpm);
    }

    updateDelay(bpm) {
        if (bpm) this._bpm = bpm;
        if (!this.dlyMono) return;
        const ctx = this.engine.ctx;
        const t = ctx.currentTime;
        const stepDur = (60 / this._bpm) / 4;
        const time = Math.min(4.9, Math.max(0.02, stepDur * this.delayTime));
        const fb = Math.min(0.92, this.delayFeedback / 100);
        const filt = this.delayFilterFreq;
        const on = this.delayEnabled;

        this.delaySend.gain.setTargetAtTime(on ? this.delayMix / 100 : 0, t, 0.02);

        const m = this.dlyMono, p = this.dlyPing, r = this.dlyRev;
        m.delay.delayTime.setTargetAtTime(time, t, 0.05);
        m.filter.frequency.setTargetAtTime(filt, t, 0.02);
        p.left.delayTime.setTargetAtTime(time, t, 0.05);
        p.right.delayTime.setTargetAtTime(time, t, 0.05);
        p.filterL.frequency.setTargetAtTime(filt, t, 0.02);
        p.filterR.frequency.setTargetAtTime(filt, t, 0.02);
        r.filter.frequency.setTargetAtTime(filt, t, 0.02);
        r.pendingLen = Math.max(512, Math.min(r.maxLen, Math.floor(time * ctx.sampleRate)));

        const mode = this.delayMode;
        m.out.gain.setTargetAtTime(mode === 'normal' ? 1 : 0, t, 0.02);
        p.out.gain.setTargetAtTime(mode === 'pingpong' ? 1 : 0, t, 0.02);
        r.out.gain.setTargetAtTime(mode === 'reverse' ? 1 : 0, t, 0.02);
        m.fb.gain.setTargetAtTime(mode === 'normal' && on ? fb : 0, t, 0.02);
        p.fb.gain.setTargetAtTime(mode === 'pingpong' && on ? fb : 0, t, 0.02);
        r.fb.gain.setTargetAtTime(mode === 'reverse' && on ? fb * 0.8 : 0, t, 0.02);
    }

    setDelayTime(v) { this.delayTime = v; this.updateDelay(); }
    setDelayFeedback(v) { this.delayFeedback = v; this.updateDelay(); }
    setDelayFilter(v) { this.delayFilterFreq = v; this.updateDelay(); }
    setDelayMix(v) { this.delayMix = v; this.updateDelay(); }
    setDelayMode(mode) { this.delayMode = mode; this.updateDelay(); }

    // ------------------------------------------------------------ probability
    setProbability(v) { this.probability = v; }
    shouldTrigger() {
        if (this.probability >= 100) return true;
        return Math.random() * 100 < this.probability;
    }

    // ------------------------------------------------------------ reverb
    _setupReverb() {
        const ctx = this.engine.ctx;
        this.reverbSend = ctx.createGain();
        this.reverbSend.gain.value = 0;
        this.reverbNode = ctx.createConvolver();
        this.reverbHp = ctx.createBiquadFilter();
        this.reverbHp.type = 'highpass';
        this.reverbHp.frequency.value = 180;
        this.engine.sendReverb.connect(this.reverbSend);
        this.reverbSend.connect(this.reverbHp);
        this.reverbHp.connect(this.reverbNode);
        this.reverbNode.connect(this.engine.masterGain);
        this._buildReverbIR(this.reverbDecay);
    }

    _buildReverbIR(decaySec) {
        if (!this.reverbNode) return;
        const ctx = this.engine.ctx;
        const rate = ctx.sampleRate;
        const length = Math.max(1, Math.floor(rate * decaySec));
        const buffer = ctx.createBuffer(2, length, rate);
        for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                const t = i / length;
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.2) * (i < 400 ? i / 400 : 1);
            }
        }
        this.reverbNode.buffer = buffer;
    }

    toggleReverb(enabled) {
        this.reverbEnabled = enabled;
        if (!this.reverbSend) return;
        this.reverbSend.gain.setTargetAtTime(enabled ? this.reverbMix / 100 : 0, this.engine.ctx.currentTime, 0.03);
    }
    setReverbDecay(v) { this.reverbDecay = v; if (!this.reverbFrozen) this._buildReverbIR(v); }
    setReverbMix(v) { this.reverbMix = v; if (this.reverbSend && this.reverbEnabled) this.reverbSend.gain.setTargetAtTime(v / 100, this.engine.ctx.currentTime, 0.03); }
    freezeReverb(enabled) {
        this.reverbFrozen = enabled;
        this._buildReverbIR(enabled ? 14 : this.reverbDecay);
    }

    // ------------------------------------------------------------ earthquake
    toggleEarthquake(enabled) {
        if (!this.engine.ctx) return;
        const ctx = this.engine.ctx;
        this.earthquakeOn = enabled;
        if (enabled) {
            this._eqOsc = ctx.createOscillator();
            this._eqOsc.type = 'sine';
            this._eqOsc.frequency.value = 36;
            this._eqLFO = ctx.createOscillator();
            this._eqLFO.frequency.value = 0.6;
            this._eqLFOGain = ctx.createGain();
            this._eqLFOGain.gain.value = 7;
            this._eqLFO.connect(this._eqLFOGain);
            this._eqLFOGain.connect(this._eqOsc.frequency);
            this._eqGain = ctx.createGain();
            this._eqGain.gain.value = 0;
            this._eqGain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.6);
            this._eqOsc.connect(this._eqGain);
            this._eqGain.connect(this.engine.masterGain);
            this._eqOsc.start();
            this._eqLFO.start();
        } else if (this._eqGain) {
            const now = ctx.currentTime;
            this._eqGain.gain.cancelScheduledValues(now);
            this._eqGain.gain.setTargetAtTime(0, now, 0.1);
            const osc = this._eqOsc, lfo = this._eqLFO;
            try { osc.stop(now + 0.6); lfo.stop(now + 0.6); } catch (e) { /* already stopped */ }
            this._eqOsc = this._eqLFO = this._eqGain = null;
        }
    }

    // ------------------------------------------------------------ 303 automation
    screamMode(tb303) {
        tb303.setCutoff(3200);
        tb303.setResonance(27);
        tb303.setEnvMod(100);
        tb303.setDecay(1.2);
        tb303.setAccent(100);
        tb303.setWaveform('square');
    }

    /** Smooth random walk on the 303 — musical instead of random jumps. */
    startChaosLFO(tb303, onTick) {
        if (this._chaosLFOInterval) return;
        this.chaosLFOEnabled = true;
        const target = { cutoff: tb303.cutoff, resonance: tb303.resonance, envMod: tb303.envMod, decay: tb303.decay };
        let tick = 0;
        this._chaosLFOInterval = setInterval(() => {
            tick++;
            if (tick % 6 === 0) {
                target.cutoff = 200 + Math.random() * 3000;
                if (Math.random() < 0.5) target.resonance = 6 + Math.random() * 20;
                if (Math.random() < 0.4) target.envMod = 20 + Math.random() * 75;
                if (Math.random() < 0.3) target.decay = 0.12 + Math.random() * 0.8;
            }
            const k = 0.18;
            tb303.setCutoff(tb303.cutoff + (target.cutoff - tb303.cutoff) * k);
            tb303.setResonance(tb303.resonance + (target.resonance - tb303.resonance) * k);
            tb303.setEnvMod(tb303.envMod + (target.envMod - tb303.envMod) * k);
            tb303.setDecay(tb303.decay + (target.decay - tb303.decay) * k);
            if (onTick) onTick();
        }, 90);
    }

    stopChaosLFO() {
        this.chaosLFOEnabled = false;
        if (this._chaosLFOInterval) {
            clearInterval(this._chaosLFOInterval);
            this._chaosLFOInterval = null;
        }
    }

    toggleGlitchJump(enabled) { this.glitchJumpEnabled = enabled; }

    // ------------------------------------------------------------ tape stop / vinyl brake
    _tapeEffect(sequencer, tb303, duration, stopAtEnd, done) {
        if (!this.engine.ctx || !sequencer || !sequencer.isPlaying || this._tape) return false;
        const ctx = this.engine.ctx;
        const pg = this.engine.performGain.gain;
        const start = ctx.currentTime;

        pg.cancelScheduledValues(start);
        pg.setValueAtTime(pg.value, start);
        pg.exponentialRampToValueAtTime(0.02, start + duration);

        const state = { id: null };
        this._tape = state;
        state.id = setInterval(() => {
            const t = Math.min(1, (ctx.currentTime - start) / duration);
            const e = Math.pow(1 - t, 1.5);
            const f = Math.max(0.04, e);
            sequencer.tempoScale = f;
            this.engine.pitchFactor = f;
            if (tb303) tb303.bendTo(f);
            if (t >= 1) this._finishTape(sequencer, tb303, stopAtEnd, done);
        }, 30);
        return true;
    }

    _finishTape(sequencer, tb303, stopAtEnd, done) {
        if (!this._tape) return;
        clearInterval(this._tape.id);
        this._tape = null;
        const ctx = this.engine.ctx;
        const pg = this.engine.performGain.gain;
        sequencer.tempoScale = 1;
        this.engine.pitchFactor = 1;
        if (tb303) tb303.bendTo(1);
        if (stopAtEnd) sequencer.stop();
        pg.cancelScheduledValues(ctx.currentTime);
        pg.setValueAtTime(0.02, ctx.currentTime);
        pg.linearRampToValueAtTime(1, ctx.currentTime + 0.08);
        if (done) done();
    }

    tapeStop(sequencer, tb303, duration = 1.8, done) {
        return this._tapeEffect(sequencer, tb303, duration, true, done);
    }

    vinylBrake(sequencer, tb303, done) {
        return this._tapeEffect(sequencer, tb303, 0.65, false, done);
    }

    cancelTape(sequencer, tb303) {
        if (this._tape) this._finishTape(sequencer, tb303, false, null);
    }

    get tapeActive() { return !!this._tape; }

    // ------------------------------------------------------------ euclidean
    euclidean(steps, hits, rotation = 0) {
        hits = Math.max(0, Math.min(steps, hits));
        const pattern = [];
        let bucket = 0;
        for (let i = 0; i < steps; i++) {
            bucket += hits;
            if (bucket >= steps) { bucket -= steps; pattern.push(true); }
            else pattern.push(false);
        }
        const first = pattern.indexOf(true);
        let out = first > 0 ? [...pattern.slice(first), ...pattern.slice(0, first)] : pattern;
        if (rotation) {
            const rot = ((rotation % steps) + steps) % steps;
            out = [...out.slice(steps - rot), ...out.slice(0, steps - rot)];
        }
        return out;
    }

    // ------------------------------------------------------------ pattern tools (808 cells 0/1/2)
    mutatePattern808(pattern, amount) {
        const mutated = {};
        Object.keys(pattern).forEach(key => {
            mutated[key] = pattern[key].map((v, i) => {
                if (key === 'kick' && i === 0) return v || 1;
                if (Math.random() * 100 < amount * 0.6) return v ? 0 : 1;
                return v;
            });
        });
        return mutated;
    }

    mutatePattern303(pattern, amount, ctx = {}) {
        const root = ctx.root ?? 0;
        const scale = ctx.scale || 'minorPenta';
        const iv = (MusicGen.SCALES[scale] || MusicGen.SCALES.minorPenta).iv;
        const out = pattern.map((step, i) => {
            const s = { ...step };
            if (i % 4 !== 0 && Math.random() * 100 < amount * 0.6) s.active = !s.active;
            if (s.active && Math.random() * 100 < amount) {
                const semis = iv[Math.floor(Math.random() * iv.length)];
                s.note = MusicGen.NOTES[(root + semis) % 12];
            }
            if (s.active && Math.random() * 100 < amount * 0.3) {
                s.octave = Math.max(1, Math.min(3, s.octave + (Math.random() < 0.5 ? -1 : 1)));
            }
            if (Math.random() * 100 < amount * 0.3) s.accent = !s.accent;
            if (Math.random() * 100 < amount * 0.3) s.slide = !s.slide;
            return s;
        });
        return MusicGen.finishLine(out);
    }

    reversePattern808(pattern) {
        const reversed = {};
        Object.keys(pattern).forEach(key => { reversed[key] = [...pattern[key]].reverse(); });
        return reversed;
    }

    reversePattern303(pattern) {
        return MusicGen.finishLine([...pattern].reverse().map(s => ({ ...s })));
    }

    palindromePattern808(pattern) {
        const result = {};
        Object.keys(pattern).forEach(key => {
            const half = pattern[key].slice(0, 8);
            result[key] = [...half, ...[...half].reverse()];
        });
        return result;
    }

    palindromePattern303(pattern) {
        const half = pattern.slice(0, 8).map(s => ({ ...s }));
        return MusicGen.finishLine([...half, ...[...half].reverse().map(s => ({ ...s }))]);
    }

    shiftPattern808(pattern, direction) {
        const shifted = {};
        Object.keys(pattern).forEach(key => {
            const arr = [...pattern[key]];
            if (direction === 'left') arr.push(arr.shift()); else arr.unshift(arr.pop());
            shifted[key] = arr;
        });
        return shifted;
    }

    shiftPattern303(pattern, direction) {
        const arr = pattern.map(s => ({ ...s }));
        if (direction === 'left') arr.push(arr.shift()); else arr.unshift(arr.pop());
        return arr;
    }

    generateAcidLine(opts) {
        return MusicGen.generateLine(opts);
    }

    // ------------------------------------------------------------ modes
    drunkify(sequencer) {
        this.drunkMode = !this.drunkMode;
        sequencer.setDrunk(this.drunkMode);
        return this.drunkMode;
    }

    robotAcid(tb303, style = 'acid') {
        const p = MusicGen.synthParams(style);
        tb303.setCutoff(p.cutoff);
        tb303.setResonance(p.resonance);
        tb303.setEnvMod(p.envMod);
        tb303.setDecay(p.decay);
        tb303.setAccent(p.accent);
        tb303.setWaveform(p.waveform);
        return p;
    }
}
