/**
 * MusicGen — musical (non-chaotic) pattern generation.
 *
 *   - Beats come from style templates (fixed kick / backbeat skeleton + weighted extras, capped)
 *   - Bass lines are motif based: an 8-step cell repeated with a variation, in one key / scale,
 *     root-heavy like real acid lines, with slides only between adjacent notes
 *   - compose() builds 4 coherent patterns (A1 base, A2 alt, B1 build, B2 fill) for chain playback
 *
 * 808 cells: 0 = off, 1 = on, 2 = accent
 */
const MusicGen = (() => {
    const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const INSTRUMENTS = ['kick', 'snare', 'clap', 'hihat_c', 'hihat_o', 'tom_lo', 'tom_hi', 'cymbal', 'rimshot', 'cowbell'];

    const SCALES = {
        minorPenta: { name: 'MINOR PENTA', iv: [0, 3, 5, 7, 10] },
        aeolian:    { name: 'NAT. MINOR',  iv: [0, 2, 3, 5, 7, 8, 10] },
        dorian:     { name: 'DORIAN',      iv: [0, 2, 3, 5, 7, 9, 10] },
        phrygian:   { name: 'PHRYGIAN',    iv: [0, 1, 3, 5, 7, 8, 10] },
        harmMinor:  { name: 'HARM. MINOR', iv: [0, 2, 3, 5, 7, 8, 11] },
        blues:      { name: 'BLUES',       iv: [0, 3, 5, 6, 7, 10] },
        majorPenta: { name: 'MAJOR PENTA', iv: [0, 2, 4, 7, 9] }
    };

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
            synth: { cutoff: [350, 1400], resonance: [8, 20], envMod: [40, 80], decay: [0.18, 0.45], accent: [50, 85], sawP: 0.7 }
        },
        house: {
            name: 'HOUSE', bpm: [120, 128], swing: [8, 25], density: ['sparse', 'mid'],
            scales: ['dorian', 'minorPenta', 'majorPenta'],
            kicks: [[0, 4, 8, 12]], kickExtra: [[15], [11]], kickExtraP: 0.2,
            clapP: 0.95, snareP: 0.15, hatModes: ['off8', 'off8-16', '16'], openP: 0.85,
            perc: { rimshot: { p: 0.12, max: 3 }, cowbell: { p: 0.1, max: 2 }, tom_lo: { p: 0.05, max: 1 }, tom_hi: { p: 0.08, max: 2 } },
            cymbalP: 0.25,
            synth: { cutoff: [300, 1000], resonance: [5, 14], envMod: [30, 60], decay: [0.2, 0.5], accent: [40, 70], sawP: 0.6 }
        },
        acid: {
            name: 'ACID', bpm: [130, 145], swing: [0, 10], density: ['mid', 'dense'],
            scales: ['minorPenta', 'phrygian', 'blues'],
            kicks: [[0, 4, 8, 12]], kickExtra: [[14], [10, 14]], kickExtraP: 0.35,
            clapP: 0.8, snareP: 0.5, hatModes: ['16', 'off8-16', 'off8'], openP: 0.6,
            perc: { rimshot: { p: 0.15, max: 3 }, cowbell: { p: 0.04, max: 1 }, tom_lo: { p: 0.05, max: 1 }, tom_hi: { p: 0.05, max: 1 } },
            cymbalP: 0.3,
            synth: { cutoff: [450, 1800], resonance: [12, 25], envMod: [55, 95], decay: [0.15, 0.4], accent: [60, 95], sawP: 0.6 }
        },
        electro: {
            name: 'ELECTRO', bpm: [118, 132], swing: [0, 8], density: ['sparse', 'mid'],
            scales: ['minorPenta', 'blues', 'aeolian'],
            kicks: [[0, 6, 10], [0, 7, 10, 14], [0, 6, 8, 11], [0, 3, 6, 10]], kickExtra: [[13], [14]], kickExtraP: 0.3,
            clapP: 0.6, snareP: 0.95, hatModes: ['8', 'off8-16', '16'], openP: 0.4,
            perc: { rimshot: { p: 0.1, max: 2 }, cowbell: { p: 0.18, max: 2 }, tom_lo: { p: 0.1, max: 2 }, tom_hi: { p: 0.12, max: 2 } },
            cymbalP: 0.2,
            synth: { cutoff: [250, 1200], resonance: [6, 16], envMod: [35, 70], decay: [0.15, 0.4], accent: [40, 75], sawP: 0.5 }
        },
        minimal: {
            name: 'MINIMAL', bpm: [124, 132], swing: [0, 15], density: ['sparse'],
            scales: ['minorPenta', 'aeolian', 'dorian'],
            kicks: [[0, 4, 8, 12]], kickExtra: [], kickExtraP: 0,
            clapP: 0.35, snareP: 0.05, hatModes: ['off8', '8'], openP: 0.35,
            perc: { rimshot: { p: 0.18, max: 3 }, cowbell: { p: 0.06, max: 1 }, tom_lo: { p: 0.1, max: 1 }, tom_hi: { p: 0.08, max: 1 } },
            cymbalP: 0.1,
            synth: { cutoff: [200, 800], resonance: [4, 12], envMod: [20, 50], decay: [0.25, 0.6], accent: [30, 60], sawP: 0.5 }
        },
        breaks: {
            name: 'BREAKS', bpm: [92, 104], swing: [10, 30], density: ['mid'],
            scales: ['minorPenta', 'blues', 'dorian'],
            kicks: [[0, 7, 10], [0, 10], [0, 6, 10, 15], [0, 3, 10]], kickExtra: [[14], [8]], kickExtraP: 0.3,
            clapP: 0.3, snareP: 0.98, hatModes: ['8', '16', 'off8-16'], openP: 0.4,
            perc: { rimshot: { p: 0.1, max: 2 }, cowbell: { p: 0.06, max: 1 }, tom_lo: { p: 0.1, max: 2 }, tom_hi: { p: 0.1, max: 2 } },
            cymbalP: 0.3,
            synth: { cutoff: [250, 900], resonance: [5, 14], envMod: [30, 65], decay: [0.2, 0.5], accent: [40, 70], sawP: 0.7 }
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
        return c;
    };
    const cloneLine = l => l.map(s => ({ ...s }));

    function empty808() {
        const p = {};
        INSTRUMENTS.forEach(id => { p[id] = new Array(16).fill(0); });
        return p;
    }

    function emptyStep() {
        return { active: false, note: 'C', octave: 2, accent: false, slide: false };
    }

    function emptyLine() {
        const l = [];
        for (let i = 0; i < 16; i++) l.push(emptyStep());
        return l;
    }

    // ------------------------------------------------------------ beats
    function generateBeat(styleKey) {
        const S = STYLES[styleKey] || STYLES.techno;
        const P = empty808();
        const set = (inst, i, v = 1) => { if (i >= 0 && i < 16) P[inst][i] = Math.max(P[inst][i], v); };

        // Kick skeleton (step 0 always, accented)
        pick(S.kicks).forEach(i => set('kick', i, i === 0 ? 2 : 1));
        if (S.kickExtra.length && chance(S.kickExtraP)) pick(S.kickExtra).forEach(i => set('kick', i, 1));

        // Backbeat
        let hasBackbeat = false;
        if (chance(S.clapP)) { [4, 12].forEach(i => set('clap', i, 1)); hasBackbeat = true; }
        if (chance(S.snareP)) { [4, 12].forEach(i => set('snare', i, 1)); hasBackbeat = true; }
        if (!hasBackbeat && chance(0.6)) { [4, 12].forEach(i => set('rimshot', i, 1)); hasBackbeat = true; }

        // Hats
        const mode = pick(S.hatModes);
        for (let i = 0; i < 16; i++) {
            const even = i % 2 === 0;
            switch (mode) {
                case 'off8':    if (i % 4 === 2) set('hihat_c', i, 1); break;
                case '8':       if (even) set('hihat_c', i, i % 4 === 0 ? 2 : 1); break;
                case '16':      set('hihat_c', i, i % 4 === 2 ? 2 : 1); break;
                case 'off8-16': if (even) set('hihat_c', i, i % 4 === 2 ? 2 : 1); else if (chance(0.4)) set('hihat_c', i, 1); break;
            }
        }
        // Open hats on offbeats, choke the closed hat there
        let openCount = 0;
        [2, 6, 10, 14].forEach(i => {
            if (openCount < 4 && chance(S.openP)) {
                set('hihat_o', i, 1);
                P.hihat_c[i] = 0;
                openCount++;
            }
        });
        if (mode === 'off8' && openCount === 4) {
            // all offbeats open: keep the pattern from becoming nothing but open hats
            [6, 14].forEach(i => { P.hihat_o[i] = 0; P.hihat_c[i] = 1; });
        }

        // Percussion extras (capped)
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
        return P;
    }

    function variateBeat(base, kind) {
        const P = clone808(base);
        const odd = [1, 3, 5, 7, 9, 11, 13, 15];
        const toggle = (inst, i) => { P[inst][i] = P[inst][i] ? 0 : 1; };

        if (kind === 'alt') {
            const n = rndInt(1, 2);
            for (let k = 0; k < n; k++) toggle('hihat_c', pick(odd));
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
                    break;
                case 'tomRun':
                    P.tom_hi[12] = 1; P.tom_hi[13] = 1; P.tom_lo[14] = 1; P.tom_lo[15] = 2;
                    break;
                case 'clapStack':
                    P.clap[12] = 1; P.clap[14] = 1; P.clap[15] = 2; P.snare[13] = 1; P.snare[15] = 1;
                    break;
                case 'hatRoll':
                    for (let i = 12; i < 16; i++) { P.hihat_c[i] = i === 12 ? 2 : 1; P.hihat_o[i] = 0; }
                    P.hihat_o[15] = 1; P.hihat_c[15] = 0;
                    break;
                case 'dropout':
                    INSTRUMENTS.forEach(inst => { for (let i = 13; i < 16; i++) P[inst][i] = 0; });
                    P.kick[12] = 2;
                    break;
            }
            P.cymbal = new Array(16).fill(0);
        }
        return P;
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

        // 8-step motif cell
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

        // Second half = motif with a variation + optional turnaround
        const half2 = cloneLine(cell);
        const activeIdx = half2.map((s, i) => s.active ? i : -1).filter(i => i >= 0);
        for (let k = 0; k < rndInt(1, 2) && activeIdx.length; k++) {
            const i = pick(activeIdx);
            const p = pitchFor(root, pickDegree(iv, true), baseOct + (chance(0.2) ? 1 : 0));
            half2[i].note = p.note;
            half2[i].octave = Math.min(3, p.octave);
        }
        if (chance(0.55)) {
            // turnaround on the last two steps leading back to the top (scale tones only)
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
            if (chance(0.5)) half2[7].slide = true; // tie into bar 1 of the loop
        }

        const line = [...cell, ...half2];

        // Make sure there is enough material
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
        line.forEach(s => { if (!s.active) { s.accent = false; s.slide = false; } });
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
            // guarantee an audible difference: re-pitch one note (not the downbeat)
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

    /** Snap any line to a key / scale (used by Euclidean + mutate helpers). */
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

    // ------------------------------------------------------------ compose
    function synthParams(styleKey) {
        const S = (STYLES[styleKey] || STYLES.techno).synth;
        return {
            cutoff: Math.round(rnd(...S.cutoff)),
            resonance: Math.round(rnd(...S.resonance)),
            envMod: Math.round(rnd(...S.envMod)),
            decay: Math.round(rnd(...S.decay) * 100) / 100,
            accent: Math.round(rnd(...S.accent)),
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
            L3 = finishLine(transposeLine(L1, pick([5, 7, -5, 3])), density);
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
            synth: synthParams(styleKey),
            delay: { on: chance(0.6), time: pick([3, 6, 2, 3]), feedback: rndInt(28, 48), mix: rndInt(14, 28) }
        };
    }

    return {
        NOTES, INSTRUMENTS, SCALES, STYLES,
        empty808, emptyLine, emptyStep,
        generateBeat, variateBeat,
        generateLine, variateLine, transposeLine, quantizeLine, finishLine,
        synthParams, compose,
        rnd, rndInt, chance, pick
    };
})();
