/**
 * MusicGen — musical (non-chaotic) pattern generation.
 *
 *   - Beats come from style templates (fixed kick / backbeat skeleton + weighted extras, capped)
 *   - Bass lines are motif based: an 8-step cell repeated with a variation, in one key / scale,
 *     root-heavy like real acid lines, with slides only between adjacent notes
 *   - Chord stabs follow a scale-degree progression across the four patterns
 *   - compose() builds 4 coherent patterns (A1 base, A2 alt, B1 build, B2 fill) for chain playback
 *   - arrange() lays those patterns out as a 32 / 64 bar song with mutes and filter sweeps
 *
 * 808 cells: 0 = off, 1 = on, 2 = accent.  Per-step extras (probability / ratchet) ride along as a
 * non-enumerable `__ext` property: ext[instrument][step] = { p: 0..100, r: 1..4 }.
 */
const MusicGen = (() => {
    const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const INSTRUMENTS = ['kick', 'snare', 'clap', 'hihat_c', 'hihat_o', 'tom_lo', 'tom_hi', 'cymbal', 'rimshot', 'cowbell'];
    const KIT_CAPABLE = ['kick', 'snare', 'clap', 'hihat_c', 'hihat_o', 'tom_lo', 'tom_hi', 'cymbal', 'rimshot'];

    const SCALES = {
        minorPenta: { name: 'MINOR PENTA', iv: [0, 3, 5, 7, 10] },
        aeolian:    { name: 'NAT. MINOR',  iv: [0, 2, 3, 5, 7, 8, 10] },
        dorian:     { name: 'DORIAN',      iv: [0, 2, 3, 5, 7, 9, 10] },
        phrygian:   { name: 'PHRYGIAN',    iv: [0, 1, 3, 5, 7, 8, 10] },
        harmMinor:  { name: 'HARM. MINOR', iv: [0, 2, 3, 5, 7, 8, 11] },
        blues:      { name: 'BLUES',       iv: [0, 3, 5, 6, 7, 10] },
        majorPenta: { name: 'MAJOR PENTA', iv: [0, 2, 4, 7, 9] }
    };

    const CHORDS = {
        min:  { name: 'm',    iv: [0, 3, 7] },
        maj:  { name: 'M',    iv: [0, 4, 7] },
        min7: { name: 'm7',   iv: [0, 3, 7, 10] },
        maj7: { name: 'M7',   iv: [0, 4, 7, 11] },
        dom7: { name: '7',    iv: [0, 4, 7, 10] },
        sus2: { name: 'sus2', iv: [0, 2, 7] },
        sus4: { name: 'sus4', iv: [0, 5, 7] },
        m9:   { name: 'm9',   iv: [0, 3, 7, 14] },
        dim:  { name: 'dim',  iv: [0, 3, 6] },
        pow:  { name: '5',    iv: [0, 7, 12] }
    };
    const CHORD_KEYS = Object.keys(CHORDS);

    // How attractive each interval (semitones above root) is for a bass line
    const INTERVAL_WEIGHT = { 0: 10, 7: 4, 10: 3, 3: 3, 5: 2, 12: 2, 2: 1.2, 8: 1.2, 9: 1, 1: 1.3, 6: 1.5, 11: 0.7, 4: 2 };

    const STYLES = {
        techno: {
            name: 'TECHNO', bpm: [128, 140], swing: [0, 12], density: ['mid', 'dense'],
            scales: ['minorPenta', 'phrygian', 'aeolian'],
            kicks: [[0, 4, 8, 12]], kickExtra: [[14], [10], [15]], kickExtraP: 0.3,
            clapP: 0.85, snareP: 0.3, hatModes: ['off8', '16', '8', 'off8-16'], openP: 0.55,
            perc: { rimshot: { p: 0.12, max: 3 }, cowbell: { p: 0.05, max: 1 }, tom_lo: { p: 0.06, max: 1 }, tom_hi: { p: 0.06, max: 1 } },
            cymbalP: 0.3,
            synth: { cutoff: [350, 1400], resonance: [8, 20], envMod: [40, 80], decay: [0.18, 0.45], accent: [50, 85], sawP: 0.7 },
            stab: { p: 0.55, oct: [2, 3], rhythms: [[6, 14], [0], [3, 11], [10], [2, 6, 10, 14]],
                prog: [[0, 0, 0, 0], [0, 0, 3, 0], [0, 0, 4, 3], [0, 4, 0, 3]], seventhP: 0.3,
                cutoff: [500, 1600], decay: [0.12, 0.3], release: [0.1, 0.3], chorus: [20, 60] },
            kit: { kick: 0.5, snare: 0.5, clap: 0.5, hihat_c: 0.6, hihat_o: 0.6, rimshot: 0.3, cymbal: 0.4 }
        },
        house: {
            name: 'HOUSE', bpm: [120, 128], swing: [8, 25], density: ['sparse', 'mid'],
            scales: ['dorian', 'minorPenta', 'majorPenta'],
            kicks: [[0, 4, 8, 12]], kickExtra: [[15], [11]], kickExtraP: 0.2,
            clapP: 0.95, snareP: 0.15, hatModes: ['off8', 'off8-16', '16'], openP: 0.85,
            perc: { rimshot: { p: 0.12, max: 3 }, cowbell: { p: 0.1, max: 2 }, tom_lo: { p: 0.05, max: 1 }, tom_hi: { p: 0.08, max: 2 } },
            cymbalP: 0.25,
            synth: { cutoff: [300, 1000], resonance: [5, 14], envMod: [30, 60], decay: [0.2, 0.5], accent: [40, 70], sawP: 0.6 },
            stab: { p: 0.9, oct: [3, 3, 4], rhythms: [[2, 6, 10, 14], [2, 10], [6, 14], [3, 11], [2, 6, 10]],
                prog: [[0, 0, 3, 4], [0, 5, 3, 4], [0, 3, 4, 0], [0, 2, 3, 4], [0, 0, 5, 4]], seventhP: 0.65,
                cutoff: [900, 2600], decay: [0.15, 0.35], release: [0.15, 0.4], chorus: [40, 80] },
            kit: { kick: 0.4, clap: 0.7, hihat_c: 0.7, hihat_o: 0.7, rimshot: 0.3 }
        },
        acid: {
            name: 'ACID', bpm: [130, 145], swing: [0, 10], density: ['mid', 'dense'],
            scales: ['minorPenta', 'phrygian', 'blues'],
            kicks: [[0, 4, 8, 12]], kickExtra: [[14], [10, 14]], kickExtraP: 0.35,
            clapP: 0.8, snareP: 0.5, hatModes: ['16', 'off8-16', 'off8'], openP: 0.6,
            perc: { rimshot: { p: 0.15, max: 3 }, cowbell: { p: 0.04, max: 1 }, tom_lo: { p: 0.05, max: 1 }, tom_hi: { p: 0.05, max: 1 } },
            cymbalP: 0.3,
            synth: { cutoff: [450, 1800], resonance: [12, 25], envMod: [55, 95], decay: [0.15, 0.4], accent: [60, 95], sawP: 0.6 },
            stab: { p: 0.35, oct: [2, 3], rhythms: [[10], [2, 10], [6]],
                prog: [[0, 0, 0, 0], [0, 0, 3, 0]], seventhP: 0.2,
                cutoff: [400, 1200], decay: [0.1, 0.25], release: [0.08, 0.2], chorus: [10, 40] },
            kit: { hihat_c: 0.15, hihat_o: 0.15 }
        },
        electro: {
            name: 'ELECTRO', bpm: [118, 132], swing: [0, 8], density: ['sparse', 'mid'],
            scales: ['minorPenta', 'blues', 'aeolian'],
            kicks: [[0, 6, 10], [0, 7, 10, 14], [0, 6, 8, 11], [0, 3, 6, 10]], kickExtra: [[13], [14]], kickExtraP: 0.3,
            clapP: 0.6, snareP: 0.95, hatModes: ['8', 'off8-16', '16'], openP: 0.4,
            perc: { rimshot: { p: 0.1, max: 2 }, cowbell: { p: 0.18, max: 2 }, tom_lo: { p: 0.1, max: 2 }, tom_hi: { p: 0.12, max: 2 } },
            cymbalP: 0.2,
            synth: { cutoff: [250, 1200], resonance: [6, 16], envMod: [35, 70], decay: [0.15, 0.4], accent: [40, 75], sawP: 0.5 },
            stab: { p: 0.55, oct: [3, 4], rhythms: [[3, 11], [6], [3, 11, 14], [7, 15]],
                prog: [[0, 0, 3, 0], [0, 3, 0, 4], [0, 0, 5, 3]], seventhP: 0.4,
                cutoff: [600, 2000], decay: [0.1, 0.3], release: [0.1, 0.3], chorus: [30, 70] },
            kit: {}
        },
        minimal: {
            name: 'MINIMAL', bpm: [124, 132], swing: [0, 15], density: ['sparse'],
            scales: ['minorPenta', 'aeolian', 'dorian'],
            kicks: [[0, 4, 8, 12]], kickExtra: [], kickExtraP: 0,
            clapP: 0.35, snareP: 0.05, hatModes: ['off8', '8'], openP: 0.35,
            perc: { rimshot: { p: 0.18, max: 3 }, cowbell: { p: 0.06, max: 1 }, tom_lo: { p: 0.1, max: 1 }, tom_hi: { p: 0.08, max: 1 } },
            cymbalP: 0.1,
            synth: { cutoff: [200, 800], resonance: [4, 12], envMod: [20, 50], decay: [0.25, 0.6], accent: [30, 60], sawP: 0.5 },
            stab: { p: 0.4, oct: [3, 4], rhythms: [[14], [7], [10], [6, 14]],
                prog: [[0, 0, 0, 0], [0, 0, 0, 3]], seventhP: 0.5,
                cutoff: [400, 1200], decay: [0.15, 0.4], release: [0.2, 0.5], chorus: [30, 70] },
            kit: { hihat_c: 0.5, hihat_o: 0.5, rimshot: 0.3 }
        },
        breaks: {
            name: 'BREAKS', bpm: [92, 104], swing: [10, 30], density: ['mid'],
            scales: ['minorPenta', 'blues', 'dorian'],
            kicks: [[0, 7, 10], [0, 10], [0, 6, 10, 15], [0, 3, 10]], kickExtra: [[14], [8]], kickExtraP: 0.3,
            clapP: 0.3, snareP: 0.98, hatModes: ['8', '16', 'off8-16'], openP: 0.4,
            perc: { rimshot: { p: 0.1, max: 2 }, cowbell: { p: 0.06, max: 1 }, tom_lo: { p: 0.1, max: 2 }, tom_hi: { p: 0.1, max: 2 } },
            cymbalP: 0.3,
            synth: { cutoff: [250, 900], resonance: [5, 14], envMod: [30, 65], decay: [0.2, 0.5], accent: [40, 70], sawP: 0.7 },
            stab: { p: 0.6, oct: [3, 4], rhythms: [[2, 10], [3, 11], [6, 14], [2, 7, 10]],
                prog: [[0, 0, 3, 4], [0, 3, 0, 4], [0, 0, 5, 3]], seventhP: 0.6,
                cutoff: [700, 2200], decay: [0.15, 0.35], release: [0.15, 0.4], chorus: [30, 70] },
            kit: { snare: 0.6, kick: 0.4 }
        }
    };

    // ------------------------------------------------------------ utilities
    const rnd = (a, b) => a + Math.random() * (b - a);
    const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
    const chance = p => Math.random() < p;
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const weightedPick = (items, weights) => {
        const total = weights.reduce((s, w) => s + w, 0);
        let r = Math.random() * total;
        for (let i = 0; i < items.length; i++) {
            r -= weights[i];
            if (r <= 0) return items[i];
        }
        return items[items.length - 1];
    };
    const clone808 = p => {
        const c = {};
        Object.keys(p).forEach(k => { c[k] = p[k].slice(); });
        if (p.__ext) setExtAll(c, JSON.parse(JSON.stringify(p.__ext)));
        return c;
    };
    const cloneLine = l => l.map(s => ({ ...s, lock: s.lock ? { ...s.lock } : null }));

    /** Attach per-step extras without polluting Object.keys(pattern). */
    function setExtAll(P, ext) {
        Object.defineProperty(P, '__ext', { value: ext, enumerable: false, configurable: true, writable: true });
        return P;
    }
    /** Drop extras that point at empty cells (after toggles / clears). */
    function cleanExt(P) {
        const ext = P.__ext;
        if (!ext) return P;
        Object.keys(ext).forEach(inst => {
            Object.keys(ext[inst]).forEach(step => { if (!P[inst] || !P[inst][step]) delete ext[inst][step]; });
            if (!Object.keys(ext[inst]).length) delete ext[inst];
        });
        return P;
    }
    function setExt(P, inst, step, data) {
        if (!P.__ext) setExtAll(P, {});
        if (!P.__ext[inst]) P.__ext[inst] = {};
        P.__ext[inst][step] = { ...(P.__ext[inst][step] || {}), ...data };
    }

    function empty808() {
        const p = {};
        INSTRUMENTS.forEach(id => { p[id] = new Array(16).fill(0); });
        return p;
    }

    function emptyStep() {
        return { active: false, note: 'C', octave: 2, accent: false, slide: false, prob: 100, ratchet: 1, lock: null };
    }

    function emptyLine() {
        const l = [];
        for (let i = 0; i < 16; i++) l.push(emptyStep());
        return l;
    }

    function emptyStabStep() {
        return { active: false, note: 'C', octave: 3, chord: 'min', accent: false, prob: 100 };
    }

    function emptyStabLine() {
        const l = [];
        for (let i = 0; i < 16; i++) l.push(emptyStabStep());
        return l;
    }

    // ------------------------------------------------------------ beats
    function generateBeat(styleKey) {
        const S = STYLES[styleKey] || STYLES.techno;
        const P = empty808();
        const set = (inst, i, v = 1) => { if (i >= 0 && i < 16) P[inst][i] = Math.max(P[inst][i], v); };

        pick(S.kicks).forEach(i => set('kick', i, i === 0 ? 2 : 1));
        if (S.kickExtra.length && chance(S.kickExtraP)) pick(S.kickExtra).forEach(i => set('kick', i, 1));

        let hasBackbeat = false;
        if (chance(S.clapP)) { [4, 12].forEach(i => set('clap', i, 1)); hasBackbeat = true; }
        if (chance(S.snareP)) { [4, 12].forEach(i => set('snare', i, 1)); hasBackbeat = true; }
        if (!hasBackbeat && chance(0.6)) { [4, 12].forEach(i => set('rimshot', i, 1)); hasBackbeat = true; }

        const mode = pick(S.hatModes);
        for (let i = 0; i < 16; i++) {
            const even = i % 2 === 0;
            switch (mode) {
                case 'off8':    if (i % 4 === 2) set('hihat_c', i, 1); break;
                case '8':       if (even) set('hihat_c', i, i % 4 === 0 ? 2 : 1); break;
                case '16':      set('hihat_c', i, i % 4 === 2 ? 2 : 1); break;
                case 'off8-16': if (even) set('hihat_c', i, i % 4 === 2 ? 2 : 1); else if (chance(0.4)) { set('hihat_c', i, 1); setExt(P, 'hihat_c', i, { p: 70 }); } break;
            }
        }
        let openCount = 0;
        [2, 6, 10, 14].forEach(i => {
            if (openCount < 4 && chance(S.openP)) {
                set('hihat_o', i, 1);
                P.hihat_c[i] = 0;
                openCount++;
            }
        });
        if (mode === 'off8' && openCount === 4) {
            [6, 14].forEach(i => { P.hihat_o[i] = 0; P.hihat_c[i] = 1; });
        }

        Object.keys(S.perc).forEach(inst => {
            const cfg = S.perc[inst];
            let count = 0;
            const candidates = inst === 'rimshot' || inst === 'cowbell'
                ? [1, 3, 5, 7, 9, 11, 13, 15, 2, 6, 10, 14]
                : [6, 7, 13, 14, 15, 11, 3];
            for (const i of candidates) {
                if (count >= cfg.max) break;
                if (chance(cfg.p) && !P.kick[i]) { set(inst, i, 1); count++; }
            }
        });

        if (chance(S.cymbalP)) set('cymbal', 0, 1);
        return cleanExt(P);
    }

    function variateBeat(base, kind) {
        const P = clone808(base);
        const odd = [1, 3, 5, 7, 9, 11, 13, 15];
        const toggle = (inst, i) => { P[inst][i] = P[inst][i] ? 0 : 1; };

        if (kind === 'alt') {
            const n = rndInt(1, 2);
            for (let k = 0; k < n; k++) {
                const i = pick(odd);
                toggle('hihat_c', i);
                if (P.hihat_c[i]) setExt(P, 'hihat_c', i, { p: 60 });
            }
            if (chance(0.4)) P.rimshot[pick(odd)] = 1;
            if (chance(0.3)) {
                const from = [2, 6, 10, 14].filter(i => P.hihat_o[i]);
                const to = [2, 6, 10, 14].filter(i => !P.hihat_o[i]);
                if (from.length && to.length) { P.hihat_o[pick(from)] = 0; P.hihat_o[pick(to)] = 1; }
            }
            P.cymbal = new Array(16).fill(0);
        }

        if (kind === 'build') {
            if (chance(0.7)) { const i = pick([14, 10, 11]); P.kick[i] = 1; }
            if (chance(0.6)) { const inst = P.clap[4] ? 'clap' : (P.snare[4] ? 'snare' : 'clap'); P[inst][pick([13, 15])] = 1; }
            const perc = pick(['cowbell', 'tom_hi', 'tom_lo', 'rimshot']);
            for (let k = 0; k < rndInt(1, 2); k++) P[perc][pick(odd)] = 1;
            if (chance(0.5)) [2, 6, 10, 14].forEach(i => { if (chance(0.7)) { P.hihat_o[i] = 1; P.hihat_c[i] = 0; } });
            if (chance(0.5)) { P.hihat_c[15] = 1; P.hihat_o[15] = 0; setExt(P, 'hihat_c', 15, { r: pick([2, 3]) }); }
            P.cymbal = new Array(16).fill(0);
        }

        if (kind === 'fill') {
            ['snare', 'clap', 'tom_lo', 'tom_hi', 'rimshot', 'cowbell'].forEach(inst => {
                for (let i = 12; i < 16; i++) P[inst][i] = 0;
            });
            const fill = pick(['snareRoll', 'tomRun', 'clapStack', 'hatRoll', 'dropout']);
            switch (fill) {
                case 'snareRoll':
                    P.snare[12] = 2; P.snare[13] = 1; P.snare[14] = 2; P.snare[15] = 1;
                    setExt(P, 'snare', 14, { r: 2 });
                    setExt(P, 'snare', 15, { r: pick([2, 3, 4]) });
                    break;
                case 'tomRun':
                    P.tom_hi[12] = 1; P.tom_hi[13] = 1; P.tom_lo[14] = 1; P.tom_lo[15] = 2;
                    if (chance(0.5)) setExt(P, 'tom_hi', 13, { r: 2 });
                    break;
                case 'clapStack':
                    P.clap[12] = 1; P.clap[14] = 1; P.clap[15] = 2; P.snare[13] = 1; P.snare[15] = 1;
                    setExt(P, 'clap', 15, { r: 2 });
                    break;
                case 'hatRoll':
                    for (let i = 12; i < 16; i++) { P.hihat_c[i] = i === 12 ? 2 : 1; P.hihat_o[i] = 0; }
                    P.hihat_o[15] = 1; P.hihat_c[15] = 0;
                    setExt(P, 'hihat_c', 14, { r: 2 });
                    break;
                case 'dropout':
                    INSTRUMENTS.forEach(inst => { for (let i = 13; i < 16; i++) P[inst][i] = 0; });
                    P.kick[12] = 2;
                    break;
            }
            P.cymbal = new Array(16).fill(0);
        }
        return cleanExt(P);
    }

    // ------------------------------------------------------------ bass lines
    const GATE_P = {
        sparse: [1.0, 0.15, 0.45, 0.2, 0.75, 0.2, 0.45, 0.25],
        mid:    [1.0, 0.3, 0.6, 0.35, 0.85, 0.35, 0.6, 0.4],
        dense:  [1.0, 0.55, 0.8, 0.55, 0.95, 0.55, 0.8, 0.6]
    };
    const MIN_NOTES = { sparse: 4, mid: 6, dense: 9 };

    function pitchFor(root, semis, baseOct) {
        let octave = baseOct + Math.floor((root + semis) / 12);
        if (octave > 3) octave = 3;
        if (octave < 1) octave = 1;
        return { note: NOTES[(root + semis) % 12], octave };
    }

    function pickDegree(iv, avoidRoot = false) {
        const items = iv.slice();
        const weights = iv.map(s => (INTERVAL_WEIGHT[s] || 1) * (avoidRoot && s === 0 ? 0.0001 : 1));
        return weightedPick(items, weights);
    }

    function generateLine({ root = 9, scale = 'minorPenta', density = 'mid', baseOct = null } = {}) {
        const iv = (SCALES[scale] || SCALES.minorPenta).iv;
        const gateP = GATE_P[density] || GATE_P.mid;
        if (baseOct === null) baseOct = chance(0.6) ? 1 : 2;

        const cell = [];
        let nonRootRun = 0;
        for (let i = 0; i < 8; i++) {
            const s = emptyStep();
            s.active = chance(gateP[i]);
            if (s.active) {
                let semis = nonRootRun >= 2 ? 0 : pickDegree(iv);
                if (i === 0 && chance(0.85)) semis = 0;
                nonRootRun = semis === 0 ? 0 : nonRootRun + 1;
                let oct = baseOct;
                if (semis === 0 && chance(i % 4 === 0 ? 0.12 : 0.25)) oct += 1;
                else if (semis !== 0 && chance(0.12)) oct += 1;
                const p = pitchFor(root, semis, Math.min(oct, 3));
                s.note = p.note;
                s.octave = p.octave;
                s.accent = chance(i % 2 === 0 ? 0.32 : 0.18);
            }
            cell.push(s);
        }

        const half2 = cloneLine(cell);
        const activeIdx = half2.map((s, i) => s.active ? i : -1).filter(i => i >= 0);
        for (let k = 0; k < rndInt(1, 2) && activeIdx.length; k++) {
            const i = pick(activeIdx);
            const p = pitchFor(root, pickDegree(iv, true), baseOct + (chance(0.2) ? 1 : 0));
            half2[i].note = p.note;
            half2[i].octave = Math.min(3, p.octave);
        }
        if (chance(0.55)) {
            const fifth = iv.includes(7) ? 7 : iv[Math.floor(iv.length / 2)];
            const top = iv[iv.length - 1];
            const third = iv[1];
            const t = pick([[fifth, 0], [top, fifth], [12, top], [third, 0], [top, 12]]);
            [6, 7].forEach((i, k) => {
                half2[i].active = true;
                const p = pitchFor(root, t[k], baseOct);
                half2[i].note = p.note;
                half2[i].octave = Math.min(3, p.octave);
            });
            half2[6].slide = true;
            if (chance(0.5)) half2[7].slide = true;
        }

        const line = [...cell, ...half2];

        let notes = line.filter(s => s.active).length;
        for (const i of [0, 8, 4, 12, 2, 10, 6, 14]) {
            if (notes >= MIN_NOTES[density]) break;
            if (!line[i].active) {
                line[i].active = true;
                const p = pitchFor(root, 0, baseOct);
                line[i].note = p.note;
                line[i].octave = p.octave;
                notes++;
            }
        }

        // a few ghost notes on weak steps get a probability so the loop breathes
        line.forEach((s, i) => { if (s.active && i % 4 === 3 && !s.accent && chance(0.3)) s.prob = pick([60, 75]); });

        finishLine(line, density);
        return line;
    }

    /** Normalise accents / slides so the line stays playable. */
    function finishLine(line, density = 'mid') {
        const maxSlides = density === 'dense' ? 6 : 5;
        let slides = 0;
        for (let i = 0; i < 16; i++) {
            const cur = line[i];
            const next = line[(i + 1) % 16];
            if (cur.prob === undefined) cur.prob = 100;
            if (!cur.ratchet) cur.ratchet = 1;
            if (cur.lock === undefined) cur.lock = null;
            if (!cur.active || !next.active) { cur.slide = false; continue; }
            if (cur.slide) { slides++; continue; }
            const differs = cur.note !== next.note || cur.octave !== next.octave;
            if (slides < maxSlides && chance(differs ? 0.42 : 0.2)) { cur.slide = true; slides++; }
        }
        while (slides > maxSlides) {
            const idx = line.map((s, i) => s.slide ? i : -1).filter(i => i >= 0);
            line[pick(idx)].slide = false;
            slides--;
        }

        const accentIdx = () => line.map((s, i) => s.active && s.accent ? i : -1).filter(i => i >= 0);
        while (accentIdx().length > 6) line[pick(accentIdx())].accent = false;
        if (accentIdx().length < 2) {
            for (const i of [0, 8, 4, 12, 2, 10]) {
                if (line[i].active) { line[i].accent = true; if (accentIdx().length >= 2) break; }
            }
        }
        line.forEach(s => { if (!s.active) { s.accent = false; s.slide = false; s.prob = 100; s.ratchet = 1; s.lock = null; } });
        return line;
    }

    function variateLine(line, amount = 0.25, { root = 9, scale = 'minorPenta', density = 'mid' } = {}) {
        const iv = (SCALES[scale] || SCALES.minorPenta).iv;
        const out = cloneLine(line);
        const baseOct = Math.min(...out.filter(s => s.active).map(s => s.octave), 3) || 1;
        const before = JSON.stringify(out);
        out.forEach((s, i) => {
            if (s.active && chance(amount * 0.5)) {
                const p = pitchFor(root, pickDegree(iv), baseOct + (chance(0.2) ? 1 : 0));
                s.note = p.note;
                s.octave = Math.min(3, p.octave);
            }
            if (s.active && chance(amount * 0.3)) s.accent = !s.accent;
            if (i % 4 !== 0 && chance(amount * 0.2)) {
                s.active = !s.active;
                if (s.active) {
                    const p = pitchFor(root, 0, baseOct);
                    s.note = p.note;
                    s.octave = p.octave;
                }
            }
        });
        finishLine(out, density);
        if (JSON.stringify(out) === before) {
            const idx = out.map((s, i) => s.active && i !== 0 ? i : -1).filter(i => i >= 0);
            if (idx.length) {
                const s = out[pick(idx)];
                const p = pitchFor(root, pickDegree(iv, true), baseOct);
                s.note = p.note;
                s.octave = Math.min(3, p.octave);
                s.accent = !s.accent;
                finishLine(out, density);
            }
        }
        return out;
    }

    function transposeLine(line, semis) {
        return line.map(s => {
            if (!s.active) return { ...s };
            let midi = s.octave * 12 + NOTES.indexOf(s.note) + semis;
            let octave = Math.floor(midi / 12);
            while (octave > 3) { octave--; midi -= 12; }
            while (octave < 1) { octave++; midi += 12; }
            return { ...s, note: NOTES[((midi % 12) + 12) % 12], octave };
        });
    }

    function quantizeLine(line, root, scale) {
        const iv = (SCALES[scale] || SCALES.minorPenta).iv;
        return line.map(s => {
            if (!s.active) return { ...s };
            const semis = ((NOTES.indexOf(s.note) - root) % 12 + 12) % 12;
            let best = iv[0], bestD = 99;
            iv.forEach(x => { const d = Math.min(Math.abs(x - semis), 12 - Math.abs(x - semis)); if (d < bestD) { bestD = d; best = x; } });
            return { ...s, note: NOTES[(root + best) % 12] };
        });
    }

    // ------------------------------------------------------------ chords / stabs
    /** Triad (optionally with a 7th) on scale degree `d`, snapped to the scale's own tones. */
    function chordForDegree(iv, d, seventhP = 0.4) {
        const n = iv.length;
        const semis = iv[((d % n) + n) % n];
        const inScale = x => iv.includes(((semis + x) % 12 + 12) % 12);
        let third = inScale(3) ? 3 : (inScale(4) ? 4 : 0);
        let fifth = inScale(7) ? 7 : (inScale(6) && third === 3 ? 6 : 7);
        let type;
        if (third === 3 && fifth === 7) type = 'min';
        else if (third === 4 && fifth === 7) type = 'maj';
        else if (third === 3 && fifth === 6) type = 'dim';
        else if (inScale(2)) type = 'sus2';
        else if (inScale(5)) type = 'sus4';
        else type = 'pow';
        if (chance(seventhP)) {
            if (type === 'min' && inScale(10)) type = chance(0.25) && inScale(2) ? 'm9' : 'min7';
            else if (type === 'maj' && inScale(11)) type = 'maj7';
            else if (type === 'maj' && inScale(10)) type = 'dom7';
        }
        return { semis, type };
    }

    function stabPitch(root, semis, oct) {
        let octave = oct + Math.floor((root + semis) / 12);
        octave = Math.max(2, Math.min(5, octave));
        return { note: NOTES[(root + semis) % 12], octave };
    }

    /**
     * Four stab patterns following a progression. Returns [] of 4 lines; all empty when the style skips stabs.
     */
    function generateStabs({ root = 9, scale = 'minorPenta', style = 'house', force = false } = {}) {
        const S = STYLES[style] || STYLES.house;
        const cfg = S.stab;
        const lines = [emptyStabLine(), emptyStabLine(), emptyStabLine(), emptyStabLine()];
        if (!force && !chance(cfg.p)) return lines;

        const iv = (SCALES[scale] || SCALES.minorPenta).iv;
        const oct = pick(cfg.oct);
        const rhythm = pick(cfg.rhythms);
        const prog = pick(cfg.prog);
        const chords = prog.map(d => chordForDegree(iv, d, cfg.seventhP));

        lines.forEach((line, pi) => {
            const ch = chords[pi];
            let steps = rhythm.slice();
            if (pi === 1 && rhythm.length > 2 && chance(0.5)) steps = steps.filter((_, k) => k !== 1);   // A2: thin out
            if (pi === 2 && chance(0.5)) steps.push(pick([15, 13, 7]));                                  // B1: extra push
            steps = [...new Set(steps)].filter(i => i >= 0 && i < 16);
            steps.forEach((i, k) => {
                const p = stabPitch(root, ch.semis, oct);
                const s = line[i];
                s.active = true;
                s.note = p.note;
                s.octave = p.octave;
                s.chord = ch.type;
                s.accent = k === 0 || (i % 8 === 0);
                s.prob = 100;
            });
            if (pi === 3) {
                // B2: pickup into the top of the loop with the first chord
                const back = chords[0];
                const p = stabPitch(root, back.semis, oct);
                const i = pick([15, 14]);
                line[i] = { active: true, note: p.note, octave: p.octave, chord: back.type, accent: false, prob: 100 };
            }
        });
        return lines;
    }

    function finishStabLine(line) {
        return line.map(s => ({
            active: !!s.active,
            note: NOTES.includes(s.note) ? s.note : 'C',
            octave: Math.max(2, Math.min(5, parseInt(s.octave) || 3)),
            chord: CHORDS[s.chord] ? s.chord : 'min',
            accent: !!s.active && !!s.accent,
            prob: s.active ? Math.max(0, Math.min(100, parseInt(s.prob ?? 100))) : 100
        }));
    }

    function transposeStabs(line, semis) {
        return line.map(s => {
            if (!s.active) return { ...s };
            let midi = s.octave * 12 + NOTES.indexOf(s.note) + semis;
            let octave = Math.floor(midi / 12);
            while (octave > 5) { octave--; midi -= 12; }
            while (octave < 2) { octave++; midi += 12; }
            return { ...s, note: NOTES[((midi % 12) + 12) % 12], octave };
        });
    }

    function stabParams(styleKey) {
        const S = (STYLES[styleKey] || STYLES.house).stab;
        return {
            cutoff: Math.round(rnd(...S.cutoff)),
            resonance: Math.round(rnd(2, 8)),
            envMod: Math.round(rnd(30, 75)),
            decay: Math.round(rnd(...S.decay) * 100) / 100,
            release: Math.round(rnd(...S.release) * 100) / 100,
            detune: Math.round(rnd(6, 18)),
            chorus: Math.round(rnd(...S.chorus)),
            waveform: chance(0.8) ? 'sawtooth' : 'square'
        };
    }

    // ------------------------------------------------------------ kits
    function kitFor(styleKey) {
        const S = STYLES[styleKey] || STYLES.techno;
        const kit = {};
        KIT_CAPABLE.forEach(id => { kit[id] = chance(S.kit[id] || 0) ? '909' : '808'; });
        // hats travel together
        kit.hihat_o = kit.hihat_c;
        return kit;
    }

    // ------------------------------------------------------------ compose
    function synthParams(styleKey) {
        const S = (STYLES[styleKey] || STYLES.techno).synth;
        return {
            cutoff: Math.round(rnd(...S.cutoff)),
            resonance: Math.round(rnd(...S.resonance)),
            envMod: Math.round(rnd(...S.envMod)),
            decay: Math.round(rnd(...S.decay) * 100) / 100,
            accent: Math.round(rnd(...S.accent)),
            drive: Math.round(rnd(10, 45)),
            waveform: chance(S.sawP) ? 'sawtooth' : 'square'
        };
    }

    function compose({ style, root, scale } = {}) {
        const styleKey = STYLES[style] ? style : pick(Object.keys(STYLES));
        const S = STYLES[styleKey];
        if (root === undefined || root === null || root === 'random') root = rndInt(0, 11);
        root = Number(root);
        if (!SCALES[scale]) scale = pick(S.scales);
        const density = pick(S.density);

        const base = generateBeat(styleKey);
        if (chance(0.5)) base.cymbal[0] = 1;
        const beats = [base, variateBeat(base, 'alt'), variateBeat(base, 'build'), variateBeat(base, 'fill')];

        const L1 = generateLine({ root, scale, density });
        const L2 = variateLine(L1, 0.25, { root, scale, density });
        let L3;
        if (chance(0.5)) {
            L3 = finishLine(quantizeLine(transposeLine(L1, pick([5, 7, -5, 3])), root, scale), density);
        } else {
            L3 = variateLine(L1, 0.45, { root, scale, density });
        }
        const L4 = variateLine(L3, 0.5, { root, scale, density });
        const lines = [L1, L2, L3, L4];

        return {
            style: styleKey,
            root,
            scale,
            density,
            bpm: rndInt(...S.bpm),
            swing: rndInt(...S.swing),
            patterns808: beats,
            patterns303: lines,
            patternsStab: generateStabs({ root, scale, style: styleKey }),
            synth: synthParams(styleKey),
            stab: stabParams(styleKey),
            kit: kitFor(styleKey),
            delay: { on: chance(0.6), time: pick([3, 6, 2, 3]), feedback: rndInt(28, 48), mix: rndInt(14, 28) }
        };
    }

    // ------------------------------------------------------------ arrangement
    const ALL_BUT = (keep) => ['kick', 'snare', 'clap', 'hihat_c', 'hihat_o', 'tom_lo', 'tom_hi', 'cymbal', 'rimshot', 'cowbell',
        's1', 's2', 's3', 's4', '303', 'stab'].filter(id => !keep.includes(id));

    /**
     * Song layout over the four patterns. Sections: { name, start, len, patterns, mutes, filter:[from,to]|null, delay, reverb }.
     * `patterns` cycles every chainBars bars inside the section.
     */
    function arrange({ bars = 32, chainBars = 4 } = {}) {
        const sec = (name, start, len, patterns, mutes, extra = {}) => ({ name, start, len, patterns, mutes, filter: null, delay: null, reverb: null, ...extra });
        const introKeep = ['kick', 'hihat_c', 'hihat_o', 'rimshot', 's1'];
        const buildMutes = ['stab', 'cymbal'];
        const breakMutes = ['kick', 'tom_lo', 'tom_hi', 's1', 's2'];
        let sections;
        if (bars >= 64) {
            sections = [
                sec('INTRO',  0,  8, [0],    ALL_BUT(introKeep), { filter: [-75, 0] }),
                sec('BUILD',  8,  8, [1],    buildMutes,         { delay: true }),
                sec('DROP',   16, 16, [2, 3], [],                 { delay: true }),
                sec('BREAK',  32, 8, [0],    breakMutes,         { filter: [0, 70], reverb: true }),
                sec('BUILD',  40, 8, [1],    ['stab'],           { filter: [-55, 0], delay: true }),
                sec('DROP',   48, 12, [2, 3], [],                 { delay: true }),
                sec('OUTRO',  60, 4, [0],    ['303', 'stab', 'snare', 'clap', 'cowbell'], { filter: [0, -85] })
            ];
            bars = 64;
        } else {
            sections = [
                sec('INTRO',  0,  8, [0],    ALL_BUT(introKeep), { filter: [-75, 0] }),
                sec('BUILD',  8,  8, [1],    buildMutes,         { delay: true }),
                sec('DROP',   16, 8, [2, 3], [],                 { delay: true }),
                sec('BREAK',  24, 4, [0],    breakMutes,         { filter: [0, 65], reverb: true }),
                sec('DROP',   28, 4, [3],    [],                 { delay: true })
            ];
            bars = 32;
        }
        return { bars, chainBars, sections };
    }

    return {
        NOTES, INSTRUMENTS, KIT_CAPABLE, SCALES, STYLES, CHORDS, CHORD_KEYS,
        empty808, emptyLine, emptyStep, emptyStabStep, emptyStabLine,
        setExt, setExtAll, cleanExt, clone808, cloneLine,
        generateBeat, variateBeat,
        generateLine, variateLine, transposeLine, quantizeLine, finishLine,
        chordForDegree, generateStabs, finishStabLine, transposeStabs, stabParams,
        kitFor, synthParams, compose, arrange,
        rnd, rndInt, chance, pick
    };
})();
