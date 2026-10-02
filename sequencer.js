/**
 * Sequencer — look-ahead scheduler for TR-808 / TB-303.
 *
 *  tempo   : effectiveBpm = bpm × stretch × tempoScale + drunkOffset  (always clamped, never NaN / ≤ 0)
 *  swing   : even steps lengthen, odd steps shorten — bar length never changes
 *  chain   : A1 → A2 → B1 → B2 song mode, N bars per pattern
 *  stutter : hold + retrigger the current step on a sub-division, then resume in time
 *  303     : slide on step N ties N into N+1 (legato glide, no envelope retrigger)
 *
 *  808 cells: 0 off / 1 on / 2 accent
 */
class Sequencer {
    constructor(engine, tr808, tb303) {
        this.engine = engine;
        this.tr808 = tr808;
        this.tb303 = tb303;

        this.steps = 16;
        this.steps303 = 16;

        this.bpm = 128;
        this.stretch = 1;
        this.tempoScale = 1;
        this.drunkOffset = 0;
        this.drunk = false;
        this.swing = 0; // 0..1

        this.isPlaying = false;
        this.currentStep = -1;
        this.currentStep303 = -1;
        this.timerId = null;
        this.nextStepTime = 0;
        this.scheduleAheadTime = 0.12;
        this.lookAhead = 25;

        this.patterns808 = this._createEmptyPatterns808(4);
        this.patterns303 = this._createEmptyPatterns303(4);
        this.currentPattern808 = 0;
        this.currentPattern303 = 0;

        this.chain = { enabled: false, bars: 4, order: [0, 1, 2, 3], index: 0 };
        this.barCount = 0;

        this.probabilityFn = null;
        this.glitchJumpFn = null;
        this.stutter = null;
        this._last303Time = -10;

        this.onStepChange = null;     // (step808, step303, audioTime)
        this.onPatternChange = null;  // (patternIndex)
        this.onBar = null;            // (barCount)
        this.onStop = null;

        document.addEventListener('visibilitychange', () => {
            const hidden = document.hidden;
            this.scheduleAheadTime = hidden ? 1.0 : 0.12;
            this.lookAhead = hidden ? 250 : 25;
        });
    }

    // ---------------------------------------------------------------- patterns
    _createEmptyPatterns808(count) {
        const patterns = [];
        for (let p = 0; p < count; p++) {
            const pattern = {};
            this.tr808.instruments.forEach(inst => {
                pattern[inst.id] = new Array(this.steps).fill(0);
            });
            patterns.push(pattern);
        }
        return patterns;
    }

    _createEmptyPatterns303(count) {
        const patterns = [];
        for (let p = 0; p < count; p++) {
            const pattern = [];
            for (let i = 0; i < this.steps; i++) pattern.push(this._emptyStep303());
            patterns.push(pattern);
        }
        return patterns;
    }

    _emptyStep303() {
        return { active: false, note: 'C', octave: 2, accent: false, slide: false };
    }

    get pattern808() { return this.patterns808[this.currentPattern808]; }
    get pattern303() { return this.patterns303[this.currentPattern303]; }

    /** Replace a whole 808 pattern (accepts booleans or 0/1/2). */
    setPattern808(index, data) {
        const target = this.patterns808[index];
        this.tr808.instruments.forEach(inst => {
            const src = data[inst.id] || [];
            target[inst.id] = new Array(this.steps).fill(0).map((_, i) => {
                const v = src[i];
                return v === true ? 1 : (typeof v === 'number' ? Math.max(0, Math.min(2, v)) : 0);
            });
        });
    }

    setPattern303(index, data) {
        const target = this.patterns303[index];
        for (let i = 0; i < this.steps; i++) {
            const s = data[i] || {};
            target[i] = {
                active: !!s.active,
                note: typeof s.note === 'string' ? s.note : 'C',
                octave: Math.max(1, Math.min(3, parseInt(s.octave) || 2)),
                accent: !!s.accent,
                slide: !!s.slide
            };
        }
    }

    /** Cycle a cell: off → on → accent → off */
    cycle808Step(instrumentId, step) {
        const row = this.pattern808[instrumentId];
        row[step] = (row[step] + 1) % 3;
        return row[step];
    }

    set808Step(instrumentId, step, value) {
        this.pattern808[instrumentId][step] = value;
    }

    clearPattern808() {
        const pattern = this.pattern808;
        Object.keys(pattern).forEach(key => { pattern[key] = new Array(this.steps).fill(0); });
    }

    clearPattern303() {
        const pattern = this.pattern303;
        for (let i = 0; i < this.steps; i++) pattern[i] = this._emptyStep303();
    }

    selectPattern(index) {
        index = Math.max(0, Math.min(3, index));
        this.currentPattern808 = index;
        this.currentPattern303 = index;
        if (this.chain.enabled) {
            const pos = this.chain.order.indexOf(index);
            if (pos >= 0) this.chain.index = pos;
            this.barCount = 0;
        }
        if (this.onPatternChange) this.onPatternChange(index);
    }

    // ---------------------------------------------------------------- tempo
    get effectiveBpm() {
        const b = this.bpm * this.stretch * this.tempoScale + this.drunkOffset;
        if (!Number.isFinite(b)) return this.bpm;
        return Math.max(5, Math.min(400, b));
    }

    setBPM(bpm) {
        const v = Number(bpm);
        if (!Number.isFinite(v)) return;
        this.bpm = Math.max(20, Math.min(300, Math.round(v)));
    }

    setStretch(percent) {
        const v = Number(percent);
        this.stretch = Number.isFinite(v) ? Math.max(0.25, Math.min(4, v / 100)) : 1;
    }

    setSwing(value) {
        const v = Number(value);
        this.swing = Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : 0;
    }

    setDrunk(on) {
        this.drunk = !!on;
        if (!on) this.drunkOffset = 0;
    }

    // ---------------------------------------------------------------- chain
    setChainEnabled(on) {
        this.chain.enabled = !!on;
        const pos = this.chain.order.indexOf(this.currentPattern808);
        this.chain.index = pos >= 0 ? pos : 0;
        this.barCount = 0;
    }

    setChainBars(bars) {
        this.chain.bars = Math.max(1, Math.min(16, parseInt(bars) || 4));
    }

    _onBarStart(time) {
        if (this.barCount > 0 && this.chain.enabled && this.barCount % this.chain.bars === 0) {
            this.chain.index = (this.chain.index + 1) % this.chain.order.length;
            const p = this.chain.order[this.chain.index];
            this.currentPattern808 = p;
            this.currentPattern303 = p;
            if (this.onPatternChange) this.onPatternChange(p, time);
        }
        this.barCount++;
        if (this.onBar) this.onBar(this.barCount, time);
    }

    // ---------------------------------------------------------------- transport
    start() {
        if (this.isPlaying) return;
        this.engine.init();
        this.engine.resume();
        this.tr808.init();
        this.tb303.init();

        this.isPlaying = true;
        this.currentStep = -1;
        this.currentStep303 = -1;
        this.barCount = 0;
        this.stutter = null;
        this._last303Time = -10;
        if (this.chain.enabled) {
            const pos = this.chain.order.indexOf(this.currentPattern808);
            this.chain.index = pos >= 0 ? pos : 0;
        }
        this.nextStepTime = this.engine.currentTime + 0.06;
        this._schedule();
    }

    stop() {
        const wasPlaying = this.isPlaying;
        this.isPlaying = false;
        this.currentStep = -1;
        this.currentStep303 = -1;
        this.stutter = null;
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        this.tb303.reset();
        if (this.onStop) this.onStop(wasPlaying);
    }

    toggle() {
        if (this.isPlaying) this.stop(); else this.start();
        return this.isPlaying;
    }

    // ---------------------------------------------------------------- scheduler
    _schedule() {
        if (!this.isPlaying) return;
        const now = this.engine.currentTime;
        let guard = 0;

        while (this.nextStepTime < now + this.scheduleAheadTime && guard++ < 512) {
            if (this.stutter) {
                this._scheduleStutterHit();
                continue;
            }

            this.currentStep = (this.currentStep + 1) % this.steps;
            this.currentStep303 = (this.currentStep303 + 1) % this.steps303;

            if (this.currentStep === 0) this._onBarStart(this.nextStepTime);

            if (this.glitchJumpFn && this.glitchJumpFn()) {
                this.currentStep = Math.floor(Math.random() * this.steps);
                this.currentStep303 = Math.floor(Math.random() * this.steps303);
            }

            this._playStep(this.currentStep, this.currentStep303, this.nextStepTime, 1);
            if (this.onStepChange) this.onStepChange(this.currentStep, this.currentStep303, this.nextStepTime);
            this._advanceTime();
        }

        this.timerId = setTimeout(() => this._schedule(), this.lookAhead);
    }

    _advanceTime() {
        if (this.drunk) {
            this.drunkOffset = Math.max(-28, Math.min(28, this.drunkOffset * 0.82 + (Math.random() - 0.5) * 14));
        }
        const secondsPer16th = (60.0 / this.effectiveBpm) / 4;
        let s = this.swing * 0.4;
        if (this.drunk) s = Math.max(0, Math.min(0.45, s + (Math.random() - 0.5) * 0.2));
        const dur = this.currentStep % 2 === 0 ? secondsPer16th * (1 + s) : secondsPer16th * (1 - s);
        this.nextStepTime += dur;
    }

    _playStep(step, step303, time, velocity = 1) {
        const stepDur = (60.0 / this.effectiveBpm) / 4;

        const pattern808 = this.pattern808;
        this.tr808.instruments.forEach(inst => {
            const v = pattern808[inst.id][step];
            if (!v) return;
            if (this.probabilityFn && !this.probabilityFn()) return;
            this.tr808.trigger(inst.id, time, { accent: v === 2, velocity });
        });

        const pattern = this.pattern303;
        const cur = pattern[step303];
        if (cur && cur.active && (!this.probabilityFn || this.probabilityFn())) {
            const len = this.steps303;
            const next = pattern[(step303 + 1) % len];
            const prev = pattern[(step303 - 1 + len) % len];
            const tie = !!(cur.slide && next && next.active);
            const legato = !!(prev && prev.active && prev.slide) && (time - this._last303Time) < stepDur * 1.6;
            const gate = tie ? stepDur + 0.03 : stepDur * 0.55;
            this.tb303.trigger(cur.note, cur.octave, time, {
                accent: cur.accent, legato, tie, gate, velocity
            });
            this._last303Time = time;
        }
    }

    // ---------------------------------------------------------------- stutter
    startStutter(rate, decayPercent) {
        if (!this.isPlaying || this.stutter) return false;
        this.stutter = {
            rate: Math.max(1, Math.min(32, rate || 8)),
            decay: Math.max(0, Math.min(1, (decayPercent || 0) / 100)),
            held: Math.max(0, this.currentStep),
            held303: Math.max(0, this.currentStep303),
            n: 0,
            elapsed: 0
        };
        return true;
    }

    setStutterRate(rate) {
        if (this.stutter) this.stutter.rate = Math.max(1, Math.min(32, rate));
    }

    _scheduleStutterHit() {
        const st = this.stutter;
        const beat = 60 / this.effectiveBpm;
        const period = beat / st.rate;
        const vel = Math.max(0.06, Math.pow(1 - st.decay * 0.55, st.n));
        this._playStep(st.held, st.held303, this.nextStepTime, vel);
        if (this.onStepChange) this.onStepChange(st.held, st.held303, this.nextStepTime);
        st.n++;
        st.elapsed += period;
        this.nextStepTime += period;
    }

    stopStutter() {
        const st = this.stutter;
        if (!st) return;
        const s16 = (60 / this.effectiveBpm) / 4;
        const adv = Math.round(st.elapsed / s16);
        // next loop iteration increments first, so park one step behind
        this.currentStep = ((st.held + adv - 1) % this.steps + this.steps) % this.steps;
        this.currentStep303 = ((st.held303 + adv - 1) % this.steps303 + this.steps303) % this.steps303;
        this.stutter = null;
    }

    // ---------------------------------------------------------------- serialisation
    toJSON() {
        return {
            bpm: this.bpm,
            swing: Math.round(this.swing * 100),
            patterns808: this.patterns808,
            patterns303: this.patterns303,
            currentPattern: this.currentPattern808,
            chain: { enabled: this.chain.enabled, bars: this.chain.bars }
        };
    }

    fromJSON(data) {
        if (!data) return;
        if (data.bpm) this.setBPM(data.bpm);
        if (data.swing !== undefined) this.setSwing(data.swing);
        if (Array.isArray(data.patterns808)) data.patterns808.slice(0, 4).forEach((p, i) => this.setPattern808(i, p || {}));
        if (Array.isArray(data.patterns303)) data.patterns303.slice(0, 4).forEach((p, i) => this.setPattern303(i, p || []));
        if (data.chain) {
            this.setChainBars(data.chain.bars);
            this.chain.enabled = !!data.chain.enabled;
        }
        const cp = parseInt(data.currentPattern);
        if (cp >= 0 && cp < 4) { this.currentPattern808 = cp; this.currentPattern303 = cp; }
    }
}
