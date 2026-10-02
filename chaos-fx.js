class ChaosFX {
    constructor(engine) {
        this.engine = engine;
        this._initialized = false;

        // Toggle flags
        this.bitCrushEnabled = false;
        this.delayEnabled = false;
        this.polyEnabled = false;
        this.drunkMode = false;
        this.reverbEnabled = false;
        this.reverbFrozen = false;
        this.phaserEnabled = false;
        this.ringModEnabled = false;
        this.waveFolderEnabled = false;
        this.autoPanEnabled = false;
        this.earthquakeOn = false;
        this.glitchJumpEnabled = false;
        this.chaosLFOEnabled = false;

        this.probability = 100;

        // Bit Crusher params
        this.bitDepth = 8;
        this.sampleRateReduce = 1;
        this.crushMix = 0.5;

        // Delay params
        this.delayTime = 4;
        this.delayFeedback = 50;
        this.delayFilterFreq = 3000;
        this.delayMix = 30;
        this.delayMode = 'normal';

        // Reverb params
        this.reverbDecay = 2.5;
        this.reverbMix = 40;

        // Phaser params
        this.phaserRate = 0.5;
        this.phaserDepth = 800;
        this.phaserMix = 50;

        // Ring Mod params
        this.ringModFreq = 200;
        this.ringModMix = 50;

        // Wave Folder params
        this.foldAmount = 5;
        this.foldMix = 50;

        // Auto Pan params
        this.autoPanRate = 2;
        this.autoPanDepth = 80;

        // Polyrhythm
        this.polySteps = 16;
        this.timeStretch = 100;

        // Stutter
        this.stutterRate = 8;
        this.stutterDecay = 0.3;
        this.isStuttering = false;
        this.stutterInterval = null;

        // Saved gain (for stutter / tape stop restore)
        this._savedGain = null;

        // Chaos LFO timer
        this._chaosLFOInterval = null;
        this._chaosLFOTarget = null;

        // Earthquake nodes
        this._earthquakeOsc = null;
        this._earthquakeLFO = null;
        this._earthquakeGain = null;
    }

    init() {
        if (!this.engine.ctx) return;
        if (this._initialized) return;
        this._initialized = true;

        this._setupBitCrusher();
        this._setupDelay();
        this._setupReverb();
        this._setupPhaser();
        this._setupRingMod();
        this._setupWaveFolder();
        this._setupAutoPan();
    }

    // ============================================================
    // BIT CRUSHER
    // ============================================================
    _setupBitCrusher() {
        const ctx = this.engine.ctx;
        const bufferSize = 4096;

        this.bitCrushNode = ctx.createScriptProcessor(bufferSize, 1, 1);
        this.bitCrushGain = ctx.createGain();
        this.bitCrushGain.gain.value = 0;

        let phase = 0;
        let lastSample = 0;

        this.bitCrushNode.onaudioprocess = (e) => {
            const input = e.inputBuffer.getChannelData(0);
            const output = e.outputBuffer.getChannelData(0);
            const step = Math.pow(0.5, this.bitDepth);
            const rate = this.sampleRateReduce;

            for (let i = 0; i < input.length; i++) {
                phase += 1;
                if (phase >= rate) {
                    phase = 0;
                    lastSample = step * Math.floor(input[i] / step + 0.5);
                }
                output[i] = lastSample;
            }
        };

        // Wire output chain once
        this.bitCrushNode.connect(this.bitCrushGain);
        this.bitCrushGain.connect(this.engine.compressor);
    }

    toggleBitCrush(enabled) {
        if (!this.bitCrushNode) return;
        this.bitCrushEnabled = enabled;

        // Always try to disconnect first (idempotent)
        try { this.engine.masterGain.disconnect(this.bitCrushNode); } catch (e) {}

        if (enabled) {
            this.engine.masterGain.connect(this.bitCrushNode);
            this.bitCrushGain.gain.value = this.crushMix;
        } else {
            this.bitCrushGain.gain.value = 0;
        }
    }

    setBitDepth(value) { this.bitDepth = value; }
    setSampleRateReduce(value) { this.sampleRateReduce = value; }
    setCrushMix(value) {
        this.crushMix = value / 100;
        if (this.bitCrushGain && this.bitCrushEnabled) {
            this.bitCrushGain.gain.value = this.crushMix;
        }
    }

    // ============================================================
    // DELAY / ECHO
    // ============================================================
    _setupDelay() {
        const ctx = this.engine.ctx;

        this.delayNode = ctx.createDelay(5.0);
        this.delayFeedbackNode = ctx.createGain();
        this.delayFilterNode = ctx.createBiquadFilter();
        this.delayMixNode = ctx.createGain();

        this.delayFilterNode.type = 'lowpass';
        this.delayFilterNode.frequency.value = this.delayFilterFreq;
        this.delayFeedbackNode.gain.value = this.delayFeedback / 100;
        this.delayMixNode.gain.value = 0;

        this.delayNode.connect(this.delayFilterNode);
        this.delayFilterNode.connect(this.delayFeedbackNode);
        this.delayFeedbackNode.connect(this.delayNode);
        this.delayNode.connect(this.delayMixNode);
        // FIX: was connecting to masterGain (= infinite feedback loop). Use compressor.
        this.delayMixNode.connect(this.engine.compressor);
    }

    toggleDelay(enabled) {
        if (!this.delayNode) return;
        this.delayEnabled = enabled;

        try { this.engine.masterGain.disconnect(this.delayNode); } catch (e) {}

        if (enabled) {
            this.engine.masterGain.connect(this.delayNode);
            this.delayMixNode.gain.value = this.delayMix / 100;
        } else {
            this.delayMixNode.gain.value = 0;
        }
    }

    updateDelay(bpm) {
        if (!this.delayNode) return;
        const stepDuration = (60 / bpm) / 4;
        this.delayNode.delayTime.value = stepDuration * this.delayTime;
        this.delayFeedbackNode.gain.value = this.delayFeedback / 100;
        this.delayFilterNode.frequency.value = this.delayFilterFreq;
        this.delayMixNode.gain.value = this.delayEnabled ? this.delayMix / 100 : 0;
    }

    setDelayTime(value) { this.delayTime = value; }
    setDelayFeedback(value) { this.delayFeedback = value; }
    setDelayFilter(value) { this.delayFilterFreq = value; }
    setDelayMix(value) { this.delayMix = value; }
    setDelayMode(mode) { this.delayMode = mode; }
    setProbability(value) { this.probability = value; }

    shouldTrigger() {
        if (this.probability >= 100) return true;
        return Math.random() * 100 < this.probability;
    }

    // ============================================================
    // REVERB / FREEZE
    // ============================================================
    _setupReverb() {
        const ctx = this.engine.ctx;
        this.reverbNode = ctx.createConvolver();
        this.reverbMixNode = ctx.createGain();
        this.reverbMixNode.gain.value = 0;

        this._buildReverbIR(this.reverbDecay);

        this.reverbNode.connect(this.reverbMixNode);
        this.reverbMixNode.connect(this.engine.compressor);
    }

    _buildReverbIR(decaySec) {
        if (!this.reverbNode) return;
        const ctx = this.engine.ctx;
        const rate = ctx.sampleRate;
        const length = Math.floor(rate * decaySec);
        const buffer = ctx.createBuffer(2, length, rate);
        for (let ch = 0; ch < 2; ch++) {
            const data = buffer.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                const t = i / length;
                // Exponential decay with noise
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5);
            }
        }
        this.reverbNode.buffer = buffer;
    }

    toggleReverb(enabled) {
        if (!this.reverbNode) return;
        this.reverbEnabled = enabled;
        try { this.engine.masterGain.disconnect(this.reverbNode); } catch (e) {}
        if (enabled) {
            this.engine.masterGain.connect(this.reverbNode);
            this.reverbMixNode.gain.value = this.reverbMix / 100;
        } else {
            this.reverbMixNode.gain.value = 0;
        }
    }

    setReverbDecay(value) {
        this.reverbDecay = value;
        if (this.reverbFrozen) return;
        this._buildReverbIR(value);
    }

    setReverbMix(value) {
        this.reverbMix = value;
        if (this.reverbMixNode && this.reverbEnabled) {
            this.reverbMixNode.gain.value = value / 100;
        }
    }

    freezeReverb(enabled) {
        this.reverbFrozen = enabled;
        // Build ultra-long IR for freeze illusion
        if (enabled) {
            this._buildReverbIR(20);
        } else {
            this._buildReverbIR(this.reverbDecay);
        }
    }

    // ============================================================
    // PHASER
    // ============================================================
    _setupPhaser() {
        const ctx = this.engine.ctx;
        this.phaserStages = [];
        const numStages = 4;
        for (let i = 0; i < numStages; i++) {
            const ap = ctx.createBiquadFilter();
            ap.type = 'allpass';
            ap.frequency.value = 500 + i * 300;
            ap.Q.value = 1.2;
            this.phaserStages.push(ap);
        }
        // Chain all-pass filters in series
        for (let i = 0; i < this.phaserStages.length - 1; i++) {
            this.phaserStages[i].connect(this.phaserStages[i + 1]);
        }

        this.phaserMixNode = ctx.createGain();
        this.phaserMixNode.gain.value = 0;
        this.phaserStages[this.phaserStages.length - 1].connect(this.phaserMixNode);
        this.phaserMixNode.connect(this.engine.compressor);

        // LFO
        this.phaserLFO = ctx.createOscillator();
        this.phaserLFO.type = 'sine';
        this.phaserLFO.frequency.value = this.phaserRate;
        this.phaserLFOGain = ctx.createGain();
        this.phaserLFOGain.gain.value = this.phaserDepth;
        this.phaserLFO.connect(this.phaserLFOGain);
        this.phaserStages.forEach(stage => {
            this.phaserLFOGain.connect(stage.frequency);
        });
        this.phaserLFO.start();
    }

    togglePhaser(enabled) {
        if (!this.phaserStages) return;
        this.phaserEnabled = enabled;
        try { this.engine.masterGain.disconnect(this.phaserStages[0]); } catch (e) {}
        if (enabled) {
            this.engine.masterGain.connect(this.phaserStages[0]);
            this.phaserMixNode.gain.value = this.phaserMix / 100;
        } else {
            this.phaserMixNode.gain.value = 0;
        }
    }

    setPhaserRate(value) {
        this.phaserRate = value;
        if (this.phaserLFO) this.phaserLFO.frequency.value = value;
    }
    setPhaserDepth(value) {
        this.phaserDepth = value;
        if (this.phaserLFOGain) this.phaserLFOGain.gain.value = value;
    }
    setPhaserMix(value) {
        this.phaserMix = value;
        if (this.phaserMixNode && this.phaserEnabled) {
            this.phaserMixNode.gain.value = value / 100;
        }
    }

    // ============================================================
    // RING MODULATOR
    // ============================================================
    _setupRingMod() {
        const ctx = this.engine.ctx;
        this.ringInputGain = ctx.createGain();
        this.ringInputGain.gain.value = 0; // controlled by modulator

        this.ringCarrier = ctx.createOscillator();
        this.ringCarrier.type = 'sine';
        this.ringCarrier.frequency.value = this.ringModFreq;
        this.ringCarrierGain = ctx.createGain();
        this.ringCarrierGain.gain.value = 1; // full modulation
        this.ringCarrier.connect(this.ringCarrierGain);
        this.ringCarrierGain.connect(this.ringInputGain.gain);
        this.ringCarrier.start();

        this.ringMixNode = ctx.createGain();
        this.ringMixNode.gain.value = 0;
        this.ringInputGain.connect(this.ringMixNode);
        this.ringMixNode.connect(this.engine.compressor);
    }

    toggleRingMod(enabled) {
        if (!this.ringInputGain) return;
        this.ringModEnabled = enabled;
        try { this.engine.masterGain.disconnect(this.ringInputGain); } catch (e) {}
        if (enabled) {
            this.engine.masterGain.connect(this.ringInputGain);
            this.ringMixNode.gain.value = this.ringModMix / 100;
        } else {
            this.ringMixNode.gain.value = 0;
        }
    }

    setRingModFreq(value) {
        this.ringModFreq = value;
        if (this.ringCarrier) this.ringCarrier.frequency.value = value;
    }
    setRingModMix(value) {
        this.ringModMix = value;
        if (this.ringMixNode && this.ringModEnabled) {
            this.ringMixNode.gain.value = value / 100;
        }
    }

    // ============================================================
    // WAVE FOLDER
    // ============================================================
    _setupWaveFolder() {
        const ctx = this.engine.ctx;
        this.waveFolderNode = ctx.createWaveShaper();
        this.waveFolderNode.oversample = '4x';
        this.waveFolderMix = ctx.createGain();
        this.waveFolderMix.gain.value = 0;
        this.waveFolderNode.connect(this.waveFolderMix);
        this.waveFolderMix.connect(this.engine.compressor);
        this._updateFoldCurve(this.foldAmount);
    }

    _updateFoldCurve(amount) {
        if (!this.waveFolderNode) return;
        const samples = 2048;
        const curve = new Float32Array(samples);
        for (let i = 0; i < samples; i++) {
            const x = (i * 2) / samples - 1;
            // Sine-based wave folder: harder fold as amount increases
            curve[i] = Math.sin(x * amount * Math.PI) * 0.8;
        }
        this.waveFolderNode.curve = curve;
    }

    toggleWaveFolder(enabled) {
        if (!this.waveFolderNode) return;
        this.waveFolderEnabled = enabled;
        try { this.engine.masterGain.disconnect(this.waveFolderNode); } catch (e) {}
        if (enabled) {
            this.engine.masterGain.connect(this.waveFolderNode);
            this.waveFolderMix.gain.value = this.foldMix / 100;
        } else {
            this.waveFolderMix.gain.value = 0;
        }
    }

    setFoldAmount(value) {
        this.foldAmount = value;
        this._updateFoldCurve(value);
    }
    setFoldMix(value) {
        this.foldMix = value;
        if (this.waveFolderMix && this.waveFolderEnabled) {
            this.waveFolderMix.gain.value = value / 100;
        }
    }

    // ============================================================
    // AUTO PANNER
    // ============================================================
    _setupAutoPan() {
        const ctx = this.engine.ctx;
        if (!ctx.createStereoPanner) return; // very old browsers

        this.autoPanIn = ctx.createGain();
        this.autoPanNode = ctx.createStereoPanner();
        this.autoPanMix = ctx.createGain();
        this.autoPanMix.gain.value = 0;

        this.autoPanIn.connect(this.autoPanNode);
        this.autoPanNode.connect(this.autoPanMix);
        this.autoPanMix.connect(this.engine.compressor);

        // LFO
        this.autoPanLFO = ctx.createOscillator();
        this.autoPanLFO.type = 'sine';
        this.autoPanLFO.frequency.value = this.autoPanRate;
        this.autoPanLFOGain = ctx.createGain();
        this.autoPanLFOGain.gain.value = this.autoPanDepth / 100;
        this.autoPanLFO.connect(this.autoPanLFOGain);
        this.autoPanLFOGain.connect(this.autoPanNode.pan);
        this.autoPanLFO.start();
    }

    toggleAutoPan(enabled) {
        if (!this.autoPanIn) return;
        this.autoPanEnabled = enabled;
        try { this.engine.masterGain.disconnect(this.autoPanIn); } catch (e) {}
        if (enabled) {
            this.engine.masterGain.connect(this.autoPanIn);
            this.autoPanMix.gain.value = 1.0;
        } else {
            this.autoPanMix.gain.value = 0;
        }
    }

    setAutoPanRate(value) {
        this.autoPanRate = value;
        if (this.autoPanLFO) this.autoPanLFO.frequency.value = value;
    }
    setAutoPanDepth(value) {
        this.autoPanDepth = value;
        if (this.autoPanLFOGain) this.autoPanLFOGain.gain.value = value / 100;
    }

    // ============================================================
    // EARTHQUAKE (sub-bass drone)
    // ============================================================
    toggleEarthquake(enabled) {
        if (!this.engine.ctx) return;
        const ctx = this.engine.ctx;
        this.earthquakeOn = enabled;

        if (enabled) {
            this._earthquakeOsc = ctx.createOscillator();
            this._earthquakeOsc.type = 'sine';
            this._earthquakeOsc.frequency.value = 35;

            this._earthquakeLFO = ctx.createOscillator();
            this._earthquakeLFO.type = 'sine';
            this._earthquakeLFO.frequency.value = 0.7;
            this._earthquakeLFOGain = ctx.createGain();
            this._earthquakeLFOGain.gain.value = 8;
            this._earthquakeLFO.connect(this._earthquakeLFOGain);
            this._earthquakeLFOGain.connect(this._earthquakeOsc.frequency);

            this._earthquakeGain = ctx.createGain();
            this._earthquakeGain.gain.value = 0;
            this._earthquakeGain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.6);

            this._earthquakeOsc.connect(this._earthquakeGain);
            this._earthquakeGain.connect(this.engine.compressor);

            this._earthquakeOsc.start();
            this._earthquakeLFO.start();
        } else {
            if (this._earthquakeGain) {
                const now = ctx.currentTime;
                this._earthquakeGain.gain.cancelScheduledValues(now);
                this._earthquakeGain.gain.setValueAtTime(this._earthquakeGain.gain.value, now);
                this._earthquakeGain.gain.linearRampToValueAtTime(0, now + 0.4);
            }
            const stopAt = ctx.currentTime + 0.5;
            try { this._earthquakeOsc && this._earthquakeOsc.stop(stopAt); } catch (e) {}
            try { this._earthquakeLFO && this._earthquakeLFO.stop(stopAt); } catch (e) {}
            this._earthquakeOsc = null;
            this._earthquakeLFO = null;
            this._earthquakeGain = null;
        }
    }

    // ============================================================
    // SCREAM MODE — instant extreme 303
    // ============================================================
    screamMode(tb303) {
        tb303.setCutoff(4500);
        tb303.setResonance(30);
        tb303.setEnvMod(100);
        tb303.setDecay(1.5);
        tb303.setAccent(100);
        tb303.setWaveform('square');
    }

    // ============================================================
    // CHAOS AUTO LFO — randomizes 303 params over time
    // ============================================================
    startChaosLFO(tb303) {
        if (this._chaosLFOInterval) return;
        this.chaosLFOEnabled = true;
        this._chaosLFOInterval = setInterval(() => {
            const r = Math.random();
            if (r < 0.4) {
                tb303.setCutoff(200 + Math.random() * 4800);
            } else if (r < 0.7) {
                tb303.setResonance(5 + Math.random() * 25);
            } else if (r < 0.9) {
                tb303.setEnvMod(Math.random() * 100);
            } else {
                tb303.setDecay(0.1 + Math.random() * 1.5);
            }
        }, 180);
    }

    stopChaosLFO() {
        this.chaosLFOEnabled = false;
        if (this._chaosLFOInterval) {
            clearInterval(this._chaosLFOInterval);
            this._chaosLFOInterval = null;
        }
    }

    // ============================================================
    // GLITCH JUMP — just a flag; sequencer reads it
    // ============================================================
    toggleGlitchJump(enabled) {
        this.glitchJumpEnabled = enabled;
    }

    // ============================================================
    // TAPE STOP — slowdown via BPM ramp + low-pass + volume fade
    // ============================================================
    tapeStop(sequencer, duration = 2.0) {
        if (!this.engine.ctx || !sequencer) return;
        const ctx = this.engine.ctx;
        const now = ctx.currentTime;

        this._savedGain = this._savedGain ?? this.engine.masterGain.gain.value;
        const startGain = this.engine.masterGain.gain.value;

        // Volume ramp down
        this.engine.masterGain.gain.cancelScheduledValues(now);
        this.engine.masterGain.gain.setValueAtTime(startGain, now);
        this.engine.masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        // BPM slowdown via interval
        const startBPM = sequencer.bpm;
        const steps = 30;
        const intervalMs = (duration * 1000) / steps;
        let i = 0;
        const id = setInterval(() => {
            i++;
            const t = i / steps;
            // Ease-out
            const newBPM = Math.max(8, startBPM * (1 - t * 0.97));
            sequencer.setBPM(newBPM);
            if (i >= steps) {
                clearInterval(id);
                // Restore
                setTimeout(() => {
                    sequencer.setBPM(startBPM);
                    this.engine.masterGain.gain.cancelScheduledValues(this.engine.ctx.currentTime);
                    this.engine.masterGain.gain.setValueAtTime(this._savedGain ?? 0.75, this.engine.ctx.currentTime);
                    this._savedGain = null;
                }, 200);
            }
        }, intervalMs);
    }

    // ============================================================
    // VINYL BRAKE — faster + pitchy
    // ============================================================
    vinylBrake(sequencer, callback) {
        if (!this.engine.ctx || !sequencer) return;
        const ctx = this.engine.ctx;
        const now = ctx.currentTime;
        const duration = 0.8;

        this._savedGain = this._savedGain ?? this.engine.masterGain.gain.value;
        const startGain = this.engine.masterGain.gain.value;
        const startBPM = sequencer.bpm;

        this.engine.masterGain.gain.cancelScheduledValues(now);
        this.engine.masterGain.gain.setValueAtTime(startGain, now);
        this.engine.masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        const steps = 12;
        const intervalMs = (duration * 1000) / steps;
        let i = 0;
        const id = setInterval(() => {
            i++;
            const t = i / steps;
            const newBPM = Math.max(8, startBPM * (1 - t * 0.98));
            sequencer.setBPM(newBPM);
            if (i >= steps) {
                clearInterval(id);
                setTimeout(() => {
                    sequencer.setBPM(startBPM);
                    this.engine.masterGain.gain.cancelScheduledValues(this.engine.ctx.currentTime);
                    this.engine.masterGain.gain.setValueAtTime(this._savedGain ?? 0.75, this.engine.ctx.currentTime);
                    this._savedGain = null;
                    if (callback) callback();
                }, 100);
            }
        }, intervalMs);
    }

    // ============================================================
    // STUTTER
    // ============================================================
    startStutter(triggerFn) {
        if (this.isStuttering) return;
        this.isStuttering = true;
        this._savedGain = this.engine.masterGain.gain.value;

        const intervalMs = (60000 / 128) / this.stutterRate;
        let vol = this._savedGain;

        this.stutterInterval = setInterval(() => {
            if (triggerFn) triggerFn();
            vol *= (1 - this.stutterDecay * 0.01);
            this.engine.masterGain.gain.value = Math.max(vol, 0.01);
        }, intervalMs);
    }

    stopStutter() {
        this.isStuttering = false;
        if (this.stutterInterval) {
            clearInterval(this.stutterInterval);
            this.stutterInterval = null;
        }
        if (this.engine.masterGain && this._savedGain != null) {
            this.engine.masterGain.gain.value = this._savedGain;
            this._savedGain = null;
        }
    }

    // ============================================================
    // EUCLIDEAN RHYTHM
    // ============================================================
    euclidean(steps, hits, rotation = 0) {
        if (hits > steps) hits = steps;
        if (hits === 0) return new Array(steps).fill(false);

        let pattern = [];
        let remainder = hits;
        let divisor = steps - hits;
        let level = 0;
        let counts = [];
        let remainders = [];

        remainders.push(remainder);
        while (true) {
            counts.push(Math.floor(divisor / remainder));
            const newRemainder = divisor % remainder;
            divisor = remainder;
            remainder = newRemainder;
            level++;
            remainders.push(remainder);
            if (remainder <= 1) break;
        }
        counts.push(divisor);

        function build(level) {
            if (level === -1) return [false];
            if (level === -2) return [true];

            let result = [];
            for (let i = 0; i < counts[level]; i++) {
                result = result.concat(build(level - 1));
            }
            if (remainders[level] > 0) {
                result = result.concat(build(level - 2));
            }
            return result;
        }

        pattern = build(level);

        while (pattern.length < steps) pattern.push(false);
        pattern = pattern.slice(0, steps);

        if (rotation > 0) {
            const rot = rotation % steps;
            pattern = [...pattern.slice(rot), ...pattern.slice(0, rot)];
        }

        return pattern.map(v => !!v);
    }

    // ============================================================
    // PATTERN MUTATIONS
    // ============================================================
    mutatePattern808(pattern, amount) {
        const mutated = {};
        Object.keys(pattern).forEach(key => {
            mutated[key] = pattern[key].map(step => {
                if (Math.random() * 100 < amount) return !step;
                return step;
            });
        });
        return mutated;
    }

    mutatePattern303(pattern, amount) {
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        return pattern.map(step => {
            const s = { ...step };
            if (Math.random() * 100 < amount) s.active = !s.active;
            if (s.active && Math.random() * 100 < amount) {
                s.note = notes[Math.floor(Math.random() * notes.length)];
            }
            if (s.active && Math.random() * 100 < amount * 0.5) {
                s.octave = Math.floor(Math.random() * 3) + 1;
            }
            if (Math.random() * 100 < amount * 0.3) s.slide = !s.slide;
            if (Math.random() * 100 < amount * 0.3) s.accent = !s.accent;
            return s;
        });
    }

    reversePattern808(pattern) {
        const reversed = {};
        Object.keys(pattern).forEach(key => {
            reversed[key] = [...pattern[key]].reverse();
        });
        return reversed;
    }

    reversePattern303(pattern) {
        return [...pattern].reverse();
    }

    palindromePattern808(pattern) {
        const result = {};
        Object.keys(pattern).forEach(key => {
            const half = pattern[key].slice(0, 8);
            result[key] = [...half, ...half.reverse()];
        });
        return result;
    }

    palindromePattern303(pattern) {
        const half = pattern.slice(0, 8);
        return [...half, ...[...half].reverse()];
    }

    shiftPattern808(pattern, direction) {
        const shifted = {};
        Object.keys(pattern).forEach(key => {
            const arr = [...pattern[key]];
            if (direction === 'left') arr.push(arr.shift());
            else arr.unshift(arr.pop());
            shifted[key] = arr;
        });
        return shifted;
    }

    shiftPattern303(pattern, direction) {
        const arr = [...pattern];
        if (direction === 'left') arr.push(arr.shift());
        else arr.unshift(arr.pop());
        return arr;
    }

    generateAcidLine(steps = 16) {
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const scale = [0, 2, 3, 5, 7, 8, 10];
        const pattern = [];
        for (let i = 0; i < steps; i++) {
            const active = Math.random() > 0.25;
            const noteIdx = scale[Math.floor(Math.random() * scale.length)];
            pattern.push({
                active,
                note: notes[noteIdx],
                octave: Math.random() > 0.7 ? 3 : (Math.random() > 0.5 ? 1 : 2),
                accent: Math.random() > 0.7,
                slide: active && Math.random() > 0.6
            });
        }
        return pattern;
    }

    // ============================================================
    // DRUNK MODE
    // ============================================================
    drunkify(sequencer) {
        this.drunkMode = !this.drunkMode;
        return this.drunkMode;
    }

    getDrunkBPMOffset() {
        if (!this.drunkMode) return 0;
        return (Math.random() - 0.5) * 20;
    }

    getDrunkSwing() {
        if (!this.drunkMode) return 0;
        return Math.random() * 60;
    }

    robotAcid(tb303) {
        tb303.setCutoff(100 + Math.random() * 4900);
        tb303.setResonance(Math.random() * 30);
        tb303.setEnvMod(Math.random() * 100);
        tb303.setDecay(0.05 + Math.random() * 1.95);
        tb303.setAccent(Math.random() * 100);
        tb303.setWaveform(Math.random() > 0.5 ? 'sawtooth' : 'square');
    }

    randomizeAll(sequencer, tr808, tb303) {
        const pattern808 = sequencer.pattern808;
        Object.keys(pattern808).forEach(key => {
            for (let i = 0; i < 16; i++) {
                pattern808[key][i] = Math.random() > 0.7;
            }
        });

        const acidLine = this.generateAcidLine();
        for (let i = 0; i < 16; i++) {
            sequencer.pattern303[i] = acidLine[i];
        }

        this.robotAcid(tb303);

        sequencer.setBPM(80 + Math.floor(Math.random() * 100));
        sequencer.setSwing(Math.random() * 60);
    }
}
