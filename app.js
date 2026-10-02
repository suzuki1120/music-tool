/**
 * app.js — UI wiring, draw loop, persistence, file / MIDI / recording glue.
 */
document.addEventListener('DOMContentLoaded', () => {
    const sampler = new Sampler(audioEngine);
    const tr808 = new TR808(audioEngine, sampler);
    const tb303 = new TB303(audioEngine);
    const stab = new StabSynth(audioEngine);
    const chaosFx = new ChaosFX(audioEngine);
    const sequencer = new Sequencer(audioEngine, tr808, tb303, stab);
    const midi = new MidiIO(audioEngine, sequencer);
    const recorder = new Recorder(audioEngine);

    audioEngine.onInit = () => {
        chaosFx.init();
        tr808.init();
        tb303.init();
        stab.init();
        chaosFx.updateDelay(sequencer.bpm);
        recorder.attach();
        sampler.restore().then(n => { if (n) { refreshSamplerUI(); refreshDrumLabels(); } }).catch(() => { /* ignore */ });
    };

    const NOTES = MusicGen.NOTES;
    const PATTERN_NAMES = ['A1', 'A2', 'B1', 'B2'];
    const STORAGE_KEY = 'synthseq.v4';
    const LEGACY_KEY = 'synthseq.v3';
    const $ = id => document.getElementById(id);

    const CHANNEL_IDS = [...tr808.instruments.map(i => i.id), '303', 'stab'];
    const CHANNEL_NAMES = {};
    tr808.instruments.forEach(i => { CHANNEL_NAMES[i.id] = i.name; });
    CHANNEL_NAMES['303'] = '303';
    CHANNEL_NAMES.stab = 'STAB';
    audioEngine.mixState('303').level = 0.8;
    audioEngine.mixState('stab').level = 0.6;

    const FX_KNOBS = ['stutterRate', 'stutterDecay', 'driveAmount', 'driveTone', 'driveMix', 'bitDepth', 'sampleRateReduce', 'crushMix',
        'delayTime', 'delayFeedback', 'delayFilter', 'delayMix', 'reverbDecay', 'reverbMix', 'gateDepth', 'gateSmooth',
        'phaserRate', 'phaserDepth', 'phaserMix', 'ringModFreq', 'ringModMix', 'foldAmount', 'foldMix', 'autoPanRate', 'autoPanDepth',
        'euclideanHits', 'euclideanRotate', 'mutateAmount', 'probability', 'polySteps', 'timeStretch'];
    const FX_TOGGLES = ['driveToggle', 'bitCrushToggle', 'delayToggle', 'reverbToggle', 'gateToggle', 'phaserToggle', 'ringModToggle',
        'waveFolderToggle', 'autoPanToggle', 'polyToggle'];
    const fxToggleFns = {};

    const state = {
        mode: 'instruments',
        editMode: 'trig',
        selectedNote: 'A',
        selectedOctave: 1,
        selectedStep303: null,
        selectedStepStab: null,
        plock: false,
        root: 9,
        scale: 'minorPenta',
        randomKey: false,
        randomScale: false,
        style: 'techno',
        locks: { d808: false, d303: false, stab: false, synth: false },
        clip808: null,
        clip303: null,
        clipStab: null,
        dirty: false,
        paint: null,
        userFilter: 0,
        scopeMode: 'scope',
        recLength: 'chain',
        songBars: 32,
        midiLearn: false,
        sampleTarget: 0,
        rowCur: {},
        last: { s: -1, s3: -1, st: -1 },
        taps: [],
        recBars: null,
        recBarCount: 0,
        songFxBackup: null
    };

    const dom = { padRows: {}, rowCtl: {}, bassCols: [], stabCols: [], dots808: [], dots303: [], dotsStab: [], lcdSteps: [] };
    const drawQueue = [];
    const patQueue = [];
    const hist = { undo: [], redo: [], lock: false };

    // instrument unit prefs (fold / order), kept apart from the musical state
    const UI_KEY = 'synthseq.ui';
    const UNIT_DEFAULT_ORDER = ['section808', 'section303', 'sectionStab', 'sectionSampler'];
    const UNIT_GROUPS = {
        section808: () => tr808.instruments.filter(i => i.group !== 'smp').map(i => i.id),
        sectionSampler: () => tr808.instruments.filter(i => i.group === 'smp').map(i => i.id),
        section303: () => ['303'],
        sectionStab: () => ['stab']
    };
    const UNIT_LABELS = { section808: '808', sectionSampler: 'SAMPLER', section303: '303', sectionStab: 'STAB' };

    // ============================================================ init
    buildSelects();
    buildGatePresets();
    buildStepIndicators();
    buildDrumGrid();
    buildDrumMixer();
    buildBassGrid();
    buildStabGrid();
    buildNoteSelect();
    buildPatternButtons();
    buildSamplerSlots();
    buildMixerStrips();
    decorateUnits();
    buildGateSteps();
    Knobs.enhanceAll(document);
    bindTransport();
    bindComposer();
    bindInstruments();
    bindStab();
    bindMixer();
    bindChaosFX();
    bindSystem();
    bindKeyboard();
    bindDragDrop();
    loadState();
    bindPersistence();
    initMidi();
    requestAnimationFrame(frame);
    checkHashImport();

    // debugging / power-user handle
    window.SynthSeq = { engine: audioEngine, sequencer, tr808, tb303, stab, sampler, chaosFx, midi, recorder, MusicGen };

    const unlock = () => {
        audioEngine.init();
        audioEngine.resume();
        document.removeEventListener('pointerdown', unlock);
        document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);

    // ============================================================ builders
    function buildSelects() {
        const styleSel = $('styleSelect');
        Object.keys(MusicGen.STYLES).forEach(k => {
            const o = document.createElement('option');
            o.value = k;
            o.textContent = MusicGen.STYLES[k].name;
            styleSel.appendChild(o);
        });
        const keySel = $('keySelect');
        const rndKey = document.createElement('option');
        rndKey.value = 'random';
        rndKey.textContent = 'RND';
        rndKey.title = 'COMPOSE のたびにキーをランダムに選ぶ';
        keySel.appendChild(rndKey);
        NOTES.forEach((n, i) => {
            const o = document.createElement('option');
            o.value = i;
            o.textContent = n;
            keySel.appendChild(o);
        });
        const scaleSel = $('scaleSelect');
        const rndScale = document.createElement('option');
        rndScale.value = 'random';
        rndScale.textContent = 'RND';
        rndScale.title = 'COMPOSE のたびにスタイルに合うスケールをランダムに選ぶ';
        scaleSel.appendChild(rndScale);
        Object.keys(MusicGen.SCALES).forEach(k => {
            const o = document.createElement('option');
            o.value = k;
            o.textContent = MusicGen.SCALES[k].name;
            scaleSel.appendChild(o);
        });
    }

    function buildGatePresets() {
        const sel = $('gatePreset');
        Object.keys(ChaosFX.GATE_PRESETS).forEach(k => {
            const o = document.createElement('option');
            o.value = k;
            o.textContent = k;
            sel.appendChild(o);
        });
        sel.value = 'TRANCE';
    }

    function buildStepIndicators() {
        const lcd = $('lcdSteps');
        [['stepIndicator808', dom.dots808], ['stepIndicator303', dom.dots303], ['stepIndicatorStab', dom.dotsStab]].forEach(([id, store]) => {
            const el = $(id);
            el.innerHTML = '';
            store.length = 0;
            for (let i = 0; i < 16; i++) {
                const dot = document.createElement('div');
                dot.className = 'step-dot' + (i % 4 === 0 ? ' beat' : '');
                el.appendChild(dot);
                store.push(dot);
            }
        });
        lcd.innerHTML = '';
        dom.lcdSteps.length = 0;
        for (let i = 0; i < 16; i++) {
            const s = document.createElement('span');
            if (i % 4 === 0) s.classList.add('beat');
            lcd.appendChild(s);
            dom.lcdSteps.push(s);
        }
    }

    function buildPatternButtons() {
        ['patBtns808', 'patBtns303', 'patBtnsStab'].forEach(id => {
            const box = $(id);
            box.innerHTML = '';
            PATTERN_NAMES.forEach((name, i) => {
                const b = document.createElement('button');
                b.className = 'pat-btn' + (i === sequencer.currentPattern808 ? ' active' : '');
                b.dataset.pat = i;
                b.innerHTML = '<span class="led"></span>' + name;
                b.title = 'パターン ' + name + ' を選択';
                b.addEventListener('click', () => selectPattern(i));
                box.appendChild(b);
            });
        });
    }

    // ------------------------------------------------------------ drum grid
    function buildDrumGrid() {
        const grid = $('drumGrid');
        grid.innerHTML = '';
        dom.padRows = {};
        dom.rowCtl = {};
        state.rowCur = {};

        tr808.instruments.forEach(inst => {
            const row = document.createElement('div');
            row.className = 'drum-row' + (inst.group === 'smp' ? ' smp-row' : '');

            const label = document.createElement('div');
            label.className = 'drum-label';
            const name = document.createElement('div');
            name.className = 'drum-name';
            name.innerHTML = inst.name + '<b class="len-tag"></b><small>' + inst.longName + '</small>';
            name.title = inst.longName + ' — クリックで試聴';
            name.addEventListener('click', () => previewDrum(inst.id, false));
            label.appendChild(name);

            const ctl = document.createElement('div');
            ctl.className = 'row-ctl';
            const isSmp = inst.group === 'smp';
            ctl.innerHTML =
                '<button class="rc rc-m" data-act="mute" title="MUTE">M</button>' +
                '<button class="rc rc-s" data-act="solo" title="SOLO">S</button>' +
                (isSmp
                    ? '<button class="rc rc-kit rc-load" data-act="load" title="サンプルを読み込む">LOAD</button>'
                    : (tr808.KIT_CAPABLE.includes(inst.id)
                        ? '<button class="rc rc-kit" data-act="kit" title="808 / 909 切替">808</button>'
                        : '<span class="rc rc-kit rc-none">808</span>'));
            ctl.addEventListener('click', e => {
                const btn = e.target.closest('.rc');
                if (!btn || !btn.dataset.act) return;
                const act = btn.dataset.act;
                if (act === 'mute') { audioEngine.setMute(inst.id, !audioEngine.mixState(inst.id).mute); markDirty(); }
                if (act === 'solo') { audioEngine.setSolo(inst.id, !audioEngine.mixState(inst.id).solo); markDirty(); }
                if (act === 'kit') { const k = tr808.toggleKit(inst.id); refreshDrumLabels(); flash(inst.longName + ' → TR-' + k); markDirty(); previewDrum(inst.id, false); }
                if (act === 'load') { state.sampleTarget = tr808.sampleIndex(inst.id); $('sampleFile').click(); }
            });
            label.appendChild(ctl);
            dom.rowCtl[inst.id] = ctl;
            row.appendChild(label);

            const pads = [];
            for (let step = 0; step < 16; step++) {
                const pad = document.createElement('button');
                pad.className = 'pad';
                pad.dataset.instrument = inst.id;
                pad.dataset.step = step;
                pad.dataset.group = Math.floor(step / 4);
                pad.setAttribute('aria-label', inst.longName + ' step ' + (step + 1));
                pad.innerHTML = '<i class="pad-badge"></i>';
                pad.addEventListener('contextmenu', e => e.preventDefault());
                row.appendChild(pad);
                pads.push(pad);
            }
            dom.padRows[inst.id] = pads;
            grid.appendChild(row);
            refreshPadRow(inst.id);
        });
        refreshDrumLabels();
    }

    function applyPadClass(pad, v) {
        pad.classList.toggle('on', v > 0);
        pad.classList.toggle('accent', v === 2);
    }

    function applyPadExt(pad, inst, step) {
        const e = sequencer.getExt(inst, step);
        const len = sequencer.getLen(inst);
        const badge = pad.firstChild;
        let text = '';
        if (state.editMode === 'prob') text = e.p < 100 ? String(e.p) : '';
        else if (state.editMode === 'ratchet') text = e.r > 1 ? '×' + e.r : '';
        else if (state.editMode === 'len') text = step === len - 1 ? String(len) : '';
        else text = e.r > 1 ? '×' + e.r : (e.p < 100 ? String(e.p) : '');
        if (badge.textContent !== text) badge.textContent = text;
        pad.classList.toggle('has-prob', e.p < 100);
        pad.classList.toggle('has-ratchet', e.r > 1);
        pad.classList.toggle('beyond', step >= len);
        pad.classList.toggle('len-end', len < 16 && step === len - 1);
    }

    function refreshPadRow(inst) {
        const pads = dom.padRows[inst];
        if (!pads) return;
        const row = sequencer.pattern808[inst];
        pads.forEach((pad, step) => {
            applyPadClass(pad, row[step]);
            applyPadExt(pad, inst, step);
        });
        const tag = dom.rowCtl[inst] && dom.rowCtl[inst].parentElement.querySelector('.len-tag');
        if (tag) { const len = sequencer.getLen(inst); tag.textContent = len < 16 ? '/' + len : ''; }
    }

    function refreshAllPads() {
        tr808.instruments.forEach(inst => refreshPadRow(inst.id));
    }

    function refreshDrumLabels() {
        tr808.instruments.forEach(inst => {
            const ctl = dom.rowCtl[inst.id];
            if (!ctl) return;
            const m = audioEngine.mixState(inst.id);
            ctl.querySelector('.rc-m').classList.toggle('on', m.mute);
            ctl.querySelector('.rc-s').classList.toggle('on', m.solo);
            ctl.parentElement.classList.toggle('auto-muted', m.autoMute);
            const kit = ctl.querySelector('.rc-kit');
            if (inst.group === 'smp') {
                const idx = tr808.sampleIndex(inst.id);
                kit.classList.toggle('loaded', sampler.hasSample(idx));
                kit.title = sampler.hasSample(idx) ? sampler.pads[idx].name : 'サンプルを読み込む';
            } else if (kit && kit.dataset.act === 'kit') {
                const k = tr808.kit[inst.id];
                kit.textContent = k;
                kit.classList.toggle('kit-909', k === '909');
            }
        });
        $('kitAll808').classList.toggle('active', tr808.KIT_CAPABLE.every(id => tr808.kit[id] === '808'));
        $('kitAll909').classList.toggle('active', tr808.KIT_CAPABLE.every(id => tr808.kit[id] === '909'));
    }

    function buildDrumMixer() {
        const mixer = $('drumMixer');
        mixer.innerHTML = '';
        tr808.instruments.forEach(inst => {
            const wrap = document.createElement('div');
            wrap.className = 'knob-wrapper';
            const input = document.createElement('input');
            input.type = 'range';
            input.min = '0';
            input.max = '100';
            input.value = String(Math.round(audioEngine.mixState(inst.id).level * 100));
            input.dataset.knob = '';
            input.dataset.size = 's';
            input.dataset.format = 'pct';
            input.dataset.default = String(Math.round(inst.defaultVol * 100));
            input.id = 'vol_' + inst.id;
            input.addEventListener('input', () => { audioEngine.setLevel(inst.id, input.value / 100); markDirty(); });
            const label = document.createElement('label');
            label.textContent = inst.name;
            label.title = inst.longName + ' LEVEL';
            wrap.appendChild(input);
            wrap.appendChild(label);
            mixer.appendChild(wrap);
        });
    }

    // ------------------------------------------------------------ 303 grid
    function buildBassGrid() {
        const grid = $('bassGrid');
        grid.innerHTML = '';
        dom.bassCols = Array.from({ length: 16 }, () => []);

        const makeRow = (labelText, type) => {
            const row = document.createElement('div');
            row.className = 'bass-row';
            const label = document.createElement('div');
            label.className = 'bass-row-label';
            label.textContent = labelText;
            row.appendChild(label);
            for (let step = 0; step < 16; step++) {
                const btn = document.createElement('button');
                btn.className = 'bass-step' + (type === 'note' ? ' note-step' : '');
                btn.dataset.step = step;
                btn.dataset.type = type;
                btn.addEventListener('contextmenu', e => e.preventDefault());
                row.appendChild(btn);
                dom.bassCols[step].push(btn);
            }
            grid.appendChild(row);
            return row;
        };

        const noteRow = makeRow('NOTE', 'note');
        const accentRow = makeRow('ACCENT', 'accent');
        const slideRow = makeRow('SLIDE →', 'slide');
        const probRow = makeRow('PROB', 'prob');
        const ratchRow = makeRow('RATCH', 'ratchet');

        noteRow.querySelectorAll('.bass-step').forEach(btn => {
            const step = parseInt(btn.dataset.step);
            btn.addEventListener('click', () => handleBassStepClick(step));
            btn.addEventListener('contextmenu', () => {
                const s = sequencer.pattern303[step];
                if (s.active) { commit(); s.accent = !s.accent; updateBassGridDisplay(); markDirty(); }
            });
            btn.addEventListener('wheel', e => {
                const s = sequencer.pattern303[step];
                if (!s.active) return;
                e.preventDefault();
                commit('wheel303');
                transposeStep(s, e.deltaY < 0 ? 1 : -1, 1, 3);
                updateBassGridDisplay();
                previewBass(s);
                markDirty();
            }, { passive: false });
        });
        accentRow.querySelectorAll('.bass-step').forEach(btn => {
            const step = parseInt(btn.dataset.step);
            btn.addEventListener('click', () => {
                const s = sequencer.pattern303[step];
                commit();
                s.accent = !s.accent;
                updateBassGridDisplay();
                markDirty();
            });
        });
        slideRow.querySelectorAll('.bass-step').forEach(btn => {
            const step = parseInt(btn.dataset.step);
            btn.addEventListener('click', () => {
                const s = sequencer.pattern303[step];
                commit();
                s.slide = !s.slide;
                updateBassGridDisplay();
                markDirty();
            });
        });
        const cycleProb = p => (p <= 25 ? 100 : p <= 50 ? 25 : p <= 75 ? 50 : 75);
        probRow.querySelectorAll('.bass-step').forEach(btn => {
            const step = parseInt(btn.dataset.step);
            btn.addEventListener('click', () => {
                const s = sequencer.pattern303[step];
                if (!s.active) return;
                commit();
                s.prob = cycleProb(s.prob);
                updateBassGridDisplay();
                markDirty();
            });
            btn.addEventListener('wheel', e => {
                const s = sequencer.pattern303[step];
                if (!s.active) return;
                e.preventDefault();
                commit('wheelProb');
                s.prob = Math.max(5, Math.min(100, s.prob + (e.deltaY < 0 ? 5 : -5)));
                updateBassGridDisplay();
                markDirty();
            }, { passive: false });
        });
        ratchRow.querySelectorAll('.bass-step').forEach(btn => {
            const step = parseInt(btn.dataset.step);
            btn.addEventListener('click', () => {
                const s = sequencer.pattern303[step];
                if (!s.active) return;
                commit();
                s.ratchet = (s.ratchet % 4) + 1;
                updateBassGridDisplay();
                markDirty();
            });
            btn.addEventListener('wheel', e => {
                const s = sequencer.pattern303[step];
                if (!s.active) return;
                e.preventDefault();
                commit('wheelRatch');
                s.ratchet = Math.max(1, Math.min(4, s.ratchet + (e.deltaY < 0 ? 1 : -1)));
                updateBassGridDisplay();
                markDirty();
            }, { passive: false });
        });

        updateBassGridDisplay();
    }

    function updateBassGridDisplay() {
        const pattern = sequencer.pattern303;
        const limit = sequencer.steps303;
        for (let step = 0; step < 16; step++) {
            const s = pattern[step];
            const [noteBtn, accBtn, slideBtn, probBtn, ratchBtn] = dom.bassCols[step];
            noteBtn.className = 'bass-step note-step';
            noteBtn.textContent = '';
            if (s.active) {
                noteBtn.classList.add('on');
                noteBtn.textContent = s.note + s.octave;
                if (s.accent) noteBtn.classList.add('accent');
                if (s.slide) noteBtn.classList.add('slide');
                if (s.lock) noteBtn.classList.add('locked');
            }
            if (state.selectedStep303 === step) noteBtn.classList.add('selected');
            accBtn.className = 'bass-step' + (s.accent ? ' on' : '') + (!s.active ? ' empty-mod' : '');
            slideBtn.className = 'bass-step' + (s.slide ? ' on' : '') + (!s.active ? ' empty-mod' : '');
            probBtn.className = 'bass-step' + (s.active && s.prob < 100 ? ' on' : '') + (!s.active ? ' empty-mod' : '');
            probBtn.textContent = s.active && s.prob < 100 ? String(s.prob) : '';
            ratchBtn.className = 'bass-step' + (s.active && s.ratchet > 1 ? ' on' : '') + (!s.active ? ' empty-mod' : '');
            ratchBtn.textContent = s.active && s.ratchet > 1 ? '×' + s.ratchet : '';
            if (step >= limit) dom.bassCols[step].forEach(b => b.classList.add('beyond'));
        }
        if (state.last.s3 >= 0 && state.last.s3 < 16) dom.bassCols[state.last.s3].forEach(b => b.classList.add('current'));
    }

    // ------------------------------------------------------------ stab grid
    function buildStabGrid() {
        const grid = $('stabGrid');
        grid.innerHTML = '';
        dom.stabCols = Array.from({ length: 16 }, () => []);

        const makeRow = (labelText, type) => {
            const row = document.createElement('div');
            row.className = 'bass-row';
            const label = document.createElement('div');
            label.className = 'bass-row-label';
            label.textContent = labelText;
            row.appendChild(label);
            for (let step = 0; step < 16; step++) {
                const btn = document.createElement('button');
                btn.className = 'bass-step' + (type === 'chord' ? ' note-step' : '');
                btn.dataset.step = step;
                btn.dataset.type = type;
                btn.addEventListener('contextmenu', e => e.preventDefault());
                row.appendChild(btn);
                dom.stabCols[step].push(btn);
            }
            grid.appendChild(row);
            return row;
        };

        const chordRow = makeRow('CHORD', 'chord');
        const typeRow = makeRow('TYPE', 'type');
        const accentRow = makeRow('ACCENT', 'accent');

        chordRow.querySelectorAll('.bass-step').forEach(btn => {
            const step = parseInt(btn.dataset.step);
            btn.addEventListener('click', () => handleStabStepClick(step));
            btn.addEventListener('contextmenu', () => {
                const s = sequencer.patternStab[step];
                if (s.active) { commit(); s.accent = !s.accent; updateStabGridDisplay(); markDirty(); }
            });
            btn.addEventListener('wheel', e => {
                const s = sequencer.patternStab[step];
                if (!s.active) return;
                e.preventDefault();
                commit('wheelStab');
                transposeStep(s, e.deltaY < 0 ? 1 : -1, 2, 5);
                updateStabGridDisplay();
                previewStab(s);
                markDirty();
            }, { passive: false });
        });
        typeRow.querySelectorAll('.bass-step').forEach(btn => {
            const step = parseInt(btn.dataset.step);
            btn.addEventListener('click', () => {
                const s = sequencer.patternStab[step];
                if (!s.active) return;
                commit();
                const keys = MusicGen.CHORD_KEYS;
                s.chord = keys[(keys.indexOf(s.chord) + 1) % keys.length];
                updateStabGridDisplay();
                previewStab(s);
                markDirty();
            });
        });
        accentRow.querySelectorAll('.bass-step').forEach(btn => {
            const step = parseInt(btn.dataset.step);
            btn.addEventListener('click', () => {
                const s = sequencer.patternStab[step];
                if (!s.active) return;
                commit();
                s.accent = !s.accent;
                updateStabGridDisplay();
                markDirty();
            });
        });
        updateStabGridDisplay();
    }

    function updateStabGridDisplay() {
        const line = sequencer.patternStab;
        for (let step = 0; step < 16; step++) {
            const s = line[step];
            const [chordBtn, typeBtn, accBtn] = dom.stabCols[step];
            chordBtn.className = 'bass-step note-step';
            chordBtn.textContent = '';
            if (s.active) {
                chordBtn.classList.add('on');
                chordBtn.textContent = s.note + MusicGen.CHORDS[s.chord].name;
                if (s.accent) chordBtn.classList.add('accent');
            }
            if (state.selectedStepStab === step) chordBtn.classList.add('selected');
            typeBtn.className = 'bass-step' + (s.active ? ' on' : ' empty-mod');
            typeBtn.textContent = s.active ? MusicGen.CHORDS[s.chord].name : '';
            accBtn.className = 'bass-step' + (s.accent ? ' on' : '') + (!s.active ? ' empty-mod' : '');
        }
        if (state.last.st >= 0) dom.stabCols[state.last.st].forEach(b => b.classList.add('current'));
    }

    function buildNoteSelect() {
        const container = $('noteSelect');
        container.innerHTML = '';
        NOTES.forEach(note => {
            const btn = document.createElement('button');
            btn.className = 'note-btn' + (note === state.selectedNote ? ' active' : '') + (note.includes('#') ? ' is-black' : '');
            btn.textContent = note;
            btn.title = note;
            btn.addEventListener('click', () => {
                state.selectedNote = note;
                container.querySelectorAll('.note-btn').forEach(b => b.classList.toggle('active', b.textContent === note));
                if (state.selectedStep303 !== null) {
                    commit();
                    const s = sequencer.pattern303[state.selectedStep303];
                    s.note = note;
                    s.octave = state.selectedOctave;
                    updateBassGridDisplay();
                    previewBass(s);
                    markDirty();
                } else if (state.selectedStepStab !== null) {
                    commit();
                    const s = sequencer.patternStab[state.selectedStepStab];
                    s.note = note;
                    updateStabGridDisplay();
                    previewStab(s);
                    markDirty();
                } else {
                    previewBass({ note, octave: state.selectedOctave, accent: false });
                }
            });
            container.appendChild(btn);
        });
    }

    function setOctaveUI(oct) {
        state.selectedOctave = oct;
        document.querySelectorAll('.oct-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.oct) === oct));
    }

    function setNoteUI(note) {
        state.selectedNote = note;
        $('noteSelect').querySelectorAll('.note-btn').forEach(b => b.classList.toggle('active', b.textContent === note));
    }

    // ------------------------------------------------------------ sampler slots
    function buildSamplerSlots() {
        const box = $('samplerSlots');
        box.innerHTML = '';
        for (let i = 0; i < 4; i++) {
            const slot = document.createElement('div');
            slot.className = 'smp-slot';
            slot.dataset.idx = i;
            slot.innerHTML =
                '<button class="smp-pad" title="クリックで試聴 / ファイルをドロップ">S' + (i + 1) + '<small class="smp-name">EMPTY</small></button>' +
                '<div class="smp-tools">' +
                    '<button class="hw-btn hw-xs smp-load" title="ファイルを選択">LOAD</button>' +
                    '<button class="hw-btn hw-xs sw smp-rev" title="逆再生">REV</button>' +
                    '<button class="hw-btn hw-xs sw smp-choke" title="同じパッドの前の発音を止める">CHOKE</button>' +
                    '<button class="hw-btn hw-xs btn-clear smp-clear" title="サンプルを外す">×</button>' +
                '</div>' +
                '<div class="smp-knobs">' +
                    '<div class="knob-wrapper"><input type="range" id="smp_pitch_' + i + '" data-knob data-bipolar data-size="s" data-format="semi" min="-24" max="24" value="0" data-default="0"><label>PITCH</label></div>' +
                    '<div class="knob-wrapper"><input type="range" id="smp_decay_' + i + '" data-knob data-size="s" data-format="sec" min="0" max="2" step="0.01" value="0" data-default="0"><label>GATE</label></div>' +
                    '<div class="knob-wrapper"><input type="range" id="smp_start_' + i + '" data-knob data-size="s" data-format="pct" min="0" max="95" value="0" data-default="0"><label>START</label></div>' +
                '</div>';
            slot.querySelector('.smp-pad').addEventListener('click', () => previewDrum('s' + (i + 1), false));
            slot.querySelector('.smp-load').addEventListener('click', () => { state.sampleTarget = i; $('sampleFile').click(); });
            slot.querySelector('.smp-rev').addEventListener('click', () => { sampler.setReverse(i, !sampler.pads[i].reverse); refreshSamplerUI(); markDirty(); previewDrum('s' + (i + 1), false); });
            slot.querySelector('.smp-choke').addEventListener('click', () => { sampler.pads[i].choke = !sampler.pads[i].choke; refreshSamplerUI(); markDirty(); });
            slot.querySelector('.smp-clear').addEventListener('click', () => { sampler.clear(i); refreshSamplerUI(); refreshDrumLabels(); markDirty(); flash('S' + (i + 1) + ' CLEARED'); });
            slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('drag-over'); });
            slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
            slot.addEventListener('drop', e => {
                e.preventDefault();
                e.stopPropagation();
                slot.classList.remove('drag-over');
                const file = e.dataTransfer.files && e.dataTransfer.files[0];
                if (file) loadSampleFile(i, file);
            });
            box.appendChild(slot);
        }
        Knobs.enhanceAll(box);
        for (let i = 0; i < 4; i++) {
            $('smp_pitch_' + i).addEventListener('input', e => { sampler.setPitch(i, parseFloat(e.target.value)); markDirty(); });
            $('smp_decay_' + i).addEventListener('input', e => { sampler.setDecay(i, parseFloat(e.target.value)); markDirty(); });
            $('smp_start_' + i).addEventListener('input', e => { sampler.setStart(i, parseFloat(e.target.value) / 100); markDirty(); });
        }
        $('sampleFile').addEventListener('change', e => {
            const file = e.target.files && e.target.files[0];
            if (file) loadSampleFile(state.sampleTarget, file);
            e.target.value = '';
        });
        sampler.onChange = () => { refreshSamplerUI(); refreshDrumLabels(); };
    }

    function loadSampleFile(i, file) {
        audioEngine.init();
        audioEngine.resume();
        flash('LOADING ' + file.name.toUpperCase());
        sampler.load(i, file).then(pad => {
            flash('S' + (i + 1) + ' ← ' + pad.name.toUpperCase() + ' (' + pad.buffer.duration.toFixed(2) + 's)');
            refreshSamplerUI();
            refreshDrumLabels();
            markDirty();
            previewDrum('s' + (i + 1), false);
        }).catch(err => flash('LOAD FAILED: ' + (err && err.message ? err.message.toUpperCase() : 'UNSUPPORTED FILE')));
    }

    function refreshSamplerUI() {
        document.querySelectorAll('.smp-slot').forEach(slot => {
            const i = parseInt(slot.dataset.idx);
            const pad = sampler.pads[i];
            slot.classList.toggle('loaded', !!pad.buffer);
            slot.querySelector('.smp-name').textContent = pad.buffer ? (pad.name.length > 18 ? pad.name.slice(0, 17) + '…' : pad.name) : 'EMPTY';
            slot.querySelector('.smp-rev').classList.toggle('active', pad.reverse);
            slot.querySelector('.smp-choke').classList.toggle('active', pad.choke);
            Knobs.set('smp_pitch_' + i, pad.pitch);
            Knobs.set('smp_decay_' + i, pad.decay);
            Knobs.set('smp_start_' + i, Math.round(pad.start * 100));
        });
    }

    // ------------------------------------------------------------ mixer strips
    function buildMixerStrips() {
        const box = $('mixerStrips');
        box.innerHTML = '';
        CHANNEL_IDS.forEach(id => {
            const strip = document.createElement('div');
            strip.className = 'mx-strip' + (id === '303' ? ' mx-303' : id === 'stab' ? ' mx-stab' : (id[0] === 's' && id.length === 2 ? ' mx-smp' : ''));
            strip.dataset.ch = id;
            const inst = tr808.instruments.find(i => i.id === id);
            const long = inst ? inst.longName : (id === '303' ? 'TB-303 BASS' : 'CHORD STAB');
            strip.innerHTML =
                '<div class="mx-name" title="' + long + '">' + CHANNEL_NAMES[id] + '</div>' +
                '<div class="knob-wrapper"><input type="range" id="mx_lvl_' + id + '" data-knob data-format="pct" min="0" max="100" value="80"><label>LEVEL</label></div>' +
                '<div class="knob-wrapper"><input type="range" id="mx_pan_' + id + '" data-knob data-bipolar data-size="s" data-format="pan" min="-100" max="100" value="0" data-default="0"><label>PAN</label></div>' +
                '<div class="mx-sends">' +
                    '<div class="knob-wrapper"><input type="range" id="mx_dly_' + id + '" data-knob data-size="s" data-format="pct" min="0" max="100" value="100" data-default="100"><label>DLY</label></div>' +
                    '<div class="knob-wrapper"><input type="range" id="mx_rev_' + id + '" data-knob data-size="s" data-format="pct" min="0" max="100" value="100" data-default="100"><label>REV</label></div>' +
                '</div>' +
                '<div class="mx-btns"><button class="rc rc-m" data-act="mute" title="MUTE">M</button><button class="rc rc-s" data-act="solo" title="SOLO">S</button></div>';
            strip.querySelector('.mx-btns').addEventListener('click', e => {
                const btn = e.target.closest('.rc');
                if (!btn) return;
                if (btn.dataset.act === 'mute') audioEngine.setMute(id, !audioEngine.mixState(id).mute);
                if (btn.dataset.act === 'solo') audioEngine.setSolo(id, !audioEngine.mixState(id).solo);
                markDirty();
            });
            strip.querySelector('.mx-name').addEventListener('click', () => {
                if (id === '303') previewBass({ note: state.selectedNote, octave: state.selectedOctave, accent: false });
                else if (id === 'stab') previewStab({ note: state.selectedNote, octave: stab.octave, chord: 'min', accent: false });
                else previewDrum(id, false);
            });
            box.appendChild(strip);
        });
        Knobs.enhanceAll(box);
        CHANNEL_IDS.forEach(id => {
            $('mx_lvl_' + id).addEventListener('input', e => { audioEngine.setLevel(id, parseFloat(e.target.value) / 100); markDirty(); });
            $('mx_pan_' + id).addEventListener('input', e => { audioEngine.setPan(id, parseFloat(e.target.value) / 100); markDirty(); });
            $('mx_dly_' + id).addEventListener('input', e => { audioEngine.setSend(id, 'delay', parseFloat(e.target.value) / 100); markDirty(); });
            $('mx_rev_' + id).addEventListener('input', e => { audioEngine.setSend(id, 'reverb', parseFloat(e.target.value) / 100); markDirty(); });
        });
        audioEngine.onMixChange = (id) => refreshMixerUI(id);
    }

    function refreshMixerUI(onlyId = null) {
        const ids = onlyId ? [onlyId] : CHANNEL_IDS;
        const anySolo = CHANNEL_IDS.some(id => audioEngine.mixState(id).solo);
        (onlyId ? CHANNEL_IDS : ids).forEach(id => {
            const m = audioEngine.mixState(id);
            const strip = document.querySelector('.mx-strip[data-ch="' + id + '"]');
            if (strip) {
                if (ids.includes(id)) {
                    Knobs.set('mx_lvl_' + id, Math.round(m.level * 100));
                    Knobs.set('mx_pan_' + id, Math.round(m.pan * 100));
                    Knobs.set('mx_dly_' + id, Math.round(m.sendDelay * 100));
                    Knobs.set('mx_rev_' + id, Math.round(m.sendReverb * 100));
                }
                strip.querySelector('.rc-m').classList.toggle('on', m.mute);
                strip.querySelector('.rc-s').classList.toggle('on', m.solo);
                strip.classList.toggle('auto-muted', m.autoMute);
                strip.classList.toggle('solo-dim', anySolo && !m.solo);
            }
            if (ids.includes(id)) {
                if ($('vol_' + id)) Knobs.set('vol_' + id, Math.round(m.level * 100));
                if (id === '303') Knobs.set('level303', Math.round(m.level * 100));
                if (id === 'stab') Knobs.set('stabLevel', Math.round(m.level * 100));
            }
        });
        refreshDrumLabels();
        refreshUnitMS();
    }

    // ------------------------------------------------------------ instrument units: fold / order / mute-solo

    function unitSections() { return [...document.querySelectorAll('.sequencer-section[data-mode="instruments"]')]; }
    function unitChannels(sec) { return (UNIT_GROUPS[sec.id] || (() => []))(); }

    function loadUiPrefs() {
        try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function saveUiPrefs() {
        const secs = unitSections();
        const prefs = {
            order: secs.map(sec => sec.id),
            collapsed: secs.filter(sec => sec.classList.contains('collapsed')).map(sec => sec.id)
        };
        try { localStorage.setItem(UI_KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ }
    }

    function decorateUnits() {
        const prefs = loadUiPrefs();
        const saved = Array.isArray(prefs.order) ? prefs.order.filter(id => UNIT_GROUPS[id]) : [];
        const order = saved.length === UNIT_DEFAULT_ORDER.length ? saved : UNIT_DEFAULT_ORDER;
        const main = document.querySelector('.sequencer-container');
        const current = unitSections();
        const after = current[current.length - 1].nextElementSibling;
        const ordered = [...order.map(id => $(id)).filter(Boolean), ...current.filter(sec => !order.includes(sec.id))];
        ordered.forEach(sec => main.insertBefore(sec, after));

        ordered.forEach(sec => {
            const title = sec.querySelector('.unit-title');
            const tools = sec.querySelector('.unit-tools');
            const h2 = title.querySelector('h2');

            const fold = document.createElement('button');
            fold.className = 'unit-fold';
            fold.type = 'button';
            fold.title = '折りたたむ / 開く';
            fold.setAttribute('aria-expanded', 'true');
            fold.innerHTML = '<span></span>';
            fold.addEventListener('click', () => toggleUnit(sec));
            h2.addEventListener('click', () => toggleUnit(sec));
            title.insertBefore(fold, title.firstChild);

            const ms = document.createElement('div');
            ms.className = 'unit-ms';
            ms.innerHTML =
                '<button class="rc rc-m" type="button" data-act="mute" title="このユニットの全チャンネルをミュート">M</button>' +
                '<button class="rc rc-s" type="button" data-act="solo" title="このユニットの全チャンネルをソロ">S</button>';
            ms.addEventListener('click', e => {
                const btn = e.target.closest('.rc');
                if (btn) unitMuteSolo(sec, btn.dataset.act);
            });
            title.appendChild(ms);

            const ord = document.createElement('div');
            ord.className = 'unit-order';
            ord.innerHTML =
                '<button class="rc" type="button" data-dir="-1" title="ユニットを上へ">▲</button>' +
                '<button class="rc" type="button" data-dir="1" title="ユニットを下へ">▼</button>';
            ord.addEventListener('click', e => {
                const btn = e.target.closest('.rc');
                if (btn && !btn.disabled) moveUnit(sec, parseInt(btn.dataset.dir));
            });
            tools.appendChild(ord);

            if (Array.isArray(prefs.collapsed) && prefs.collapsed.includes(sec.id)) setUnitCollapsed(sec, true, false);
        });
        refreshUnitOrderButtons();
        reorderMixerStrips();
        refreshUnitMS();
    }

    function setUnitCollapsed(sec, on, save = true) {
        sec.classList.toggle('collapsed', on);
        const fold = sec.querySelector('.unit-fold');
        if (fold) fold.setAttribute('aria-expanded', String(!on));
        if (save) saveUiPrefs();
    }
    function toggleUnit(sec) {
        const on = !sec.classList.contains('collapsed');
        setUnitCollapsed(sec, on);
        flash(UNIT_LABELS[sec.id] + (on ? ' CLOSED' : ' OPEN'), 900);
    }

    function moveUnit(sec, dir) {
        const secs = unitSections();
        const idx = secs.indexOf(sec);
        const target = idx + dir;
        if (idx < 0 || target < 0 || target >= secs.length) return;
        const main = sec.parentElement;
        if (dir < 0) main.insertBefore(sec, secs[target]);
        else main.insertBefore(secs[target], sec);
        refreshUnitOrderButtons();
        reorderMixerStrips();
        saveUiPrefs();
        sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        flash('ORDER · ' + unitSections().map(x => UNIT_LABELS[x.id]).join(' → '), 1600);
    }
    function refreshUnitOrderButtons() {
        const secs = unitSections();
        secs.forEach((sec, i) => {
            const up = sec.querySelector('.unit-order [data-dir="-1"]');
            const dn = sec.querySelector('.unit-order [data-dir="1"]');
            if (up) up.disabled = i === 0;
            if (dn) dn.disabled = i === secs.length - 1;
        });
    }
    /** Mixer strips follow the unit order on screen. */
    function reorderMixerStrips() {
        const box = $('mixerStrips');
        if (!box) return;
        unitSections().forEach(sec => unitChannels(sec).forEach(id => {
            const strip = box.querySelector('.mx-strip[data-ch="' + id + '"]');
            if (strip) box.appendChild(strip);
        }));
    }

    function unitMuteSolo(sec, act) {
        const ids = unitChannels(sec);
        if (!ids.length) return;
        if (act === 'mute') {
            const all = ids.every(id => audioEngine.mixState(id).mute);
            ids.forEach(id => audioEngine.setMute(id, !all));
            flash(UNIT_LABELS[sec.id] + (all ? ' UNMUTED' : ' MUTED'), 900);
        } else if (act === 'solo') {
            const all = ids.every(id => audioEngine.mixState(id).solo);
            ids.forEach(id => audioEngine.setSolo(id, !all));
            flash(UNIT_LABELS[sec.id] + (all ? ' SOLO OFF' : ' SOLO'), 900);
        }
        markDirty();
    }
    function refreshUnitMS() {
        const anySolo = CHANNEL_IDS.some(id => audioEngine.mixState(id).solo);
        unitSections().forEach(sec => {
            const ms = sec.querySelector('.unit-ms');
            if (!ms) return;
            const ids = unitChannels(sec);
            const states = ids.map(id => audioEngine.mixState(id));
            const allMute = states.length > 0 && states.every(m => m.mute);
            const someMute = states.some(m => m.mute);
            const allSolo = states.length > 0 && states.every(m => m.solo);
            const someSolo = states.some(m => m.solo);
            const mBtn = ms.querySelector('.rc-m');
            const sBtn = ms.querySelector('.rc-s');
            mBtn.classList.toggle('on', allMute);
            mBtn.classList.toggle('part', someMute && !allMute);
            sBtn.classList.toggle('on', allSolo);
            sBtn.classList.toggle('part', someSolo && !allSolo);
            sec.classList.toggle('unit-silent', allMute || (anySolo && !someSolo));
        });
    }

    // ------------------------------------------------------------ gate steps
    function buildGateSteps() {
        const box = $('gateSteps');
        box.innerHTML = '';
        for (let i = 0; i < 16; i++) {
            const b = document.createElement('button');
            b.className = 'gate-step' + (i % 4 === 0 ? ' beat' : '');
            b.dataset.step = i;
            b.title = 'STEP ' + (i + 1);
            b.addEventListener('click', () => { chaosFx.toggleGateStep(i); refreshGateSteps(); markDirty(); });
            box.appendChild(b);
        }
        refreshGateSteps();
    }

    function refreshGateSteps() {
        $('gateSteps').querySelectorAll('.gate-step').forEach((b, i) => b.classList.toggle('on', !!chaosFx.gatePattern[i]));
        document.querySelectorAll('.gate-rate-btn').forEach(b => b.classList.toggle('active', b.dataset.rate === chaosFx.gateRate));
    }

    // ============================================================ editing helpers
    function handleBassStepClick(step) {
        const pattern = sequencer.pattern303;
        const s = pattern[step];
        commit();
        state.selectedStepStab = null;
        if (!s.active) {
            s.active = true;
            s.note = state.selectedNote;
            s.octave = state.selectedOctave;
            s.prob = 100;
            s.ratchet = 1;
            state.selectedStep303 = step;
            previewBass(s);
        } else if (state.selectedStep303 === step) {
            s.active = false;
            s.accent = false;
            s.slide = false;
            s.prob = 100;
            s.ratchet = 1;
            s.lock = null;
            state.selectedStep303 = null;
        } else {
            state.selectedStep303 = step;
            setNoteUI(s.note);
            setOctaveUI(s.octave);
            previewBass(s);
        }
        updateBassGridDisplay();
        updateStabGridDisplay();
        showLockKnobs();
        markDirty();
    }

    function handleStabStepClick(step) {
        const line = sequencer.patternStab;
        const s = line[step];
        commit();
        state.selectedStep303 = null;
        if (!s.active) {
            s.active = true;
            s.note = state.selectedNote;
            s.octave = stab.octave;
            s.chord = defaultChordFor(state.selectedNote);
            s.prob = 100;
            state.selectedStepStab = step;
            previewStab(s);
        } else if (state.selectedStepStab === step) {
            s.active = false;
            s.accent = false;
            state.selectedStepStab = null;
        } else {
            state.selectedStepStab = step;
            setNoteUI(s.note);
            previewStab(s);
        }
        updateStabGridDisplay();
        updateBassGridDisplay();
        showLockKnobs();
        markDirty();
    }

    /** Pick a chord type that fits the current key / scale for a given root note. */
    function defaultChordFor(note) {
        const iv = MusicGen.SCALES[state.scale].iv;
        const semis = ((NOTES.indexOf(note) - state.root) % 12 + 12) % 12;
        const d = iv.indexOf(semis);
        if (d < 0) return 'min';
        return MusicGen.chordForDegree(iv, d, 0).type;
    }

    function transposeStep(s, semis, minOct, maxOct) {
        let midi = s.octave * 12 + NOTES.indexOf(s.note) + semis;
        let octave = Math.floor(midi / 12);
        if (octave < minOct || octave > maxOct) return;
        s.note = NOTES[((midi % 12) + 12) % 12];
        s.octave = octave;
    }

    function previewBass(s) {
        if (sequencer.isPlaying) return;
        audioEngine.init();
        audioEngine.resume();
        tb303.init();
        const t = audioEngine.currentTime + 0.01;
        tb303.trigger(s.note, s.octave, t, { accent: !!s.accent, gate: 0.18, lock: s.lock || null, force: true });
    }

    function previewStab(s) {
        if (sequencer.isPlaying) return;
        audioEngine.init();
        audioEngine.resume();
        stab.init();
        stab.trigger(s.note, s.octave, s.chord, audioEngine.currentTime + 0.01, { accent: !!s.accent, gate: 0.25 });
    }

    function previewDrum(id, accent) {
        if (sequencer.isPlaying) return;
        audioEngine.init();
        audioEngine.resume();
        tr808.init();
        tr808.trigger(id, audioEngine.currentTime + 0.005, { accent });
    }

    // --- parameter locks
    const LOCK_KEYS = [['cutoff', 'cutoff'], ['resonance', 'resonance'], ['envMod', 'envMod'], ['decay', 'decay']];
    function showLockKnobs() {
        const s = state.selectedStep303 !== null ? sequencer.pattern303[state.selectedStep303] : null;
        if (state.plock && s && s.active) {
            LOCK_KEYS.forEach(([id, key]) => Knobs.set(id, s.lock && s.lock[key] !== undefined ? s.lock[key] : tb303[key]));
            $('synthPanel303').classList.add('plock-armed');
        } else {
            syncTB303Knobs();
            $('synthPanel303').classList.remove('plock-armed');
        }
    }

    // ============================================================ pattern ops
    function selectPattern(i) {
        sequencer.selectPattern(i);
        refreshPatternUI(i);
        state.selectedStep303 = null;
        state.selectedStepStab = null;
        refreshGrids();
        markDirty();
    }

    function refreshPatternUI(i) {
        document.querySelectorAll('.pat-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.pat) === i));
        $('lcdPattern').textContent = PATTERN_NAMES[i];
    }

    function refreshGrids() {
        refreshAllPads();
        updateBassGridDisplay();
        updateStabGridDisplay();
        showLockKnobs();
    }

    function apply808(pattern, ext = null, lens = null) {
        commit();
        sequencer.setPattern808(sequencer.currentPattern808, pattern, ext, lens);
        refreshAllPads();
        markDirty();
    }

    function apply303(line) {
        commit();
        sequencer.setPattern303(sequencer.currentPattern303, line);
        state.selectedStep303 = null;
        updateBassGridDisplay();
        showLockKnobs();
        markDirty();
    }

    function applyStab(line) {
        commit();
        sequencer.setPatternStab(sequencer.currentPattern808, line);
        state.selectedStepStab = null;
        updateStabGridDisplay();
        markDirty();
    }

    function densityForStyle(style) {
        const S = MusicGen.STYLES[style] || MusicGen.STYLES.techno;
        return MusicGen.pick(S.density);
    }

    function applyComposition(c, { autoplay = true } = {}) {
        commit();
        const L = state.locks;
        withHistoryLock(() => {
            if (!L.d808) {
                c.patterns808.forEach((p, i) => sequencer.setPattern808(i, p));
                sequencer.setBPM(c.bpm);
                sequencer.setSwing(c.swing);
                tr808.setKits(c.kit);
            }
            if (!L.d303) {
                c.patterns303.forEach((l, i) => sequencer.setPattern303(i, l));
                state.root = c.root;
                state.scale = c.scale;
            }
            if (!L.stab) c.patternsStab.forEach((l, i) => sequencer.setPatternStab(i, l));
            if (!L.synth) {
                tb303.setParams(c.synth);
                stab.setParams(c.stab);
                audioEngine.init();
                chaosFx.init();
                chaosFx.setDelayTime(c.delay.time);
                chaosFx.setDelayFeedback(c.delay.feedback);
                chaosFx.setDelayMix(c.delay.mix);
                chaosFx.setDelayMode('normal');
                Knobs.set('delayTime', c.delay.time);
                Knobs.set('delayFeedback', c.delay.feedback);
                Knobs.set('delayMix', c.delay.mix);
                document.querySelectorAll('.delay-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'normal'));
                setFxToggle('delayToggle', c.delay.on);
                chaosFx.updateDelay(sequencer.bpm);
            }
            state.style = c.style;
            sequencer.setStretch(100);
            sequencer.selectPattern(0);

            chaosFx.polyEnabled = false;
            sequencer.steps303 = 16;
            setToggleUI($('polyToggle'), false);
            if (chaosFx.drunkMode) { chaosFx.drunkify(sequencer); $('drunkModeBtn').classList.remove('is-on'); $('app').classList.remove('drunk-active'); }
        });

        syncAllControls();
        refreshPatternUI(0);
        state.selectedStep303 = null;
        state.selectedStepStab = null;
        refreshGrids();
        refreshDrumLabels();
        markDirty();

        const keyName = NOTES[state.root] + ' ' + MusicGen.SCALES[state.scale].name;
        const kept = Object.keys(L).filter(k => L[k]).map(k => k.replace('d', '').toUpperCase());
        flash('COMPOSED · ' + MusicGen.STYLES[c.style].name + ' · ' + keyName + ' · ' + sequencer.bpm + ' BPM' + (kept.length ? ' · KEPT ' + kept.join('/') : ''));
        if (autoplay && !sequencer.isPlaying) startPlayback();
    }

    // ============================================================ control sync
    function syncAllControls() {
        Knobs.set('bpmSlider', sequencer.bpm);
        Knobs.set('swingSlider', Math.round(sequencer.swing * 100));
        Knobs.set('humanizeSlider', Math.round(sequencer.humanize * 100));
        Knobs.set('masterVol', Math.round(audioEngine.masterVolume * 100));
        Knobs.set('masterFilter', state.userFilter);
        syncTB303Knobs();
        syncStabKnobs();
        refreshMixerUI();
        refreshSamplerUI();
        Knobs.set('timeStretch', Math.round(sequencer.stretch * 100));
        Knobs.set('scDepth', Math.round(audioEngine.sidechain.depth * 100));
        Knobs.set('scRelease', Math.round(audioEngine.sidechain.release * 1000));
        setToggleUI($('scToggle'), audioEngine.sidechain.enabled);
        $('chainToggle').classList.toggle('is-on', sequencer.chain.enabled && !sequencer.song.enabled);
        $('songToggle').classList.toggle('is-on', sequencer.song.enabled);
        $('chainBars').value = String(sequencer.chain.bars);
        $('songBars').value = String(state.songBars);
        $('styleSelect').value = state.style;
        $('keySelect').value = state.randomKey ? 'random' : String(state.root);
        $('scaleSelect').value = state.randomScale ? 'random' : state.scale;
        $('recLength').value = state.recLength;
        $('scopeMode').value = state.scopeMode;
        Object.keys(state.locks).forEach(k => {
            const id = k === 'd808' ? 'lock808' : k === 'd303' ? 'lock303' : k === 'stab' ? 'lockStab' : 'lockSynth';
            $(id).classList.toggle('active', state.locks[k]);
        });
        $('plockToggle').classList.toggle('active', state.plock);
        document.querySelectorAll('.edit-btn').forEach(b => b.classList.toggle('active', b.dataset.edit === state.editMode));
        $('drumGrid').dataset.edit = state.editMode;
        setOctaveUI(state.selectedOctave);
        setNoteUI(state.selectedNote);
        refreshGateSteps();
        updateLCDStatic();
        updateUndoButtons();
    }

    function syncTB303Knobs() {
        Knobs.set('cutoff', tb303.cutoff);
        Knobs.set('resonance', tb303.resonance);
        Knobs.set('envMod', tb303.envMod);
        Knobs.set('decay', tb303.decay);
        Knobs.set('accent', tb303.accentLevel);
        Knobs.set('drive303', tb303.drive);
        Knobs.set('level303', Math.round(audioEngine.mixState('303').level * 100));
        $('waveSaw').classList.toggle('active', tb303.waveform === 'sawtooth');
        $('waveSqr').classList.toggle('active', tb303.waveform === 'square');
    }

    function syncStabKnobs() {
        Knobs.set('stabCutoff', stab.cutoff);
        Knobs.set('stabRes', stab.resonance);
        Knobs.set('stabEnv', stab.envMod);
        Knobs.set('stabDecay', stab.decay);
        Knobs.set('stabRelease', stab.release);
        Knobs.set('stabDetune', stab.detune);
        Knobs.set('stabChorus', stab.chorus);
        Knobs.set('stabLevel', Math.round(audioEngine.mixState('stab').level * 100));
        $('stabWaveSaw').classList.toggle('active', stab.waveform === 'sawtooth');
        $('stabWaveSqr').classList.toggle('active', stab.waveform === 'square');
        document.querySelectorAll('.stab-oct-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.oct) === stab.octave));
    }

    function setToggleUI(btn, on) {
        btn.classList.toggle('active', on);
        btn.lastChild.textContent = on ? 'ON' : 'OFF';
    }

    function setFxToggle(id, on) {
        const btn = $(id);
        if (!btn) return;
        const fn = fxToggleFns[id];
        if (fn) fn(!!on);
        setToggleUI(btn, !!on);
    }

    function updateLCDStatic() {
        $('lcdSwing').textContent = Math.round(sequencer.swing * 100) + '%';
        $('lcdPattern').textContent = PATTERN_NAMES[sequencer.currentPattern808];
        $('lcdChain').textContent = sequencer.song.enabled ? 'SONG ' + sequencer.song.bars : (sequencer.chain.enabled ? 'CHAIN ' + sequencer.chain.bars : 'PATTERN');
        $('lcdKey').textContent = NOTES[state.root] + ' ' + shortScale(state.scale);
        if (!sequencer.isPlaying) $('lcdSection').textContent = sequencer.song.enabled ? 'READY' : '–';
    }

    function shortScale(k) {
        return { minorPenta: 'MIN.P', aeolian: 'MINOR', dorian: 'DORIAN', phrygian: 'PHRYG', harmMinor: 'H.MIN', blues: 'BLUES', majorPenta: 'MAJ.P' }[k] || k.toUpperCase();
    }

    let flashTimer = null;
    let baseStatus = 'READY — PRESS PLAY OR COMPOSE';
    function flash(text, ms = 2200) {
        const el = $('statusText');
        el.textContent = text;
        el.parentElement.classList.remove('flash');
        void el.offsetWidth;
        el.parentElement.classList.add('flash');
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => { el.textContent = baseStatus; el.parentElement.classList.remove('flash'); }, ms);
    }
    function setBaseStatus(text) {
        baseStatus = text;
        if (!flashTimer) $('statusText').textContent = text;
        else { clearTimeout(flashTimer); flashTimer = null; $('statusText').textContent = text; }
    }

    // ============================================================ undo / redo
    function snapshot() {
        return JSON.stringify({
            seq: sequencer.toJSON(),
            tb303: tb303.getParams(),
            stab: stab.getParams(),
            kits: tr808.getKits(),
            root: state.root,
            scale: state.scale,
            style: state.style
        });
    }

    function commit(tag = '') {
        if (hist.lock) return;
        const now = performance.now();
        if (tag && hist.lastTag === tag && now - hist.lastTime < 400) { hist.lastTime = now; return; }
        hist.lastTag = tag;
        hist.lastTime = now;
        const snap = snapshot();
        if (hist.undo.length && hist.undo[hist.undo.length - 1] === snap) return;
        hist.undo.push(snap);
        if (hist.undo.length > 60) hist.undo.shift();
        hist.redo.length = 0;
        updateUndoButtons();
    }

    function withHistoryLock(fn) {
        const prev = hist.lock;
        hist.lock = true;
        try { fn(); } finally { hist.lock = prev; }
    }

    function restoreSnapshot(json) {
        const snap = JSON.parse(json);
        withHistoryLock(() => {
            sequencer.fromJSON(snap.seq);
            tb303.setParams(snap.tb303);
            stab.setParams(snap.stab);
            tr808.setKits(snap.kits);
            if (Number.isInteger(snap.root)) state.root = snap.root;
            if (MusicGen.SCALES[snap.scale]) state.scale = snap.scale;
            if (MusicGen.STYLES[snap.style]) state.style = snap.style;
        });
        state.selectedStep303 = null;
        state.selectedStepStab = null;
        syncAllControls();
        refreshPatternUI(sequencer.currentPattern808);
        refreshGrids();
        refreshDrumLabels();
        chaosFx.updateDelay(sequencer.bpm);
        markDirty();
    }

    function undo() {
        if (!hist.undo.length) { flash('NOTHING TO UNDO'); return; }
        const cur = snapshot();
        let snap = hist.undo.pop();
        if (snap === cur && hist.undo.length) snap = hist.undo.pop();
        hist.redo.push(cur);
        restoreSnapshot(snap);
        updateUndoButtons();
        flash('UNDO');
    }

    function redo() {
        if (!hist.redo.length) { flash('NOTHING TO REDO'); return; }
        const cur = snapshot();
        const snap = hist.redo.pop();
        hist.undo.push(cur);
        restoreSnapshot(snap);
        updateUndoButtons();
        flash('REDO');
    }

    function updateUndoButtons() {
        $('undoBtn').disabled = !hist.undo.length;
        $('redoBtn').disabled = !hist.redo.length;
    }

    // ============================================================ transport
    function startPlayback() {
        audioEngine.init();
        audioEngine.resume();
        chaosFx.init();
        chaosFx.cancelTape(sequencer, tb303);
        if (sequencer.song.enabled) {
            state.songFxBackup = { delay: chaosFx.delayEnabled, reverb: chaosFx.reverbEnabled };
        }
        sequencer.start();
        $('playBtn').classList.add('is-on');
        $('ledRun').classList.add('is-on');
        setBaseStatus(sequencer.song.enabled ? 'PLAYING · SONG MODE' : 'PLAYING');
    }

    function stopPlayback() {
        chaosFx.cancelTape(sequencer, tb303);
        sequencer.stop();
    }

    function endSongAutomation() {
        audioEngine.clearAutoMutes();
        audioEngine.filterAuto = null;
        audioEngine.setFilter(state.userFilter);
        Knobs.set('masterFilter', state.userFilter);
        if (state.songFxBackup) {
            setFxToggle('delayToggle', state.songFxBackup.delay);
            setFxToggle('reverbToggle', state.songFxBackup.reverb);
            state.songFxBackup = null;
        }
        $('lcdSection').textContent = sequencer.song.enabled ? 'READY' : '–';
        refreshMixerUI();
    }

    function disableSong() {
        sequencer.setSongEnabled(false);
        endSongAutomation();
        $('songToggle').classList.remove('is-on');
        $('chainToggle').classList.toggle('is-on', sequencer.chain.enabled);
        updateLCDStatic();
    }

    sequencer.onStop = () => {
        $('playBtn').classList.remove('is-on');
        $('ledRun').classList.remove('is-on');
        $('ledBeat').classList.remove('is-on');
        $('stutterBtn').classList.remove('is-on');
        $('fillBtn').classList.remove('is-on');
        drawQueue.length = 0;
        patQueue.length = 0;
        clearStepHighlights();
        $('lcdBar').textContent = '–';
        endSongAutomation();
        midi.stop();
        if (recorder.recording && state.recBars) finishRecording();
        setBaseStatus('STOPPED');
    };

    sequencer.onStart = (t) => midi.start(t);
    sequencer.onTrigger = (type, data, t) => midi.trigger(type, data, t);
    sequencer.stepHooks.push((tick, time, dur) => chaosFx.onStep(tick, time, dur));
    sequencer.onStepChange = (tick, t) => drawQueue.push({ tick, t });
    sequencer.onPatternChange = (idx, t) => {
        if (t === undefined) refreshPatternUI(idx);
        else patQueue.push({ idx, t });
    };
    sequencer.onBar = (bar, t, info) => {
        patQueue.push({ bar, t, info });
        if (recorder.recording && state.recBars) {
            state.recBarCount++;
            if (state.recBarCount > state.recBars) {
                const ms = Math.max(0, (t - audioEngine.currentTime) * 1000);
                setTimeout(() => finishRecording(), ms);
                state.recBars = null;
            }
        }
    };
    sequencer.onSection = (sec, bar, time, barDur) => {
        CHANNEL_IDS.forEach(id => audioEngine.setAutoMute(id, sec.mutes.includes(id), time));
        if (sec.filter) audioEngine.sweepFilter(sec.filter[0], sec.filter[1], time, time + sec.len * barDur);
        else { audioEngine.filterAuto = null; audioEngine.setFilter(state.userFilter, { time }); }
        patQueue.push({ section: sec, t: time });
    };

    function bindTransport() {
        $('playBtn').addEventListener('click', () => { if (sequencer.isPlaying) stopPlayback(); else startPlayback(); });
        $('stopBtn').addEventListener('click', () => {
            stopPlayback();
            $('stopBtn').classList.add('flash');
            setTimeout(() => $('stopBtn').classList.remove('flash'), 150);
        });

        // --- fill (momentary)
        const fillBtn = $('fillBtn');
        const fillStart = e => {
            if (e) e.preventDefault();
            if (!sequencer.isPlaying) { flash('FILL: PRESS PLAY FIRST'); return; }
            if (sequencer.startFill({ root: state.root, scale: state.scale, density: densityForStyle(state.style) })) {
                fillBtn.classList.add('is-on');
                flash('FILL');
            }
        };
        const fillEnd = () => { sequencer.stopFill(); fillBtn.classList.remove('is-on'); };
        fillBtn.addEventListener('pointerdown', fillStart);
        fillBtn.addEventListener('pointerup', fillEnd);
        fillBtn.addEventListener('pointercancel', fillEnd);
        fillBtn.addEventListener('pointerleave', fillEnd);
        fillBtn.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); fillStart(e); } });
        fillBtn.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') fillEnd(); });
        window.fillStart = fillStart;
        window.fillEnd = fillEnd;

        $('recBtn').addEventListener('click', toggleRecording);
        $('recBtn2').addEventListener('click', toggleRecording);

        $('bpmSlider').addEventListener('input', e => {
            sequencer.setBPM(parseInt(e.target.value));
            chaosFx.updateDelay(sequencer.bpm);
            markDirty();
        });
        $('bpmDown').addEventListener('click', () => Knobs.set('bpmSlider', sequencer.bpm - 1, { emit: true }));
        $('bpmUp').addEventListener('click', () => Knobs.set('bpmSlider', sequencer.bpm + 1, { emit: true }));
        $('tapBtn').addEventListener('click', tapTempo);

        $('swingSlider').addEventListener('input', e => {
            sequencer.setSwing(parseInt(e.target.value));
            $('lcdSwing').textContent = e.target.value + '%';
            markDirty();
        });
        $('humanizeSlider').addEventListener('input', e => { sequencer.setHumanize(parseInt(e.target.value)); markDirty(); });

        $('masterVol').addEventListener('input', e => {
            audioEngine.init();
            audioEngine.setMasterVolume(e.target.value / 100);
            markDirty();
        });
        $('masterFilter').addEventListener('input', e => {
            audioEngine.init();
            state.userFilter = parseInt(e.target.value);
            audioEngine.filterAuto = null;
            audioEngine.setFilter(state.userFilter);
            markDirty();
        });

        $('undoBtn').addEventListener('click', undo);
        $('redoBtn').addEventListener('click', redo);

        $('modeInst').addEventListener('click', () => switchMode('instruments'));
        $('modeMixer').addEventListener('click', () => switchMode('mixer'));
        $('modeFX').addEventListener('click', () => switchMode('fx'));
        $('modeSystem').addEventListener('click', () => switchMode('system'));
    }

    function tapTempo() {
        const now = performance.now();
        const taps = state.taps;
        if (taps.length && now - taps[taps.length - 1] > 2500) taps.length = 0;
        taps.push(now);
        if (taps.length > 6) taps.shift();
        $('tapBtn').classList.add('is-on');
        setTimeout(() => $('tapBtn').classList.remove('is-on'), 120);
        if (taps.length < 2) { flash('TAP…'); return; }
        let sum = 0;
        for (let i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
        const bpm = Math.round(60000 / (sum / (taps.length - 1)));
        Knobs.set('bpmSlider', bpm, { emit: true });
        flash('TAP TEMPO · ' + sequencer.bpm + ' BPM');
    }

    // ============================================================ composer
    function bindComposer() {
        $('chainToggle').addEventListener('click', () => {
            if (sequencer.song.enabled) disableSong();
            const on = !sequencer.chain.enabled;
            sequencer.setChainEnabled(on);
            $('chainToggle').classList.toggle('is-on', on);
            updateLCDStatic();
            flash(on ? 'CHAIN ON · A1→A2→B1→B2 · ' + sequencer.chain.bars + ' BARS EACH' : 'CHAIN OFF');
            markDirty();
        });
        $('chainBars').addEventListener('change', e => {
            sequencer.setChainBars(e.target.value);
            updateLCDStatic();
            markDirty();
        });

        $('styleSelect').addEventListener('change', e => { state.style = e.target.value; markDirty(); });
        $('keySelect').addEventListener('change', e => {
            state.randomKey = e.target.value === 'random';
            if (!state.randomKey) state.root = parseInt(e.target.value);
            updateLCDStatic(); markDirty();
        });
        $('scaleSelect').addEventListener('change', e => {
            state.randomScale = e.target.value === 'random';
            if (!state.randomScale) state.scale = e.target.value;
            updateLCDStatic(); markDirty();
        });

        $('composeBtn').addEventListener('click', () => {
            const c = MusicGen.compose({
                style: state.style,
                root: state.randomKey ? 'random' : state.root,
                scale: state.randomScale ? 'random' : state.scale
            });
            applyComposition(c);
            $('composeBtn').classList.add('is-on');
            setTimeout(() => $('composeBtn').classList.remove('is-on'), 600);
        });

        [['lock808', 'd808'], ['lock303', 'd303'], ['lockStab', 'stab'], ['lockSynth', 'synth']].forEach(([id, key]) => {
            $(id).addEventListener('click', () => {
                state.locks[key] = !state.locks[key];
                $(id).classList.toggle('active', state.locks[key]);
                flash('KEEP ' + $(id).textContent + (state.locks[key] ? ' ON' : ' OFF'));
                markDirty();
            });
        });

        $('songBars').addEventListener('change', e => { state.songBars = parseInt(e.target.value) || 32; markDirty(); });
        $('arrangeBtn').addEventListener('click', () => {
            const arr = MusicGen.arrange({ bars: state.songBars, chainBars: sequencer.chain.bars });
            sequencer.setSong(arr);
            sequencer.setSongEnabled(true);
            $('songToggle').classList.add('is-on');
            $('chainToggle').classList.remove('is-on');
            updateLCDStatic();
            flash('ARRANGED · ' + arr.bars + ' BARS · ' + arr.sections.map(s => s.name).join('→'));
            markDirty();
            if (!sequencer.isPlaying) startPlayback();
        });
        $('songToggle').addEventListener('click', () => {
            if (sequencer.song.enabled) { disableSong(); flash('SONG OFF'); markDirty(); return; }
            if (!sequencer.song.sections.length) { $('arrangeBtn').click(); return; }
            sequencer.setSongEnabled(true);
            $('songToggle').classList.add('is-on');
            $('chainToggle').classList.remove('is-on');
            updateLCDStatic();
            flash('SONG ON · ' + sequencer.song.bars + ' BARS');
            markDirty();
        });
    }

    // ============================================================ instruments
    function bindInstruments() {
        const grid = $('drumGrid');
        const cycleProb = p => (p <= 25 ? 100 : p <= 50 ? 25 : p <= 75 ? 50 : 75);

        grid.addEventListener('pointerdown', e => {
            const pad = e.target.closest('.pad');
            if (!pad) return;
            e.preventDefault();
            const inst = pad.dataset.instrument;
            const step = parseInt(pad.dataset.step);
            commit('pad');
            if (state.editMode === 'prob') {
                const ext = sequencer.getExt(inst, step);
                sequencer.setExt(inst, step, { p: cycleProb(ext.p) });
                refreshPadRow(inst);
                markDirty();
                return;
            }
            if (state.editMode === 'ratchet') {
                const ext = sequencer.getExt(inst, step);
                sequencer.setExt(inst, step, { r: (ext.r % 4) + 1 });
                refreshPadRow(inst);
                markDirty();
                return;
            }
            if (state.editMode === 'len') {
                sequencer.setLen(inst, step + 1);
                refreshPadRow(inst);
                flash(inst.toUpperCase() + ' LENGTH ' + sequencer.getLen(inst));
                markDirty();
                return;
            }
            const cur = sequencer.pattern808[inst][step];
            let next;
            if (e.button === 2 || e.shiftKey) next = cur === 2 ? 1 : 2;
            else next = cur ? 0 : 1;
            sequencer.set808Step(inst, step, next);
            applyPadClass(pad, next);
            if (next) previewDrum(inst, next === 2);
            state.paint = { value: next, touched: new Set([inst + ':' + step]) };
            markDirty();
        });
        grid.addEventListener('pointermove', e => {
            if (!state.paint || !(e.buttons & 3) || state.editMode !== 'trig') return;
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const pad = el && el.closest ? el.closest('.pad') : null;
            if (!pad) return;
            const key = pad.dataset.instrument + ':' + pad.dataset.step;
            if (state.paint.touched.has(key)) return;
            state.paint.touched.add(key);
            sequencer.set808Step(pad.dataset.instrument, parseInt(pad.dataset.step), state.paint.value);
            applyPadClass(pad, state.paint.value);
            markDirty();
        });
        grid.addEventListener('wheel', e => {
            const pad = e.target.closest('.pad');
            if (!pad || state.editMode === 'trig' || state.editMode === 'len') return;
            e.preventDefault();
            const inst = pad.dataset.instrument;
            const step = parseInt(pad.dataset.step);
            const ext = sequencer.getExt(inst, step);
            commit('padwheel');
            if (state.editMode === 'prob') sequencer.setExt(inst, step, { p: Math.max(5, Math.min(100, ext.p + (e.deltaY < 0 ? 5 : -5))) });
            else sequencer.setExt(inst, step, { r: ext.r + (e.deltaY < 0 ? 1 : -1) });
            refreshPadRow(inst);
            markDirty();
        }, { passive: false });
        const endPaint = () => { state.paint = null; };
        document.addEventListener('pointerup', endPaint);
        document.addEventListener('pointercancel', endPaint);

        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                state.editMode = btn.dataset.edit;
                document.querySelectorAll('.edit-btn').forEach(b => b.classList.toggle('active', b === btn));
                $('drumGrid').dataset.edit = state.editMode;
                refreshAllPads();
                flash({ trig: 'EDIT: TRIGGERS', prob: 'EDIT: PROBABILITY · CLICK 100→75→50→25 · WHEEL ±5', ratchet: 'EDIT: RATCHET · CLICK 1→2→3→4', len: 'EDIT: TRACK LENGTH · CLICK THE LAST STEP' }[state.editMode]);
                markDirty();
            });
        });

        $('kitAll808').addEventListener('click', () => { tr808.setAllKits('808'); refreshDrumLabels(); flash('ALL VOICES → TR-808'); markDirty(); });
        $('kitAll909').addEventListener('click', () => { tr808.setAllKits('909'); refreshDrumLabels(); flash('ALL VOICES → TR-909'); markDirty(); });

        $('clear808').addEventListener('click', () => { commit(); sequencer.clearPattern808(); refreshAllPads(); flash('808 PATTERN CLEARED'); markDirty(); });
        $('clear303').addEventListener('click', () => { commit(); sequencer.clearPattern303(); state.selectedStep303 = null; updateBassGridDisplay(); showLockKnobs(); flash('303 PATTERN CLEARED'); markDirty(); });

        $('copy808').addEventListener('click', () => {
            state.clip808 = {
                p: JSON.parse(JSON.stringify(sequencer.pattern808)),
                ext: JSON.parse(JSON.stringify(sequencer.ext)),
                lens: JSON.parse(JSON.stringify(sequencer.lens))
            };
            $('paste808').disabled = false;
            flash('808 PATTERN COPIED');
        });
        $('paste808').addEventListener('click', () => { if (state.clip808) { apply808(state.clip808.p, state.clip808.ext, state.clip808.lens); flash('808 PATTERN PASTED'); } });
        $('copy303').addEventListener('click', () => {
            state.clip303 = JSON.parse(JSON.stringify(sequencer.pattern303));
            $('paste303').disabled = false;
            flash('303 PATTERN COPIED');
        });
        $('paste303').addEventListener('click', () => { if (state.clip303) { apply303(state.clip303); flash('303 PATTERN PASTED'); } });

        $('genBeatBtn').addEventListener('click', () => {
            apply808(MusicGen.generateBeat(state.style));
            flash('BEAT GENERATED · ' + MusicGen.STYLES[state.style].name);
        });
        $('genLineBtn').addEventListener('click', () => {
            apply303(MusicGen.generateLine({ root: state.root, scale: state.scale, density: densityForStyle(state.style) }));
            flash('LINE GENERATED · ' + NOTES[state.root] + ' ' + MusicGen.SCALES[state.scale].name);
        });

        $('transDown').addEventListener('click', () => { apply303(MusicGen.transposeLine(sequencer.pattern303, -1)); flash('TRANSPOSE −1'); });
        $('transUp').addEventListener('click', () => { apply303(MusicGen.transposeLine(sequencer.pattern303, 1)); flash('TRANSPOSE +1'); });
        $('octDown').addEventListener('click', () => { apply303(MusicGen.transposeLine(sequencer.pattern303, -12)); flash('OCTAVE DOWN'); });
        $('octUp').addEventListener('click', () => { apply303(MusicGen.transposeLine(sequencer.pattern303, 12)); flash('OCTAVE UP'); });

        // --- 303 synth knobs (with parameter locks)
        const bindLockable = (id, key, setter) => {
            $(id).addEventListener('input', e => {
                const v = parseFloat(e.target.value);
                if (state.plock && state.selectedStep303 !== null) {
                    const s = sequencer.pattern303[state.selectedStep303];
                    if (s.active) {
                        s.lock = s.lock || {};
                        s.lock[key] = v;
                        updateBassGridDisplay();
                        markDirty();
                        return;
                    }
                }
                setter(v);
                markDirty();
            });
        };
        bindLockable('cutoff', 'cutoff', v => tb303.setCutoff(v));
        bindLockable('resonance', 'resonance', v => tb303.setResonance(v));
        bindLockable('envMod', 'envMod', v => tb303.setEnvMod(v));
        bindLockable('decay', 'decay', v => tb303.setDecay(v));
        $('accent').addEventListener('input', e => { tb303.setAccent(parseFloat(e.target.value)); markDirty(); });
        $('drive303').addEventListener('input', e => { tb303.setDrive(parseFloat(e.target.value)); markDirty(); });
        $('level303').addEventListener('input', e => { audioEngine.setLevel('303', parseFloat(e.target.value) / 100); markDirty(); });
        $('waveSaw').addEventListener('click', () => { commit(); tb303.setWaveform('sawtooth'); syncTB303Knobs(); markDirty(); });
        $('waveSqr').addEventListener('click', () => { commit(); tb303.setWaveform('square'); syncTB303Knobs(); markDirty(); });

        $('plockToggle').addEventListener('click', () => {
            state.plock = !state.plock;
            $('plockToggle').classList.toggle('active', state.plock);
            showLockKnobs();
            flash(state.plock ? 'P-LOCK ARMED · SELECT A STEP, TURN A KNOB' : 'P-LOCK OFF');
            markDirty();
        });
        $('plockClear').addEventListener('click', () => {
            if (state.selectedStep303 === null) { flash('SELECT A STEP FIRST'); return; }
            commit();
            sequencer.pattern303[state.selectedStep303].lock = null;
            updateBassGridDisplay();
            showLockKnobs();
            flash('LOCK CLEARED · STEP ' + (state.selectedStep303 + 1));
            markDirty();
        });

        document.querySelectorAll('.oct-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                setOctaveUI(parseInt(btn.dataset.oct));
                if (state.selectedStep303 !== null) {
                    commit();
                    const s = sequencer.pattern303[state.selectedStep303];
                    s.octave = state.selectedOctave;
                    updateBassGridDisplay();
                    previewBass(s);
                    markDirty();
                }
            });
        });

        // snapshot before a synth knob drag starts (so undo covers sound design too)
        document.addEventListener('knobgrab', e => {
            const input = e.detail && e.detail.input;
            if (!input) return;
            if (state.midiLearn) {
                midi.learn(input.id, () => { state.midiLearn = false; $('midiLearnBtn').classList.remove('is-on'); });
                flash('MOVE A MIDI CONTROL FOR ' + knobLabel(input));
                return;
            }
            if (input.closest('.synth-panel')) commit('knob:' + input.id);
        });
    }

    function knobLabel(input) {
        const el = Knobs.element(input);
        const lbl = el ? el.getAttribute('aria-label') : '';
        const unit = input.closest('.unit');
        const title = unit ? (unit.querySelector('h2') || {}).textContent : '';
        return ((title || '').replace(/\s+/g, ' ').trim().split(' ')[0] + ' ' + (lbl || input.id)).trim();
    }

    // ============================================================ stab
    function bindStab() {
        $('genStabBtn').addEventListener('click', () => {
            commit();
            const lines = MusicGen.generateStabs({ root: state.root, scale: state.scale, style: state.style, force: true });
            withHistoryLock(() => lines.forEach((l, i) => sequencer.setPatternStab(i, l)));
            state.selectedStepStab = null;
            updateStabGridDisplay();
            markDirty();
            flash('STABS GENERATED · 4 PATTERNS · ' + NOTES[state.root] + ' ' + MusicGen.SCALES[state.scale].name);
        });
        $('transStabDown').addEventListener('click', () => { applyStab(MusicGen.transposeStabs(sequencer.patternStab, -1)); flash('STAB −1'); });
        $('transStabUp').addEventListener('click', () => { applyStab(MusicGen.transposeStabs(sequencer.patternStab, 1)); flash('STAB +1'); });
        $('copyStab').addEventListener('click', () => {
            state.clipStab = JSON.parse(JSON.stringify(sequencer.patternStab));
            $('pasteStab').disabled = false;
            flash('STAB PATTERN COPIED');
        });
        $('pasteStab').addEventListener('click', () => { if (state.clipStab) { applyStab(state.clipStab); flash('STAB PATTERN PASTED'); } });
        $('clearStab').addEventListener('click', () => { commit(); sequencer.clearPatternStab(); state.selectedStepStab = null; updateStabGridDisplay(); flash('STAB PATTERN CLEARED'); markDirty(); });

        $('stabCutoff').addEventListener('input', e => { stab.setCutoff(parseFloat(e.target.value)); markDirty(); });
        $('stabRes').addEventListener('input', e => { stab.setResonance(parseFloat(e.target.value)); markDirty(); });
        $('stabEnv').addEventListener('input', e => { stab.setEnvMod(parseFloat(e.target.value)); markDirty(); });
        $('stabDecay').addEventListener('input', e => { stab.setDecay(parseFloat(e.target.value)); markDirty(); });
        $('stabRelease').addEventListener('input', e => { stab.setRelease(parseFloat(e.target.value)); markDirty(); });
        $('stabDetune').addEventListener('input', e => { stab.setDetune(parseFloat(e.target.value)); markDirty(); });
        $('stabChorus').addEventListener('input', e => { stab.setChorus(parseFloat(e.target.value)); markDirty(); });
        $('stabLevel').addEventListener('input', e => { audioEngine.setLevel('stab', parseFloat(e.target.value) / 100); markDirty(); });
        $('stabWaveSaw').addEventListener('click', () => { commit(); stab.setWaveform('sawtooth'); syncStabKnobs(); markDirty(); });
        $('stabWaveSqr').addEventListener('click', () => { commit(); stab.setWaveform('square'); syncStabKnobs(); markDirty(); });
        document.querySelectorAll('.stab-oct-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                stab.setOctave(parseInt(btn.dataset.oct));
                syncStabKnobs();
                if (state.selectedStepStab !== null) {
                    commit();
                    const s = sequencer.patternStab[state.selectedStepStab];
                    s.octave = stab.octave;
                    updateStabGridDisplay();
                    previewStab(s);
                }
                markDirty();
            });
        });
    }

    // ============================================================ mixer
    function bindMixer() {
        $('soloClear').addEventListener('click', () => { audioEngine.clearSolo(); flash('SOLO CLEARED'); markDirty(); });
        $('muteClear').addEventListener('click', () => { CHANNEL_IDS.forEach(id => audioEngine.setMute(id, false)); flash('MUTES CLEARED'); markDirty(); });
        $('scToggle').addEventListener('click', () => {
            audioEngine.init();
            const on = !audioEngine.sidechain.enabled;
            audioEngine.setSidechain({ enabled: on });
            setToggleUI($('scToggle'), on);
            flash('SIDECHAIN' + (on ? ' ON · KICK DUCKS EVERYTHING ELSE' : ' OFF'));
            markDirty();
        });
        $('scDepth').addEventListener('input', e => { audioEngine.setSidechain({ depth: parseFloat(e.target.value) / 100 }); markDirty(); });
        $('scRelease').addEventListener('input', e => { audioEngine.setSidechain({ release: parseFloat(e.target.value) / 1000 }); markDirty(); });
    }

    // ============================================================ chaos fx
    function bindChaosFX() {
        const toggle = (id, fn, label) => {
            const btn = $(id);
            fxToggleFns[id] = fn;
            btn.addEventListener('click', () => {
                audioEngine.init();
                chaosFx.init();
                const on = !btn.classList.contains('active');
                fn(on);
                setToggleUI(btn, on);
                flash(label + (on ? ' ON' : ' OFF'));
                markDirty();
            });
        };
        const knob = (id, fn) => $(id).addEventListener('input', e => { fn(parseFloat(e.target.value)); markDirty(); });

        // --- stutter (momentary)
        const stutterBtn = $('stutterBtn');
        const stutterStart = e => {
            e.preventDefault();
            if (!sequencer.isPlaying) { flash('STUTTER: PRESS PLAY FIRST'); return; }
            if (sequencer.startStutter(parseInt($('stutterRate').value), parseInt($('stutterDecay').value))) {
                stutterBtn.classList.add('is-on');
            }
        };
        const stutterEnd = () => {
            if (sequencer.stutter) sequencer.stopStutter();
            stutterBtn.classList.remove('is-on');
        };
        stutterBtn.addEventListener('pointerdown', stutterStart);
        stutterBtn.addEventListener('pointerup', stutterEnd);
        stutterBtn.addEventListener('pointercancel', stutterEnd);
        stutterBtn.addEventListener('pointerleave', stutterEnd);
        stutterBtn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) stutterStart(e); } });
        stutterBtn.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') stutterEnd(); });
        knob('stutterRate', v => { chaosFx.stutterRate = v; sequencer.setStutterRate(v); });
        knob('stutterDecay', v => { chaosFx.stutterDecay = v; });

        $('tapeStopBtn').addEventListener('click', () => {
            if (!sequencer.isPlaying) { flash('TAPE STOP: PRESS PLAY FIRST'); return; }
            if (chaosFx.tapeStop(sequencer, tb303, 1.8)) flash('TAPE STOP');
        });
        $('vinylBrakeBtn').addEventListener('click', () => {
            if (!sequencer.isPlaying) { flash('VINYL BRAKE: PRESS PLAY FIRST'); return; }
            if (chaosFx.vinylBrake(sequencer, tb303)) flash('VINYL BRAKE');
        });

        // --- inserts
        toggle('driveToggle', on => chaosFx.toggleDrive(on), 'OVERDRIVE');
        knob('driveAmount', v => chaosFx.setDriveAmount(v));
        knob('driveTone', v => chaosFx.setDriveTone(v));
        knob('driveMix', v => chaosFx.setDriveMix(v));

        toggle('bitCrushToggle', on => chaosFx.toggleBitCrush(on), 'BIT CRUSH');
        knob('bitDepth', v => chaosFx.setBitDepth(v));
        knob('sampleRateReduce', v => chaosFx.setSampleRateReduce(v));
        knob('crushMix', v => chaosFx.setCrushMix(v));

        toggle('delayToggle', on => { chaosFx.toggleDelay(on); chaosFx.updateDelay(sequencer.bpm); }, 'DELAY');
        knob('delayTime', v => chaosFx.setDelayTime(v));
        knob('delayFeedback', v => chaosFx.setDelayFeedback(v));
        knob('delayFilter', v => chaosFx.setDelayFilter(v));
        knob('delayMix', v => chaosFx.setDelayMix(v));
        document.querySelectorAll('.delay-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                audioEngine.init();
                chaosFx.init();
                document.querySelectorAll('.delay-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                chaosFx.setDelayMode(btn.dataset.mode);
                flash('DELAY · ' + btn.textContent);
                markDirty();
            });
        });

        toggle('reverbToggle', on => chaosFx.toggleReverb(on), 'REVERB');
        knob('reverbDecay', v => chaosFx.setReverbDecay(v));
        knob('reverbMix', v => chaosFx.setReverbMix(v));
        $('freezeBtn').addEventListener('click', () => {
            audioEngine.init();
            chaosFx.init();
            const frozen = !chaosFx.reverbFrozen;
            chaosFx.freezeReverb(frozen);
            $('freezeBtn').classList.toggle('is-on', frozen);
            flash(frozen ? 'REVERB FROZEN' : 'REVERB RELEASED');
        });

        toggle('gateToggle', on => chaosFx.toggleGate(on), 'TRANCE GATE');
        knob('gateDepth', v => chaosFx.setGateDepth(v));
        knob('gateSmooth', v => chaosFx.setGateSmooth(v));
        document.querySelectorAll('.gate-rate-btn').forEach(btn => {
            btn.addEventListener('click', () => { chaosFx.setGateRate(btn.dataset.rate); refreshGateSteps(); flash('GATE RATE 1/' + btn.dataset.rate); markDirty(); });
        });
        $('gatePreset').addEventListener('change', e => {
            const p = ChaosFX.GATE_PRESETS[e.target.value];
            if (p) { chaosFx.setGatePattern(p); refreshGateSteps(); markDirty(); flash('GATE · ' + e.target.value); }
        });
        $('gateRandom').addEventListener('click', () => { chaosFx.randomGatePattern(); refreshGateSteps(); markDirty(); flash('GATE · RANDOM'); });

        toggle('phaserToggle', on => chaosFx.togglePhaser(on), 'PHASER');
        knob('phaserRate', v => chaosFx.setPhaserRate(v));
        knob('phaserDepth', v => chaosFx.setPhaserDepth(v));
        knob('phaserMix', v => chaosFx.setPhaserMix(v));

        toggle('ringModToggle', on => chaosFx.toggleRingMod(on), 'RING MOD');
        knob('ringModFreq', v => chaosFx.setRingModFreq(v));
        knob('ringModMix', v => chaosFx.setRingModMix(v));

        toggle('waveFolderToggle', on => chaosFx.toggleWaveFolder(on), 'WAVE FOLDER');
        knob('foldAmount', v => chaosFx.setFoldAmount(v));
        knob('foldMix', v => chaosFx.setFoldMix(v));

        toggle('autoPanToggle', on => chaosFx.toggleAutoPan(on), 'AUTO PAN');
        knob('autoPanRate', v => chaosFx.setAutoPanRate(v));
        knob('autoPanDepth', v => chaosFx.setAutoPanDepth(v));

        // --- pattern chaos
        $('euclideanBtn').addEventListener('click', () => {
            const hits = parseInt($('euclideanHits').value);
            const rotate = parseInt($('euclideanRotate').value);
            const gate = chaosFx.euclidean(16, hits, rotate);
            let target = $('euclidTarget').value;
            if (target === 'random') {
                const pool = ['303', 'kick', 'snare', 'clap', 'hihat_c', 'hihat_o', 'rimshot', 'cowbell', 'tom_lo', 'tom_hi'];
                target = pool[Math.floor(Math.random() * pool.length)];
            }
            if (target === '303') {
                const iv = MusicGen.SCALES[state.scale].iv;
                const line = sequencer.pattern303.map((s, i) => {
                    const n = { ...s, active: gate[i] };
                    if (gate[i] && !s.active) {
                        const semis = i % 8 === 0 ? 0 : MusicGen.pick([0, 0, 0, ...iv]);
                        n.note = NOTES[(state.root + semis) % 12];
                        n.octave = state.selectedOctave;
                        n.accent = i % 4 === 0;
                    }
                    return n;
                });
                apply303(MusicGen.finishLine(line));
                flash('EUCLID ' + hits + '/16 → TB-303');
            } else {
                commit();
                sequencer.pattern808[target] = gate.map(v => v ? 1 : 0);
                refreshPadRow(target);
                markDirty();
                const inst = tr808.instruments.find(x => x.id === target);
                flash('EUCLID ' + hits + '/16 → ' + (inst ? inst.longName : target));
            }
        });

        $('mutateBtn').addEventListener('click', () => {
            const amount = parseInt($('mutateAmount').value);
            commit();
            withHistoryLock(() => {
                apply808(chaosFx.mutatePattern808(sequencer.pattern808, amount), sequencer.ext, sequencer.lens);
                apply303(chaosFx.mutatePattern303(sequencer.pattern303, amount, { root: state.root, scale: state.scale }));
            });
            flash('MUTATED ' + amount + '%');
        });
        const both = (f808, f303, fStab, label) => () => {
            commit();
            withHistoryLock(() => {
                apply808(f808(sequencer.pattern808), null, sequencer.lens);
                apply303(f303(sequencer.pattern303));
                if (fStab) applyStab(fStab(sequencer.patternStab));
            });
            flash(label);
        };
        $('reverseBtn').addEventListener('click', both(p => chaosFx.reversePattern808(p), l => chaosFx.reversePattern303(l), l => [...l].reverse(), 'REVERSED'));
        $('palindromeBtn').addEventListener('click', both(p => chaosFx.palindromePattern808(p), l => chaosFx.palindromePattern303(l), null, 'PALINDROME'));
        $('shiftLBtn').addEventListener('click', both(p => chaosFx.shiftPattern808(p, 'left'), l => chaosFx.shiftPattern303(l, 'left'), l => { const a = l.map(s => ({ ...s })); a.push(a.shift()); return a; }, 'SHIFT ◀'));
        $('shiftRBtn').addEventListener('click', both(p => chaosFx.shiftPattern808(p, 'right'), l => chaosFx.shiftPattern303(l, 'right'), l => { const a = l.map(s => ({ ...s })); a.unshift(a.pop()); return a; }, 'SHIFT ▶'));
        $('randomAcidBtn').addEventListener('click', () => {
            apply303(MusicGen.generateLine({ root: state.root, scale: state.scale, density: MusicGen.pick(['mid', 'dense']) }));
            flash('ACID LINE · ' + NOTES[state.root] + ' ' + MusicGen.SCALES[state.scale].name);
        });

        knob('probability', v => {
            chaosFx.setProbability(v);
            sequencer.probabilityFn = v >= 100 ? null : () => chaosFx.shouldTrigger();
        });

        // --- modulators / time warp
        $('chaosLFOToggle').addEventListener('click', () => {
            const on = !chaosFx.chaosLFOEnabled;
            if (on) chaosFx.startChaosLFO(tb303, () => { if (!(state.plock && state.selectedStep303 !== null)) syncTB303Knobs(); }); else chaosFx.stopChaosLFO();
            setToggleUI($('chaosLFOToggle'), on);
            flash('CHAOS LFO' + (on ? ' ON' : ' OFF'));
        });
        $('glitchJumpToggle').addEventListener('click', () => {
            const on = !chaosFx.glitchJumpEnabled;
            chaosFx.toggleGlitchJump(on);
            sequencer.glitchJumpFn = on ? (() => Math.random() < 0.08) : null;
            setToggleUI($('glitchJumpToggle'), on);
            flash('GLITCH JUMP' + (on ? ' ON' : ' OFF'));
        });
        toggle('earthquakeToggle', on => chaosFx.toggleEarthquake(on), 'EARTHQUAKE');

        fxToggleFns.polyToggle = on => {
            chaosFx.polyEnabled = on;
            sequencer.steps303 = on ? chaosFx.polySteps : 16;
            updateBassGridDisplay();
        };
        $('polyToggle').addEventListener('click', () => {
            fxToggleFns.polyToggle(!chaosFx.polyEnabled);
            setToggleUI($('polyToggle'), chaosFx.polyEnabled);
            flash(chaosFx.polyEnabled ? 'POLY · 303 = ' + chaosFx.polySteps + ' STEPS' : 'POLY OFF');
            markDirty();
        });
        knob('polySteps', v => {
            chaosFx.polySteps = v;
            if (chaosFx.polyEnabled) { sequencer.steps303 = v; updateBassGridDisplay(); }
        });

        const setStretch = pct => {
            Knobs.set('timeStretch', pct);
            sequencer.setStretch(pct);
            chaosFx.timeStretch = pct;
            ['halftimeBtn', 'doubletimeBtn', 'tripletBtn'].forEach(id => $(id).classList.remove('active'));
            if (pct === 50) $('halftimeBtn').classList.add('active');
            if (pct === 200) $('doubletimeBtn').classList.add('active');
            if (pct === 150) $('tripletBtn').classList.add('active');
        };
        knob('timeStretch', v => setStretch(v));
        $('halftimeBtn').addEventListener('click', () => { setStretch(sequencer.stretch === 0.5 ? 100 : 50); flash('SPEED ' + Math.round(sequencer.stretch * 100) + '%'); });
        $('doubletimeBtn').addEventListener('click', () => { setStretch(sequencer.stretch === 2 ? 100 : 200); flash('SPEED ' + Math.round(sequencer.stretch * 100) + '%'); });
        $('tripletBtn').addEventListener('click', () => { setStretch(sequencer.stretch === 1.5 ? 100 : 150); flash('SPEED ' + Math.round(sequencer.stretch * 100) + '%'); });

        $('screamBtn').addEventListener('click', () => {
            commit();
            chaosFx.screamMode(tb303);
            syncTB303Knobs();
            markDirty();
            flash('SCREAM!!!');
        });
        $('robotModeBtn').addEventListener('click', () => {
            commit();
            withHistoryLock(() => {
                chaosFx.robotAcid(tb303, 'acid');
                apply303(MusicGen.generateLine({ root: state.root, scale: state.scale, density: 'dense' }));
            });
            syncTB303Knobs();
            flash('ROBOT ACID');
            $('app').classList.add('robot-active');
            setTimeout(() => $('app').classList.remove('robot-active'), 1600);
        });
        $('drunkModeBtn').addEventListener('click', () => {
            const on = chaosFx.drunkify(sequencer);
            $('drunkModeBtn').classList.toggle('is-on', on);
            $('app').classList.toggle('drunk-active', on);
            flash(on ? 'DRUNK MODE · TEMPO & SWING WOBBLE' : 'SOBERING UP');
        });
        $('randomizeAllBtn').addEventListener('click', () => {
            const opts = state.locks.d303 ? { root: state.root, scale: state.scale } : {};
            applyComposition(MusicGen.compose(opts));
            $('app').classList.add('shake');
            setTimeout(() => $('app').classList.remove('shake'), 400);
        });
    }

    // ============================================================ system (file / rec / midi / display)
    function bindSystem() {
        $('exportJsonBtn').addEventListener('click', exportJson);
        $('importJsonBtn').addEventListener('click', () => $('importFile').click());
        $('importFile').addEventListener('change', e => {
            const file = e.target.files && e.target.files[0];
            if (file) importJsonFile(file);
            e.target.value = '';
        });
        $('shareUrlBtn').addEventListener('click', shareUrl);

        $('recLength').addEventListener('change', e => { state.recLength = e.target.value; markDirty(); });

        $('scopeMode').addEventListener('change', e => { state.scopeMode = e.target.value; markDirty(); });
        $('lcdScope').addEventListener('click', () => {
            const order = ['scope', 'spectrum', 'off'];
            state.scopeMode = order[(order.indexOf(state.scopeMode) + 1) % order.length];
            $('scopeMode').value = state.scopeMode;
            flash('LCD · ' + state.scopeMode.toUpperCase());
            markDirty();
        });

        $('resetAllBtn').addEventListener('click', () => {
            if (!confirm('保存データを消去して初期状態に戻しますか？（サンプルは残ります）')) return;
            try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ }
            state.dirty = false;
            window.removeEventListener('beforeunload', saveNow);
            location.href = location.pathname;
        });

        // --- MIDI
        $('midiOut').addEventListener('change', e => { midi.setOutput(e.target.value); markDirty(); flash(e.target.value ? 'MIDI OUT → ' + e.target.selectedOptions[0].textContent : 'MIDI OUT OFF'); });
        $('midiIn').addEventListener('change', e => { midi.setInput(e.target.value); markDirty(); flash(e.target.value ? 'MIDI IN ← ' + e.target.selectedOptions[0].textContent : 'MIDI IN OFF'); });
        $('midiClockToggle').addEventListener('click', () => { midi.clockOut = !midi.clockOut; setToggleUI($('midiClockToggle'), midi.clockOut); markDirty(); });
        $('midiNotesToggle').addEventListener('click', () => { midi.notesOut = !midi.notesOut; setToggleUI($('midiNotesToggle'), midi.notesOut); markDirty(); });
        $('midiLearnBtn').addEventListener('click', () => {
            if (!midi.supported) { flash('WEB MIDI NOT SUPPORTED IN THIS BROWSER'); return; }
            if (!midi.inId) { flash('SELECT A MIDI INPUT FIRST'); return; }
            state.midiLearn = !state.midiLearn;
            if (!state.midiLearn) midi.cancelLearn();
            $('midiLearnBtn').classList.toggle('is-on', state.midiLearn);
            flash(state.midiLearn ? 'LEARN: GRAB A KNOB ON SCREEN, THEN MOVE A MIDI CONTROL' : 'LEARN OFF');
        });
        $('midiClearBtn').addEventListener('click', () => { midi.clearMappings(); refreshMidiMapList(); flash('MIDI MAPPINGS CLEARED'); });
        $('midiMapList').addEventListener('click', e => {
            const btn = e.target.closest('[data-forget]');
            if (btn) { midi.forget(btn.dataset.forget); refreshMidiMapList(); }
        });
    }

    function initMidi() {
        if (!midi.supported) {
            $('midiStatus').textContent = 'WEB MIDI NOT SUPPORTED';
            $('midiOut').disabled = true;
            $('midiIn').disabled = true;
            return;
        }
        $('midiStatus').textContent = 'REQUESTING ACCESS…';
        midi.onDevices = refreshMidiUI;
        midi.onLearned = (key, id) => { refreshMidiMapList(); flash('MAPPED CC ' + key.split(':')[1] + ' → ' + (Knobs.element(id) ? Knobs.element(id).getAttribute('aria-label') : id)); };
        midi.onCC = (id, t) => { Knobs.setNormalized(id, t, { emit: true }); };
        midi.onNote = (n, vel, on) => {
            if (!on) { if (!sequencer.isPlaying) tb303.allNotesOff(); return; }
            audioEngine.init();
            tb303.init();
            const octave = Math.max(1, Math.min(3, Math.floor(n / 12) - 1));
            const note = NOTES[n % 12];
            tb303.trigger(note, octave, audioEngine.currentTime + 0.005, { accent: vel > 0.8, gate: 0.4, velocity: Math.max(0.3, vel), force: true });
            if (!sequencer.isPlaying) { setNoteUI(note); setOctaveUI(octave); }
        };
        midi.init().then(access => {
            if (!access) { $('midiStatus').textContent = 'MIDI ACCESS DENIED'; return; }
            refreshMidiUI();
            if (state.pendingMidi) {
                midi.setOutput(state.pendingMidi.outId);
                midi.setInput(state.pendingMidi.inId);
                refreshMidiUI();
            }
        });
    }

    function refreshMidiUI() {
        const outSel = $('midiOut'), inSel = $('midiIn');
        const fill = (sel, list, cur) => {
            sel.innerHTML = '<option value="">— NONE —</option>';
            list.forEach(d => {
                const o = document.createElement('option');
                o.value = d.id;
                o.textContent = d.name;
                sel.appendChild(o);
            });
            sel.value = cur || '';
        };
        fill(outSel, midi.outputs, midi.outId);
        fill(inSel, midi.inputs, midi.inId);
        $('midiStatus').textContent = 'MIDI OK · ' + midi.outputs.length + ' OUT · ' + midi.inputs.length + ' IN';
        setToggleUI($('midiClockToggle'), midi.clockOut);
        setToggleUI($('midiNotesToggle'), midi.notesOut);
        refreshMidiMapList();
    }

    function refreshMidiMapList() {
        const box = $('midiMapList');
        const keys = Object.keys(midi.mappings);
        if (!keys.length) { box.innerHTML = '<span class="hint">NO CC MAPPINGS YET</span>'; return; }
        box.innerHTML = keys.map(k => {
            const [ch, cc] = k.split(':');
            const id = midi.mappings[k].id;
            const el = Knobs.element(id);
            const name = el ? el.getAttribute('aria-label') : id;
            return '<span class="midi-map">CH' + (parseInt(ch) + 1) + ' CC' + cc + ' → ' + name + ' <button class="rc" data-forget="' + id + '" title="削除">×</button></span>';
        }).join('');
    }

    // --- recording
    function barsForRecLength() {
        switch (state.recLength) {
            case '1': return 1;
            case '4': return 4;
            case '8': return 8;
            case 'chain': return sequencer.chain.bars * 4;
            case 'song': return sequencer.song.bars || 32;
            default: return null;
        }
    }

    function toggleRecording() {
        if (recorder.recording) { finishRecording(); return; }
        audioEngine.init();
        audioEngine.resume();
        const bars = barsForRecLength();
        state.recBars = bars;
        state.recBarCount = 0;
        if (!sequencer.isPlaying) {
            if (!recorder.start()) { flash('RECORDER UNAVAILABLE'); return; }
            startPlayback();
        } else if (!recorder.start()) { flash('RECORDER UNAVAILABLE'); return; }
        $('recBtn').classList.add('is-on');
        $('recBtn2').classList.add('is-on');
        $('ledRec').classList.add('is-on');
        flash('RECORDING' + (bars ? ' · ' + bars + ' BARS' : ' · PRESS REC AGAIN TO STOP'));
    }

    function finishRecording() {
        const blob = recorder.stop();
        state.recBars = null;
        $('recBtn').classList.remove('is-on');
        $('recBtn2').classList.remove('is-on');
        $('ledRec').classList.remove('is-on');
        if (!blob) return;
        const secs = recorder.duration;
        const name = 'synthseq-' + MusicGen.STYLES[state.style].name.toLowerCase() + '-' + sequencer.bpm + 'bpm-' + stamp() + '.wav';
        downloadBlob(blob, name);
        flash('WAV SAVED · ' + secs.toFixed(1) + 's · ' + name);
        $('recStatus').textContent = 'SAVED ' + secs.toFixed(1) + 's';
    }

    function stamp() {
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    function downloadBlob(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    }

    // --- JSON export / import
    function exportJson() {
        const data = serialize();
        data.exportedAt = new Date().toISOString();
        data.app = 'SYNTH SEQUENCER MK-III';
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const name = 'synthseq-' + MusicGen.STYLES[state.style].name.toLowerCase() + '-' + NOTES[state.root].replace('#', 's') + '-' + sequencer.bpm + 'bpm-' + stamp() + '.json';
        downloadBlob(blob, name);
        flash('JSON EXPORTED · ' + name);
    }

    function importJsonFile(file) {
        file.text().then(text => {
            let data;
            try { data = JSON.parse(text); } catch (e) { flash('IMPORT FAILED: NOT VALID JSON'); return; }
            importData(data, file.name);
        }).catch(() => flash('IMPORT FAILED: CANNOT READ FILE'));
    }

    function importData(data, label = 'JSON') {
        if (!data || typeof data !== 'object' || !data.seq || ![3, 4].includes(data.v)) { flash('IMPORT FAILED: NOT A SYNTH SEQUENCER FILE'); return false; }
        commit();
        const wasPlaying = sequencer.isPlaying;
        if (wasPlaying) stopPlayback();
        applyState(data);
        markDirty();
        flash('IMPORTED · ' + label.toUpperCase());
        return true;
    }

    // --- share URL
    function b64url(bytes) {
        let s = '';
        const arr = new Uint8Array(bytes);
        for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function unb64url(str) {
        str = str.replace(/-/g, '+').replace(/_/g, '/');
        while (str.length % 4) str += '=';
        const bin = atob(str);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    async function compressState(json) {
        const bytes = new TextEncoder().encode(json);
        if (window.CompressionStream) {
            const cs = new CompressionStream('deflate-raw');
            const w = cs.writable.getWriter();
            w.write(bytes);
            w.close();
            const buf = await new Response(cs.readable).arrayBuffer();
            return 'z' + b64url(buf);
        }
        return 'j' + b64url(bytes);
    }
    async function decompressState(str) {
        const kind = str[0];
        const bytes = unb64url(str.slice(1));
        if (kind === 'z') {
            if (!window.DecompressionStream) throw new Error('no DecompressionStream');
            const ds = new DecompressionStream('deflate-raw');
            const w = ds.writable.getWriter();
            w.write(bytes);
            w.close();
            return await new Response(ds.readable).text();
        }
        return new TextDecoder().decode(bytes);
    }

    async function shareUrl() {
        try {
            const data = serialize();
            delete data.fx.knobs.probability;
            const payload = await compressState(JSON.stringify(data));
            const url = location.origin + location.pathname + '#s=' + payload;
            if (url.length > 32000) { flash('STATE TOO LARGE FOR A URL · USE EXPORT JSON'); return; }
            try {
                await navigator.clipboard.writeText(url);
                flash('SHARE URL COPIED · ' + Math.round(url.length / 1024 * 10) / 10 + ' KB');
            } catch (e) {
                prompt('この URL をコピーしてください', url);
            }
        } catch (e) {
            flash('SHARE FAILED');
        }
    }

    async function checkHashImport() {
        const m = location.hash.match(/^#s=([A-Za-z0-9_\-]+)/);
        if (!m) return;
        try {
            const json = await decompressState(m[1]);
            const data = JSON.parse(json);
            window.history.replaceState(null, '', location.pathname + location.search);
            if (importData(data, 'SHARED URL')) saveNow();
        } catch (e) {
            flash('SHARED URL COULD NOT BE READ');
        }
    }

    // --- drag & drop (JSON anywhere, audio onto the drum grid sample rows)
    function bindDragDrop() {
        window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drop-target'); });
        window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('drop-target'); });
        window.addEventListener('drop', e => {
            e.preventDefault();
            document.body.classList.remove('drop-target');
            const file = e.dataTransfer.files && e.dataTransfer.files[0];
            if (!file) return;
            if (/\.json$/i.test(file.name) || file.type === 'application/json') { importJsonFile(file); return; }
            if (/^audio\//.test(file.type) || /\.(wav|mp3|aif|aiff|ogg|flac|m4a)$/i.test(file.name)) {
                const row = e.target.closest ? e.target.closest('.drum-row.smp-row') : null;
                let idx = 0;
                if (row) {
                    const pad = row.querySelector('.pad');
                    if (pad) idx = tr808.sampleIndex(pad.dataset.instrument);
                } else {
                    idx = [0, 1, 2, 3].find(i => !sampler.hasSample(i));
                    if (idx === undefined) idx = 0;
                }
                loadSampleFile(idx, file);
            }
        });
    }

    // ============================================================ keyboard
    function bindKeyboard() {
        document.addEventListener('keydown', e => {
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
            if (e.target.classList && e.target.classList.contains('knob')) return;
            const meta = e.metaKey || e.ctrlKey;
            if (meta && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
            if (meta && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
            if (meta || e.altKey) return;
            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    if (e.repeat) return;
                    if (sequencer.isPlaying) stopPlayback(); else startPlayback();
                    break;
                case '1': switchMode('instruments'); break;
                case '2': switchMode('mixer'); break;
                case '3': switchMode('fx'); break;
                case '4': switchMode('system'); break;
                case 'f': case 'F': if (!e.repeat) window.fillStart(); break;
                case 'r': case 'R': if (!e.repeat) toggleRecording(); break;
                case 't': case 'T': if (!e.repeat) tapTempo(); break;
                case 'ArrowLeft':
                    e.preventDefault();
                    selectPattern((sequencer.currentPattern808 + 3) % 4);
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    selectPattern((sequencer.currentPattern808 + 1) % 4);
                    break;
                case 'Escape':
                    state.selectedStep303 = null;
                    state.selectedStepStab = null;
                    updateBassGridDisplay();
                    updateStabGridDisplay();
                    showLockKnobs();
                    break;
            }
        });
        document.addEventListener('keyup', e => {
            if (e.key === 'f' || e.key === 'F') window.fillEnd();
        });
    }

    function switchMode(mode) {
        state.mode = mode;
        document.querySelectorAll('.mode-btn').forEach(btn => {
            const on = btn.dataset.mode === mode;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.querySelectorAll('.sequencer-section').forEach(sec => sec.classList.toggle('active', sec.dataset.mode === mode));
        markDirty();
    }

    // ============================================================ draw loop
    let lastBpmText = '';
    let beatTimer = 0;
    let scopeBuf = null;
    let lastFilterShown = null;
    let lastRecText = '';

    function frame() {
        const now = audioEngine.currentTime;

        let latest = null;
        while (drawQueue.length && drawQueue[0].t <= now + 0.004) latest = drawQueue.shift();
        if (latest) {
            highlightTick(latest.tick);
            if (latest.tick % 4 === 0) {
                $('ledBeat').classList.add('is-on');
                beatTimer = now + 0.08;
            }
        }
        if (beatTimer && now > beatTimer) { $('ledBeat').classList.remove('is-on'); beatTimer = 0; }

        while (patQueue.length && patQueue[0].t <= now + 0.004) {
            const ev = patQueue.shift();
            if (ev.idx !== undefined) {
                refreshPatternUI(ev.idx);
                state.selectedStep303 = null;
                state.selectedStepStab = null;
                refreshGrids();
            }
            if (ev.bar !== undefined) {
                if (ev.info && ev.info.section) {
                    $('lcdBar').textContent = (ev.info.songBar + 1) + '/' + ev.info.total;
                } else {
                    const bars = sequencer.chain.enabled ? sequencer.chain.bars : 0;
                    $('lcdBar').textContent = bars ? (((ev.bar - 1) % bars) + 1) + '/' + bars : String(ev.bar);
                }
            }
            if (ev.section) {
                $('lcdSection').textContent = ev.section.name;
                if (ev.section.delay !== null && ev.section.delay !== undefined) setFxToggle('delayToggle', ev.section.delay);
                if (ev.section.reverb !== null && ev.section.reverb !== undefined) setFxToggle('reverbToggle', ev.section.reverb);
                refreshMixerUI();
                flash(ev.section.name + (ev.section.mutes.length ? ' · ' + ev.section.mutes.length + ' PARTS MUTED' : ' · FULL'), 1500);
            }
        }

        const bpmText = sequencer.effectiveBpm.toFixed(1);
        if (bpmText !== lastBpmText) { $('lcdBpm').textContent = bpmText; lastBpmText = bpmText; }

        if (audioEngine.filterAuto && sequencer.isPlaying) {
            const v = Math.round(audioEngine.displayFilterValue());
            if (v !== lastFilterShown) { Knobs.set('masterFilter', v); lastFilterShown = v; }
        }

        if (recorder.recording) {
            const t = 'REC ' + recorder.duration.toFixed(1) + 's' + (state.recBars ? ' · ' + Math.min(state.recBarCount, state.recBars) + '/' + state.recBars : '');
            if (t !== lastRecText) { $('recStatus').textContent = t; lastRecText = t; }
        }

        drawScope();
        requestAnimationFrame(frame);
    }

    function drawScope() {
        const canvas = $('lcdScope');
        const ctx2d = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        if (state.scopeMode === 'off' || !audioEngine.analyser) {
            if (canvas.dataset.cleared !== '1') { ctx2d.clearRect(0, 0, w, h); canvas.dataset.cleared = '1'; }
            return;
        }
        canvas.dataset.cleared = '0';
        const an = audioEngine.analyser;
        ctx2d.clearRect(0, 0, w, h);
        ctx2d.lineWidth = 1.5;
        ctx2d.strokeStyle = 'rgba(255,182,58,0.9)';
        ctx2d.fillStyle = 'rgba(255,182,58,0.75)';
        if (state.scopeMode === 'scope') {
            if (!scopeBuf || scopeBuf.length !== an.fftSize) scopeBuf = new Uint8Array(an.fftSize);
            an.getByteTimeDomainData(scopeBuf);
            ctx2d.beginPath();
            const n = scopeBuf.length;
            for (let i = 0; i < n; i++) {
                const x = (i / (n - 1)) * w;
                const y = h / 2 + ((scopeBuf[i] - 128) / 128) * (h / 2 - 1);
                if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
            }
            ctx2d.stroke();
        } else {
            const bins = an.frequencyBinCount;
            if (!scopeBuf || scopeBuf.length !== bins) scopeBuf = new Uint8Array(bins);
            an.getByteFrequencyData(scopeBuf);
            const bars = 48;
            const bw = w / bars;
            for (let b = 0; b < bars; b++) {
                const lo = Math.floor(Math.pow(bins, b / bars));
                const hi = Math.max(lo + 1, Math.floor(Math.pow(bins, (b + 1) / bars)));
                let peak = 0;
                for (let i = lo; i < hi && i < bins; i++) peak = Math.max(peak, scopeBuf[i]);
                const bh = (peak / 255) * (h - 2);
                ctx2d.fillRect(b * bw + 1, h - bh, bw - 2, bh);
            }
        }
    }

    function highlightTick(tick) {
        // drums: each row has its own length
        tr808.instruments.forEach(inst => {
            const pads = dom.padRows[inst.id];
            if (!pads) return;
            const step = tick % sequencer.getLen(inst.id);
            const prev = state.rowCur[inst.id];
            if (prev === step) return;
            if (prev !== undefined && prev >= 0) pads[prev].classList.remove('current');
            pads[step].classList.add('current');
            state.rowCur[inst.id] = step;
        });
        const s = tick % 16;
        const s3 = tick % sequencer.steps303;
        const st = tick % 16;
        const prev = state.last;
        if (prev.s >= 0 && prev.s !== s) {
            dom.dots808[prev.s].classList.remove('active');
            dom.lcdSteps[prev.s].classList.remove('active');
            dom.dotsStab[prev.s].classList.remove('active');
            dom.stabCols[prev.s].forEach(b => b.classList.remove('current'));
        }
        if (prev.s3 >= 0 && prev.s3 !== s3 && prev.s3 < 16) {
            dom.bassCols[prev.s3].forEach(b => b.classList.remove('current'));
            dom.dots303[prev.s3].classList.remove('active');
        }
        if (prev.s !== s) {
            dom.dots808[s].classList.add('active');
            dom.lcdSteps[s].classList.add('active');
            dom.dotsStab[st].classList.add('active');
            dom.stabCols[st].forEach(b => b.classList.add('current'));
        }
        if (prev.s3 !== s3 && s3 < 16) {
            dom.bassCols[s3].forEach(b => b.classList.add('current'));
            dom.dots303[s3].classList.add('active');
        }
        state.last = { s, s3, st };
    }

    function clearStepHighlights() {
        document.querySelectorAll('.current').forEach(el => el.classList.remove('current'));
        document.querySelectorAll('.step-dot.active, .lcd-steps .active').forEach(el => el.classList.remove('active'));
        state.last = { s: -1, s3: -1, st: -1 };
        state.rowCur = {};
    }

    // ============================================================ persistence
    function markDirty() { state.dirty = true; }

    function collectFxState() {
        const knobs = {};
        FX_KNOBS.forEach(id => { const el = $(id); if (el) knobs[id] = parseFloat(el.value); });
        const toggles = {};
        FX_TOGGLES.forEach(id => { const el = $(id); if (el) toggles[id] = el.classList.contains('active'); });
        return { knobs, toggles, delayMode: chaosFx.delayMode, gateRate: chaosFx.gateRate, gatePattern: chaosFx.gatePattern.slice() };
    }

    function applyFxState(fx) {
        if (!fx) return;
        if (fx.knobs) Object.keys(fx.knobs).forEach(id => { if (FX_KNOBS.includes(id) && $(id) && Number.isFinite(fx.knobs[id])) Knobs.set(id, fx.knobs[id], { emit: true }); });
        if (fx.delayMode) {
            chaosFx.setDelayMode(fx.delayMode);
            document.querySelectorAll('.delay-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === fx.delayMode));
        }
        if (fx.gateRate) chaosFx.setGateRate(fx.gateRate);
        if (Array.isArray(fx.gatePattern)) chaosFx.setGatePattern(fx.gatePattern);
        if (fx.toggles) Object.keys(fx.toggles).forEach(id => { if (FX_TOGGLES.includes(id)) setFxToggle(id, !!fx.toggles[id]); });
        refreshGateSteps();
    }

    function serialize() {
        return {
            v: 4,
            seq: sequencer.toJSON(),
            tb303: tb303.getParams(),
            stab: stab.getParams(),
            sampler: sampler.getParams(),
            kits: tr808.getKits(),
            mix: audioEngine.mix,
            sidechain: { ...audioEngine.sidechain },
            filter: state.userFilter,
            master: audioEngine.masterVolume,
            root: state.root,
            scale: state.scale,
            randomKey: state.randomKey,
            randomScale: state.randomScale,
            style: state.style,
            octave: state.selectedOctave,
            note: state.selectedNote,
            mode: state.mode,
            editMode: state.editMode,
            plock: state.plock,
            locks: { ...state.locks },
            fx: collectFxState(),
            scopeMode: state.scopeMode,
            recLength: state.recLength,
            songBars: state.songBars,
            midi: { outId: midi.outId, inId: midi.inId, clockOut: midi.clockOut, notesOut: midi.notesOut }
        };
    }

    function saveNow() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
            state.dirty = false;
            const el = $('autosaveLabel');
            el.classList.add('saved');
            setTimeout(() => el.classList.remove('saved'), 600);
        } catch (e) { /* storage unavailable */ }
    }

    function freshComposition() {
        const c = MusicGen.compose({ style: 'techno' });
        withHistoryLock(() => {
            c.patterns808.forEach((p, i) => sequencer.setPattern808(i, p));
            c.patterns303.forEach((l, i) => sequencer.setPattern303(i, l));
            c.patternsStab.forEach((l, i) => sequencer.setPatternStab(i, l));
            sequencer.setBPM(c.bpm);
            sequencer.setSwing(c.swing);
            sequencer.setChainBars(4);
            sequencer.chain.enabled = true;
            state.root = c.root;
            state.scale = c.scale;
            state.style = c.style;
            tb303.setParams(c.synth);
            stab.setParams(c.stab);
            tr808.setKits(c.kit);
            state.selectedOctave = 1;
            audioEngine.setSidechain({ enabled: true, depth: 0.45, release: 0.16 });
        });
    }

    function applyState(data) {
        withHistoryLock(() => {
            sequencer.fromJSON(data.seq);
            if (data.tb303) {
                tb303.setParams(data.tb303);
                if (data.v === 3 && typeof data.tb303.level === 'number') audioEngine.setLevel('303', data.tb303.level);
            }
            if (data.stab) stab.setParams(data.stab);
            if (data.sampler) sampler.setParams(data.sampler);
            if (data.kits) tr808.setKits(data.kits);
            if (data.volumes) Object.keys(data.volumes).forEach(k => { if (CHANNEL_IDS.includes(k)) audioEngine.setLevel(k, data.volumes[k]); });
            if (data.mix && typeof data.mix === 'object') {
                Object.keys(data.mix).forEach(id => {
                    if (!CHANNEL_IDS.includes(id)) return;
                    const src = data.mix[id] || {};
                    const m = audioEngine.mixState(id);
                    if (typeof src.level === 'number') m.level = Math.max(0, Math.min(1, src.level));
                    if (typeof src.pan === 'number') m.pan = Math.max(-1, Math.min(1, src.pan));
                    if (typeof src.sendDelay === 'number') m.sendDelay = Math.max(0, Math.min(1, src.sendDelay));
                    if (typeof src.sendReverb === 'number') m.sendReverb = Math.max(0, Math.min(1, src.sendReverb));
                    m.mute = !!src.mute;
                    m.solo = !!src.solo;
                    m.autoMute = false;
                });
                audioEngine._applyAll();
            }
            if (data.sidechain) audioEngine.setSidechain(data.sidechain);
            if (typeof data.filter === 'number') { state.userFilter = Math.max(-100, Math.min(100, data.filter)); audioEngine.setFilter(state.userFilter); }
            if (typeof data.master === 'number') { audioEngine.masterVolume = Math.max(0, Math.min(1, data.master)); audioEngine.setMasterVolume(audioEngine.masterVolume); }
            if (Number.isInteger(data.root)) state.root = Math.max(0, Math.min(11, data.root));
            if (MusicGen.SCALES[data.scale]) state.scale = data.scale;
            state.randomKey = !!data.randomKey;
            state.randomScale = !!data.randomScale;
            if (MusicGen.STYLES[data.style]) state.style = data.style;
            if ([1, 2, 3].includes(data.octave)) state.selectedOctave = data.octave;
            if (NOTES.includes(data.note)) state.selectedNote = data.note;
            if (['trig', 'prob', 'ratchet', 'len'].includes(data.editMode)) state.editMode = data.editMode;
            state.plock = !!data.plock;
            if (data.locks) Object.keys(state.locks).forEach(k => { state.locks[k] = !!data.locks[k]; });
            if (['scope', 'spectrum', 'off'].includes(data.scopeMode)) state.scopeMode = data.scopeMode;
            if (typeof data.recLength === 'string') state.recLength = data.recLength;
            if ([32, 64].includes(data.songBars)) state.songBars = data.songBars;
            if (data.midi) {
                midi.clockOut = data.midi.clockOut !== false;
                midi.notesOut = data.midi.notesOut !== false;
                state.pendingMidi = { outId: data.midi.outId || '', inId: data.midi.inId || '' };
                if (midi.access) { midi.setOutput(state.pendingMidi.outId); midi.setInput(state.pendingMidi.inId); }
            }
            applyFxState(data.fx);
            if (['instruments', 'mixer', 'fx', 'system'].includes(data.mode)) switchMode(data.mode);
        });
        state.selectedStep303 = null;
        state.selectedStepStab = null;
        chaosFx.updateDelay(sequencer.bpm);
        syncAllControls();
        refreshPatternUI(sequencer.currentPattern808);
        refreshGrids();
        refreshDrumLabels();
        if (midi.access) refreshMidiUI();
    }

    function loadState() {
        let data = null;
        try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { data = null; }
        if (!data) {
            try { data = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); } catch (e) { data = null; }
        }
        if (!data || ![3, 4].includes(data.v) || !data.seq) {
            freshComposition();
            syncAllControls();
            refreshPatternUI(0);
            refreshGrids();
            refreshDrumLabels();
            return;
        }
        try {
            applyState(data);
        } catch (e) {
            console.warn('state restore failed', e);
            freshComposition();
            syncAllControls();
            refreshGrids();
        }
    }

    function bindPersistence() {
        setInterval(() => { if (state.dirty) saveNow(); }, 1500);
        window.addEventListener('beforeunload', saveNow);
        window.addEventListener('beforeunload', () => {
            chaosFx.stopChaosLFO();
            if (chaosFx.earthquakeOn) chaosFx.toggleEarthquake(false);
            midi.stop();
        });
    }
});
