/**
 * Sequencer — look-ahead scheduler for TR-808/909 rows, TB-303 and the chord stab.
 *
 *  tick    : monotonically increasing 16th counter; every track reads its own step as tick % trackLength
 *  tempo   : effectiveBpm = bpm × stretch × tempoScale + drunkOffset  (always clamped, never NaN / ≤ 0)
 *  swing   : even steps lengthen, odd steps shorten — bar length never changes
 *  chain   : A1 → A2 → B1 → B2 song mode, N bars per pattern
 *  song    : arranged sections (pattern, mutes, filter sweeps) — overrides chain while enabled
 *  stutter : hold + retrigger the current step on a sub-division, then resume in time
 *  fill    : momentary replacement pattern (FILL button)
 *  303     : slide on step N ties N into N+1 (legato glide, no envelope retrigger)
 *
 *  808 cells: 0 off / 1 on / 2 accent.  ext808[pattern][inst][step] = { p: probability %, r: ratchet 1..4 }
 *  303 steps: { active, note, octave, accent, slide, prob, ratchet, lock }
 *  stab steps: { active, note, octave, chord, accent, prob }
 */
class Sequencer {
    constructor(engine, tr808, tb303, stab = null) {
        this.engine = engine;
        this.tr808 = tr808;
        this.tb303 = tb303;
        this.stab = stab;

        this.steps = 16;
        this.steps303 = 16;

        this.bpm = 128;
        this.stretch = 1;
        this.tempoScale = 1;
        this.drunkOffset = 0;
        this.drunk = false;
        this.swing = 0;      // 0..1
        this.humanize = 0;   // 0..1

        this.isPlaying = false;
        this.tick = -1;
        this.timerId = null;
        this.nextStepTime = 0;
        this.scheduleAheadTime = 0.12;
        this.lookAhead = 25;

        this.patterns808 = this._createEmptyPatterns808(4);
        this.ext808 = [{}, {}, {}, {}];
        this.len808 = [{}, {}, {}, {}];
        this.patterns303 = this._createEmptyPatterns303(4);
        this.patternsStab = this._createEmptyPatternsStab(4);
        this.currentPattern808 = 0;
        this.currentPattern303 = 0;

        this.chain = { enabled: false, bars: 4, order: [0, 1, 2, 3], index: 0 };
        this.barCount = 0;

        this.song = { enabled: false, bars: 0, sections: [], current: null };
        this.songBar = 0;

        this.fill = null;
        this.probabilityFn = null;
        this.glitchJumpFn = null;
        this.stutter = null;
        this._last303Time = -10;

        this.stepHooks = [];          // fn(tick, audioTime, stepDuration) — MIDI clock, trance gate …
        this.onTrigger = null;        // (type, data, audioTime) — MIDI note out
        this.onStart = null;          // (audioTime)
        this.onStepChange = null;     // (tick, audioTime)
        this.onPatternChange = null;  // (patternIndex, audioTime?)
        this.onBar = null;            // (barCount, audioTime, { songBar, section })
        this.onSection = null;        // (section, songBar, audioTime, barDuration)
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

    _createEmptyPatternsStab(count) {
        const patterns = [];
        for (let p = 0; p < count; p++) patterns.push(MusicGen.emptyStabLine());
        return patterns;
    }

    _emptyStep303() {
        return { active: false, note: 'C', octave: 2, accent: false, slide: false, prob: 100, ratchet: 1, lock: null };
    }

    get pattern808() { return this.patterns808[this.currentPattern808]; }
    get pattern303() { return this.patterns303[this.currentPattern303]; }
    get patternStab() { return this.patternsStab[this.currentPattern808]; }
    get ext() { return this.ext808[this.currentPattern808]; }
    get lens() { return this.len808[this.currentPattern808]; }

    /** Replace a whole 808 pattern (accepts booleans or 0/1/2). Extras come from `ext` or data.__ext. */
    setPattern808(index, data, ext = null, lens = null) {
        const target = this.patterns808[index];
        this.tr808.instruments.forEach(inst => {
            const src = data[inst.id] || [];
            target[inst.id] = new Array(this.steps).fill(0).map((_, i) => {
                const v = src[i];
                return v === true ? 1 : (typeof v === 'number' ? Math.max(0, Math.min(2, v)) : 0);
            });
        });
        this.ext808[index] = this._normaliseExt(ext || data.__ext || {}, target);
        this.len808[index] = this._normaliseLens(lens || {});
    }

    _normaliseExt(ext, pattern = null) {
        const out = {};
        Object.keys(ext || {}).forEach(inst => {
            const row = ext[inst];
            if (!row) return;
            Object.keys(row).forEach(step => {
                const e = row[step];
                const i = parseInt(step);
                if (!e || !(i >= 0 && i < 16)) return;
                const p = e.p === undefined ? 100 : Math.max(0, Math.min(100, Math.round(e.p)));
                const r = e.r === undefined ? 1 : Math.max(1, Math.min(4, Math.round(e.r)));
                if (p === 100 && r === 1) return;
                if (pattern && (!pattern[inst] || !pattern[inst][i])) return;
                if (!out[inst]) out[inst] = {};
                out[inst][i] = { p, r };
            });
        });
        return out;
    }

    _normaliseLens(lens) {
        const out = {};
        Object.keys(lens || {}).forEach(inst => {
            const n = parseInt(lens[inst]);
            if (n >= 1 && n < 16) out[inst] = n;
        });
        return out;
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
                slide: !!s.slide,
                prob: Math.max(0, Math.min(100, parseInt(s.prob ?? 100))),
                ratchet: Math.max(1, Math.min(4, parseInt(s.ratchet) || 1)),
                lock: this._normaliseLock(s.lock)
            };
        }
    }

    _normaliseLock(lock) {
        if (!lock || typeof lock !== 'object') return null;
        const out = {};
        if (typeof lock.cutoff === 'number') out.cutoff = Math.max(60, Math.min(8000, lock.cutoff));
        if (typeof lock.resonance === 'number') out.resonance = Math.max(0, Math.min(30, lock.resonance));
        if (typeof lock.envMod === 'number') out.envMod = Math.max(0, Math.min(100, lock.envMod));
        if (typeof lock.decay === 'number') out.decay = Math.max(0.03, Math.min(3, lock.decay));
        return Object.keys(out).length ? out : null;
    }

    setPatternStab(index, data) {
        this.patternsStab[index] = MusicGen.finishStabLine(Array.isArray(data) && data.length ? data : MusicGen.emptyStabLine());
        while (this.patternsStab[index].length < 16) this.patternsStab[index].push(MusicGen.emptyStabStep());
    }

    // --- per-step extras
    getExt(inst, step) {
        const row = this.ext[inst];
        return (row && row[step]) || { p: 100, r: 1 };
    }
    setExt(inst, step, data) {
        const cur = { ...this.getExt(inst, step), ...data };
        cur.p = Math.max(0, Math.min(100, Math.round(cur.p)));
        cur.r = Math.max(1, Math.min(4, Math.round(cur.r)));
        if (cur.p === 100 && cur.r === 1) {
            if (this.ext[inst]) { delete this.ext[inst][step]; if (!Object.keys(this.ext[inst]).length) delete this.ext[inst]; }
            return cur;
        }
        if (!this.ext[inst]) this.ext[inst] = {};
        this.ext[inst][step] = cur;
        return cur;
    }
    getLen(inst) { return this.lens[inst] || 16; }
    setLen(inst, n) {
        n = Math.max(1, Math.min(16, parseInt(n) || 16));
        if (n === 16) delete this.lens[inst]; else this.lens[inst] = n;
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
        this.ext808[this.currentPattern808] = {};
        this.len808[this.currentPattern808] = {};
    }

    clearPattern303() {
        const pattern = this.pattern303;
        for (let i = 0; i < this.steps; i++) pattern[i] = this._emptyStep303();
    }

    clearPatternStab() {
        this.patternsStab[this.currentPattern808] = MusicGen.emptyStabLine();
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

    get stepDuration() { return (60.0 / this.effectiveBpm) / 4; }
    get barDuration() { return this.stepDuration * 16; }

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

    setHumanize(value) {
        const v = Number(value);
        this.humanize = Number.isFinite(v) ? Math.max(0, Math.min(1, v / 100)) : 0;
    }

    setDrunk(on) {
        this.drunk = !!on;
        if (!on) this.drunkOffset = 0;
    }

    // ---------------------------------------------------------------- chain / song
    setChainEnabled(on) {
        this.chain.enabled = !!on;
        const pos = this.chain.order.indexOf(this.currentPattern808);
        this.chain.index = pos >= 0 ? pos : 0;
        this.barCount = 0;
    }

    setChainBars(bars) {
        this.chain.bars = Math.max(1, Math.min(16, parseInt(bars) || 4));
    }

    setSong(arrangement) {
        if (!arrangement || !Array.isArray(arrangement.sections) || !arrangement.sections.length) {
            this.song = { enabled: false, bars: 0, sections: [], current: null };
            return;
        }
        this.song.sections = arrangement.sections.map(s => ({ ...s, patterns: (s.patterns || [0]).map(p => Math.max(0, Math.min(3, p))), mutes: s.mutes || [] }));
        this.song.bars = Math.max(1, parseInt(arrangement.bars) || this.song.sections.reduce((m, s) => Math.max(m, s.start + s.len), 0));
        this.song.current = null;
        this.songBar = 0;
    }

    setSongEnabled(on) {
        this.song.enabled = !!on && this.song.sections.length > 0;
        this.song.current = null;
        this.songBar = 0;
        this.barCount = 0;
        return this.song.enabled;
    }

    sectionAt(bar) {
        return this.song.sections.find(s => bar >= s.start && bar < s.start + s.len) || this.song.sections[0];
    }

    _onBarStart(time) {
        let info = null;
        if (this.song.enabled && this.song.sections.length) {
            if (this.songBar >= this.song.bars) this.songBar = 0;
            const bar = this.songBar;
            const sec = this.sectionAt(bar);
            const slot = Math.floor((bar - sec.start) / this.chain.bars) % sec.patterns.length;
            const p = sec.patterns[slot];
            if (p !== this.currentPattern808) {
                this.currentPattern808 = p;
                this.currentPattern303 = p;
                if (this.onPatternChange) this.onPatternChange(p, time);
            }
            if (sec !== this.song.current) {
                this.song.current = sec;
                if (this.onSection) this.onSection(sec, bar, time, this.barDuration);
            }
            info = { songBar: bar, section: sec, total: this.song.bars };
            this.songBar++;
        } else if (this.barCount > 0 && this.chain.enabled && this.barCount % this.chain.bars === 0) {
            this.chain.index = (this.chain.index + 1) % this.chain.order.length;
            const p = this.chain.order[this.chain.index];
            this.currentPattern808 = p;
            this.currentPattern303 = p;
            if (this.onPatternChange) this.onPatternChange(p, time);
        }
        this.barCount++;
        if (this.onBar) this.onBar(this.barCount, time, info);
    }

    // ---------------------------------------------------------------- transport
    start() {
        if (this.isPlaying) return;
        this.engine.init();
        this.engine.resume();
        this.tr808.init();
        this.tb303.init();
        if (this.stab) this.stab.init();

        this.isPlaying = true;
        this.tick = -1;
        this.barCount = 0;
        this.songBar = 0;
        this.song.current = null;
        this.stutter = null;
        this.fill = null;
        this._last303Time = -10;
        if (this.chain.enabled && !this.song.enabled) {
            const pos = this.chain.order.indexOf(this.currentPattern808);
            this.chain.index = pos >= 0 ? pos : 0;
        }
        this.nextStepTime = this.engine.currentTime + 0.06;
        if (this.onStart) this.onStart(this.nextStepTime);
        this._schedule();
    }

    stop() {
        const wasPlaying = this.isPlaying;
        this.isPlaying = false;
        this.tick = -1;
        this.stutter = null;
        this.fill = null;
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

            this.tick++;
            if (this.tick % 16 === 0) this._onBarStart(this.nextStepTime);

            if (this.glitchJumpFn && this.glitchJumpFn()) {
                this.tick = Math.floor(this.tick / 16) * 16 + Math.floor(Math.random() * 16);
            }

            const dur = this._stepDuration(this.tick);
            this._playStep(this.tick, this.nextStepTime, 1);
            for (const fn of this.stepHooks) fn(this.tick, this.nextStepTime, dur);
            if (this.onStepChange) this.onStepChange(this.tick, this.nextStepTime);
            this.nextStepTime += dur;
        }

        this.timerId = setTimeout(() => this._schedule(), this.lookAhead);
    }

    _stepDuration(tick) {
        if (this.drunk) {
            this.drunkOffset = Math.max(-28, Math.min(28, this.drunkOffset * 0.82 + (Math.random() - 0.5) * 14));
        }
        const secondsPer16th = this.stepDuration;
        let s = this.swing * 0.4;
        if (this.drunk) s = Math.max(0, Math.min(0.45, s + (Math.random() - 0.5) * 0.2));
        return tick % 2 === 0 ? secondsPer16th * (1 + s) : secondsPer16th * (1 - s);
    }

    _playStep(tick, time, velocity = 1) {
        const stepDur = this.stepDuration;
        const hum = this.humanize;
        const jitter = () => hum > 0 ? Math.random() * stepDur * 0.22 * hum : 0;
        const humVel = () => hum > 0 ? 1 - Math.random() * 0.35 * hum : 1;

        // --- drums + samples
        const p808 = this.fill ? this.fill.p808 : this.pattern808;
        const ext = this.fill ? {} : this.ext;
        const lens = this.lens;
        for (const inst of this.tr808.instruments) {
            const row = p808[inst.id];
            if (!row) continue;
            const len = lens[inst.id] || 16;
            const step = tick % len;
            const v = row[step];
            if (!v) continue;
            const e = (ext[inst.id] && ext[inst.id][step]) || null;
            if (e && e.p < 100 && Math.random() * 100 >= e.p) continue;
            if (this.probabilityFn && !this.probabilityFn()) continue;
            const r = e ? e.r : 1;
            const isKick = inst.id === 'kick';
            for (let k = 0; k < r; k++) {
                let t = time + (k * stepDur) / r;
                let vel = velocity * (k ? Math.pow(0.85, k) : 1);
                if (!isKick) { t += jitter(); vel *= humVel(); }
                this.tr808.trigger(inst.id, t, { accent: v === 2, velocity: vel });
                if (isKick) this.engine.duck(t);
                if (this.onTrigger) this.onTrigger('808', { id: inst.id, midi: inst.midi, accent: v === 2, velocity: vel }, t);
            }
        }

        // --- 303
        const pattern = this.fill ? this.fill.l303 : this.pattern303;
        const len3 = this.steps303;
        const step303 = tick % len3;
        const cur = pattern[step303];
        if (cur && cur.active && (!this.probabilityFn || this.probabilityFn()) && !(cur.prob < 100 && Math.random() * 100 >= cur.prob)) {
            const next = pattern[(step303 + 1) % len3];
            const prev = pattern[(step303 - 1 + len3) % len3];
            const r = cur.ratchet || 1;
            if (r > 1) {
                for (let k = 0; k < r; k++) {
                    const t = time + (k * stepDur) / r;
                    const gate = (stepDur / r) * 0.5;
                    this.tb303.trigger(cur.note, cur.octave, t, { accent: cur.accent && k === 0, legato: false, tie: false, gate, velocity: velocity * Math.pow(0.9, k), lock: cur.lock });
                    if (this.onTrigger) this.onTrigger('303', { note: cur.note, octave: cur.octave, accent: cur.accent, gate, velocity }, t);
                }
                this._last303Time = time;
            } else {
                const tie = !!(cur.slide && next && next.active);
                const legato = !!(prev && prev.active && prev.slide) && (time - this._last303Time) < stepDur * 1.6;
                const gate = tie ? stepDur + 0.03 : stepDur * 0.55;
                const t = legato ? time : time + jitter();
                this.tb303.trigger(cur.note, cur.octave, t, {
                    accent: cur.accent, legato, tie, gate, velocity: velocity * humVel(), lock: cur.lock
                });
                if (this.onTrigger) this.onTrigger('303', { note: cur.note, octave: cur.octave, accent: cur.accent, gate, velocity, legato }, t);
                this._last303Time = time;
            }
        }

        // --- chord stab
        if (this.stab) {
            const line = this.patternStab;
            const s = line[tick % 16];
            if (s && s.active && (!this.probabilityFn || this.probabilityFn()) && !(s.prob < 100 && Math.random() * 100 >= s.prob)) {
                const t = time + jitter();
                const gate = stepDur * 1.1;
                this.stab.trigger(s.note, s.octave, s.chord, t, { gate, accent: s.accent, velocity: velocity * humVel() });
                if (this.onTrigger) this.onTrigger('stab', { note: s.note, octave: s.octave, chord: s.chord, accent: s.accent, gate, velocity }, t);
            }
        }
    }

    // ---------------------------------------------------------------- fill
    startFill(ctx = {}) {
        if (this.fill) return false;
        this.fill = {
            p808: MusicGen.variateBeat(this.pattern808, 'fill'),
            l303: MusicGen.variateLine(this.pattern303, 0.5, ctx)
        };
        return true;
    }
    stopFill() { this.fill = null; }

    // ---------------------------------------------------------------- stutter
    startStutter(rate, decayPercent) {
        if (!this.isPlaying || this.stutter) return false;
        this.stutter = {
            rate: Math.max(1, Math.min(32, rate || 8)),
            decay: Math.max(0, Math.min(1, (decayPercent || 0) / 100)),
            held: Math.max(0, this.tick),
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
        this._playStep(st.held, this.nextStepTime, vel);
        if (this.onStepChange) this.onStepChange(st.held, this.nextStepTime);
        st.n++;
        st.elapsed += period;
        this.nextStepTime += period;
    }

    stopStutter() {
        const st = this.stutter;
        if (!st) return;
        const s16 = this.stepDuration;
        const adv = Math.round(st.elapsed / s16);
        // next loop iteration increments first, so park one step behind
        this.tick = st.held + adv - 1;
        this.stutter = null;
    }

    // ---------------------------------------------------------------- serialisation
    toJSON() {
        return {
            bpm: this.bpm,
            swing: Math.round(this.swing * 100),
            humanize: Math.round(this.humanize * 100),
            patterns808: this.patterns808,
            ext808: this.ext808,
            len808: this.len808,
            patterns303: this.patterns303,
            patternsStab: this.patternsStab,
            steps303: this.steps303,
            currentPattern: this.currentPattern808,
            chain: { enabled: this.chain.enabled, bars: this.chain.bars },
            song: { enabled: this.song.enabled, bars: this.song.bars, sections: this.song.sections }
        };
    }

    fromJSON(data) {
        if (!data) return;
        if (data.bpm) this.setBPM(data.bpm);
        if (data.swing !== undefined) this.setSwing(data.swing);
        if (data.humanize !== undefined) this.setHumanize(data.humanize);
        if (Array.isArray(data.patterns808)) {
            data.patterns808.slice(0, 4).forEach((p, i) => {
                const ext = Array.isArray(data.ext808) ? data.ext808[i] : null;
                const lens = Array.isArray(data.len808) ? data.len808[i] : null;
                this.setPattern808(i, p || {}, ext, lens);
            });
        }
        if (Array.isArray(data.patterns303)) data.patterns303.slice(0, 4).forEach((p, i) => this.setPattern303(i, p || []));
        if (Array.isArray(data.patternsStab)) data.patternsStab.slice(0, 4).forEach((p, i) => this.setPatternStab(i, p || []));
        if (data.chain) {
            this.setChainBars(data.chain.bars);
            this.chain.enabled = !!data.chain.enabled;
        }
        if (data.song && Array.isArray(data.song.sections) && data.song.sections.length) {
            this.setSong(data.song);
            this.song.enabled = !!data.song.enabled;
        }
        const cp = parseInt(data.currentPattern);
        if (cp >= 0 && cp < 4) { this.currentPattern808 = cp; this.currentPattern303 = cp; }
    }
}
