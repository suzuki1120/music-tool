/**
 * app.js — UI wiring, draw loop, persistence.
 */
document.addEventListener('DOMContentLoaded', () => {
    const tr808 = new TR808(audioEngine);
    const tb303 = new TB303(audioEngine);
    const chaosFx = new ChaosFX(audioEngine);
    const sequencer = new Sequencer(audioEngine, tr808, tb303);

    audioEngine.onInit = () => {
        chaosFx.init();
        tr808.init();
        tb303.init();
        chaosFx.updateDelay(sequencer.bpm);
    };

    const NOTES = MusicGen.NOTES;
    const PATTERN_NAMES = ['A1', 'A2', 'B1', 'B2'];
    const STORAGE_KEY = 'synthseq.v3';
    const $ = id => document.getElementById(id);

    const state = {
        mode: 'instruments',
        selectedNote: 'A',
        selectedOctave: 1,
        selectedStep303: null,
        root: 9,
        scale: 'minorPenta',
        style: 'techno',
        clip808: null,
        clip303: null,
        dirty: false,
        paint: null,
        lastHighlight: { s: -1, s3: -1 }
    };

    // cached DOM for the draw loop
    const dom = { padCols: [], bassCols: [], dots808: [], dots303: [], lcdSteps: [] };
    const drawQueue = [];
    const patQueue = [];

    // ============================================================ init
    buildSelects();
    loadState();
    buildStepIndicators();
    buildDrumGrid();
    buildDrumMixer();
    buildBassGrid();
    buildNoteSelect();
    buildPatternButtons();
    Knobs.enhanceAll(document);
    syncAllControls();
    bindTransport();
    bindInstruments();
    bindChaosFX();
    bindKeyboard();
    bindPersistence();
    requestAnimationFrame(frame);
    updateLCDStatic();

    // unlock audio on the first gesture so previews work before PLAY
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
        NOTES.forEach((n, i) => {
            const o = document.createElement('option');
            o.value = i;
            o.textContent = n;
            keySel.appendChild(o);
        });
        const scaleSel = $('scaleSelect');
        Object.keys(MusicGen.SCALES).forEach(k => {
            const o = document.createElement('option');
            o.value = k;
            o.textContent = MusicGen.SCALES[k].name;
            scaleSel.appendChild(o);
        });
    }

    function buildStepIndicators() {
        const lcd = $('lcdSteps');
        [['stepIndicator808', dom.dots808], ['stepIndicator303', dom.dots303]].forEach(([id, store]) => {
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
        ['patBtns808', 'patBtns303'].forEach(id => {
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

    function buildDrumGrid() {
        const grid = $('drumGrid');
        grid.innerHTML = '';
        dom.padCols = Array.from({ length: 16 }, () => []);

        tr808.instruments.forEach(inst => {
            const row = document.createElement('div');
            row.className = 'drum-row';

            const label = document.createElement('div');
            label.className = 'drum-label';
            label.innerHTML = inst.name + '<small>' + inst.longName + '</small>';
            label.title = inst.longName + ' — クリックで試聴';
            label.style.cursor = 'pointer';
            label.addEventListener('click', () => previewDrum(inst.id, false));
            row.appendChild(label);

            for (let step = 0; step < 16; step++) {
                const pad = document.createElement('button');
                pad.className = 'pad';
                pad.dataset.instrument = inst.id;
                pad.dataset.step = step;
                pad.dataset.group = Math.floor(step / 4);
                pad.setAttribute('aria-label', inst.longName + ' step ' + (step + 1));
                applyPadClass(pad, sequencer.pattern808[inst.id][step]);
                pad.addEventListener('contextmenu', e => e.preventDefault());
                row.appendChild(pad);
                dom.padCols[step].push(pad);
            }
            grid.appendChild(row);
        });
    }

    function applyPadClass(pad, v) {
        pad.classList.toggle('on', v > 0);
        pad.classList.toggle('accent', v === 2);
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
            input.value = String(Math.round(tr808.volumes[inst.id] * 100));
            input.dataset.knob = '';
            input.dataset.size = 's';
            input.dataset.format = 'pct';
            input.dataset.default = String(Math.round(inst.defaultVol * 100));
            input.id = 'vol_' + inst.id;
            input.addEventListener('input', () => { tr808.setVolume(inst.id, input.value / 100); markDirty(); });
            const label = document.createElement('label');
            label.textContent = inst.name;
            label.title = inst.longName + ' LEVEL';
            wrap.appendChild(input);
            wrap.appendChild(label);
            mixer.appendChild(wrap);
        });
    }

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

        noteRow.querySelectorAll('.bass-step').forEach(btn => {
            const step = parseInt(btn.dataset.step);
            btn.addEventListener('click', () => handleBassStepClick(step));
            btn.addEventListener('contextmenu', () => {
                const s = sequencer.pattern303[step];
                if (s.active) { s.accent = !s.accent; updateBassGridDisplay(); markDirty(); }
            });
            btn.addEventListener('wheel', e => {
                const s = sequencer.pattern303[step];
                if (!s.active) return;
                e.preventDefault();
                transposeStep(s, e.deltaY < 0 ? 1 : -1);
                updateBassGridDisplay();
                previewBass(s);
                markDirty();
            }, { passive: false });
        });
        accentRow.querySelectorAll('.bass-step').forEach(btn => {
            const step = parseInt(btn.dataset.step);
            btn.addEventListener('click', () => {
                const s = sequencer.pattern303[step];
                s.accent = !s.accent;
                updateBassGridDisplay();
                markDirty();
            });
        });
        slideRow.querySelectorAll('.bass-step').forEach(btn => {
            const step = parseInt(btn.dataset.step);
            btn.addEventListener('click', () => {
                const s = sequencer.pattern303[step];
                s.slide = !s.slide;
                updateBassGridDisplay();
                markDirty();
            });
        });

        updateBassGridDisplay();
    }

    function updateBassGridDisplay() {
        const pattern = sequencer.pattern303;
        const limit = sequencer.steps303;
        for (let step = 0; step < 16; step++) {
            const s = pattern[step];
            const [noteBtn, accBtn, slideBtn] = dom.bassCols[step];
            noteBtn.className = 'bass-step note-step';
            noteBtn.textContent = '';
            if (s.active) {
                noteBtn.classList.add('on');
                noteBtn.textContent = s.note + s.octave;
                if (s.accent) noteBtn.classList.add('accent');
                if (s.slide) noteBtn.classList.add('slide');
            }
            if (state.selectedStep303 === step) noteBtn.classList.add('selected');
            accBtn.className = 'bass-step' + (s.accent ? ' on' : '') + (!s.active ? ' empty-mod' : '');
            slideBtn.className = 'bass-step' + (s.slide ? ' on' : '') + (!s.active ? ' empty-mod' : '');
            if (step >= limit) dom.bassCols[step].forEach(b => b.classList.add('beyond'));
        }
        if (state.lastHighlight.s3 >= 0) dom.bassCols[state.lastHighlight.s3].forEach(b => b.classList.add('current'));
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
                    const s = sequencer.pattern303[state.selectedStep303];
                    s.note = note;
                    s.octave = state.selectedOctave;
                    updateBassGridDisplay();
                    previewBass(s);
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

    // ============================================================ 303 editing
    function handleBassStepClick(step) {
        const pattern = sequencer.pattern303;
        const s = pattern[step];
        if (!s.active) {
            s.active = true;
            s.note = state.selectedNote;
            s.octave = state.selectedOctave;
            state.selectedStep303 = step;
            previewBass(s);
        } else if (state.selectedStep303 === step) {
            s.active = false;
            s.accent = false;
            s.slide = false;
            state.selectedStep303 = null;
        } else {
            // select existing note — palette follows the note
            state.selectedStep303 = step;
            state.selectedNote = s.note;
            setOctaveUI(s.octave);
            $('noteSelect').querySelectorAll('.note-btn').forEach(b => b.classList.toggle('active', b.textContent === s.note));
            previewBass(s);
        }
        updateBassGridDisplay();
        markDirty();
    }

    function transposeStep(s, semis) {
        let midi = s.octave * 12 + NOTES.indexOf(s.note) + semis;
        let octave = Math.floor(midi / 12);
        if (octave < 1 || octave > 3) return;
        s.note = NOTES[((midi % 12) + 12) % 12];
        s.octave = octave;
    }

    function previewBass(s) {
        if (sequencer.isPlaying) return;
        audioEngine.init();
        audioEngine.resume();
        tb303.init();
        const t = audioEngine.currentTime + 0.01;
        tb303.trigger(s.note, s.octave, t, { accent: !!s.accent, gate: 0.18 });
    }

    function previewDrum(id, accent) {
        if (sequencer.isPlaying) return;
        audioEngine.init();
        audioEngine.resume();
        tr808.init();
        tr808.trigger(id, audioEngine.currentTime + 0.005, { accent });
    }

    // ============================================================ pattern ops
    function selectPattern(i) {
        sequencer.selectPattern(i);
        refreshPatternUI(i);
        state.selectedStep303 = null;
        buildDrumGrid();
        updateBassGridDisplay();
        markDirty();
    }

    function refreshPatternUI(i) {
        document.querySelectorAll('.pat-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.pat) === i));
        $('lcdPattern').textContent = PATTERN_NAMES[i];
    }

    function refreshGrids() {
        buildDrumGrid();
        updateBassGridDisplay();
    }

    function apply808(pattern) {
        sequencer.setPattern808(sequencer.currentPattern808, pattern);
        buildDrumGrid();
        markDirty();
    }

    function apply303(line) {
        sequencer.setPattern303(sequencer.currentPattern303, line);
        state.selectedStep303 = null;
        updateBassGridDisplay();
        markDirty();
    }

    function densityForStyle(style) {
        const S = MusicGen.STYLES[style] || MusicGen.STYLES.techno;
        return MusicGen.pick(S.density);
    }

    function applyComposition(c, { autoplay = true } = {}) {
        c.patterns808.forEach((p, i) => sequencer.setPattern808(i, p));
        c.patterns303.forEach((l, i) => sequencer.setPattern303(i, l));
        sequencer.setBPM(c.bpm);
        sequencer.setSwing(c.swing);
        sequencer.setStretch(100);
        sequencer.setChainBars(4);
        sequencer.setChainEnabled(true);
        sequencer.selectPattern(0);

        state.root = c.root;
        state.scale = c.scale;
        state.style = c.style;
        $('styleSelect').value = c.style;
        $('keySelect').value = c.root;
        $('scaleSelect').value = c.scale;
        $('chainBars').value = '4';

        tb303.setCutoff(c.synth.cutoff);
        tb303.setResonance(c.synth.resonance);
        tb303.setEnvMod(c.synth.envMod);
        tb303.setDecay(c.synth.decay);
        tb303.setAccent(c.synth.accent);
        tb303.setWaveform(c.synth.waveform);

        // gentle delay suggestion
        audioEngine.init();
        chaosFx.init();
        chaosFx.setDelayTime(c.delay.time);
        chaosFx.setDelayFeedback(c.delay.feedback);
        chaosFx.setDelayMix(c.delay.mix);
        chaosFx.setDelayMode('normal');
        setToggleUI($('delayToggle'), c.delay.on);
        document.querySelectorAll('.delay-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'normal'));
        chaosFx.toggleDelay(c.delay.on);
        chaosFx.updateDelay(sequencer.bpm);

        // reset time-warp so the result plays as composed
        chaosFx.polyEnabled = false;
        sequencer.steps303 = 16;
        setToggleUI($('polyToggle'), false);
        if (chaosFx.drunkMode) { chaosFx.drunkify(sequencer); $('drunkModeBtn').classList.remove('is-on'); $('app').classList.remove('drunk-active'); }

        syncAllControls();
        refreshPatternUI(0);
        state.selectedStep303 = null;
        refreshGrids();
        markDirty();

        const keyName = NOTES[c.root] + ' ' + MusicGen.SCALES[c.scale].name;
        flash('COMPOSED · ' + MusicGen.STYLES[c.style].name + ' · ' + keyName + ' · ' + c.bpm + ' BPM');
        if (autoplay && !sequencer.isPlaying) startPlayback();
    }

    // ============================================================ control sync
    function syncAllControls() {
        Knobs.set('bpmSlider', sequencer.bpm);
        Knobs.set('swingSlider', Math.round(sequencer.swing * 100));
        Knobs.set('masterVol', Math.round(audioEngine.masterVolume * 100));
        syncTB303Knobs();
        tr808.instruments.forEach(inst => Knobs.set('vol_' + inst.id, Math.round(tr808.volumes[inst.id] * 100)));
        Knobs.set('timeStretch', Math.round(sequencer.stretch * 100));
        $('chainToggle').classList.toggle('is-on', sequencer.chain.enabled);
        $('chainBars').value = String(sequencer.chain.bars);
        $('styleSelect').value = state.style;
        $('keySelect').value = state.root;
        $('scaleSelect').value = state.scale;
        setOctaveUI(state.selectedOctave);
        updateLCDStatic();
    }

    function syncTB303Knobs() {
        Knobs.set('cutoff', tb303.cutoff);
        Knobs.set('resonance', tb303.resonance);
        Knobs.set('envMod', tb303.envMod);
        Knobs.set('decay', tb303.decay);
        Knobs.set('accent', tb303.accentLevel);
        Knobs.set('level303', Math.round(tb303.level * 100));
        $('waveSaw').classList.toggle('active', tb303.waveform === 'sawtooth');
        $('waveSqr').classList.toggle('active', tb303.waveform === 'square');
    }

    function setToggleUI(btn, on) {
        btn.classList.toggle('active', on);
        btn.lastChild.textContent = on ? 'ON' : 'OFF';
    }

    function updateLCDStatic() {
        $('lcdSwing').textContent = Math.round(sequencer.swing * 100) + '%';
        $('lcdPattern').textContent = PATTERN_NAMES[sequencer.currentPattern808];
        $('lcdChain').textContent = sequencer.chain.enabled ? sequencer.chain.bars + 'BAR' : 'OFF';
        $('lcdKey').textContent = NOTES[state.root] + ' ' + shortScale(state.scale);
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

    // ============================================================ transport
    function startPlayback() {
        audioEngine.init();
        audioEngine.resume();
        chaosFx.init();
        chaosFx.cancelTape(sequencer, tb303);
        sequencer.start();
        $('playBtn').classList.add('is-on');
        $('ledRun').classList.add('is-on');
        setBaseStatus('PLAYING');
    }

    function stopPlayback() {
        chaosFx.cancelTape(sequencer, tb303);
        sequencer.stop();
    }

    sequencer.onStop = () => {
        $('playBtn').classList.remove('is-on');
        $('ledRun').classList.remove('is-on');
        $('ledBeat').classList.remove('is-on');
        $('stutterBtn').classList.remove('is-on');
        drawQueue.length = 0;
        patQueue.length = 0;
        clearStepHighlights();
        $('lcdBar').textContent = '–';
        setBaseStatus('STOPPED');
    };

    sequencer.onStepChange = (s, s3, t) => drawQueue.push({ s, s3, t });
    sequencer.onPatternChange = (idx, t) => {
        if (t === undefined) refreshPatternUI(idx);
        else patQueue.push({ idx, t });
    };
    sequencer.onBar = (bar, t) => patQueue.push({ bar, t });

    function bindTransport() {
        $('playBtn').addEventListener('click', () => {
            if (sequencer.isPlaying) stopPlayback(); else startPlayback();
        });
        $('stopBtn').addEventListener('click', () => {
            stopPlayback();
            $('stopBtn').classList.add('flash');
            setTimeout(() => $('stopBtn').classList.remove('flash'), 150);
        });

        $('bpmSlider').addEventListener('input', e => {
            sequencer.setBPM(parseInt(e.target.value));
            chaosFx.updateDelay(sequencer.bpm);
            markDirty();
        });
        $('bpmDown').addEventListener('click', () => Knobs.set('bpmSlider', sequencer.bpm - 1, { emit: true }));
        $('bpmUp').addEventListener('click', () => Knobs.set('bpmSlider', sequencer.bpm + 1, { emit: true }));

        $('swingSlider').addEventListener('input', e => {
            sequencer.setSwing(parseInt(e.target.value));
            $('lcdSwing').textContent = e.target.value + '%';
            markDirty();
        });

        $('masterVol').addEventListener('input', e => {
            audioEngine.init();
            audioEngine.setMasterVolume(e.target.value / 100);
            markDirty();
        });

        $('chainToggle').addEventListener('click', () => {
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
        $('keySelect').addEventListener('change', e => { state.root = parseInt(e.target.value); updateLCDStatic(); markDirty(); });
        $('scaleSelect').addEventListener('change', e => { state.scale = e.target.value; updateLCDStatic(); markDirty(); });

        $('composeBtn').addEventListener('click', () => {
            const c = MusicGen.compose({ style: state.style, root: state.root, scale: state.scale });
            applyComposition(c);
            $('composeBtn').classList.add('is-on');
            setTimeout(() => $('composeBtn').classList.remove('is-on'), 600);
        });

        $('modeInst').addEventListener('click', () => switchMode('instruments'));
        $('modeFX').addEventListener('click', () => switchMode('fx'));

        $('resetAllBtn').addEventListener('click', () => {
            if (!confirm('保存データを消去して初期状態に戻しますか？')) return;
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
            state.dirty = false;
            window.removeEventListener('beforeunload', saveNow);
            location.reload();
        });
    }

    // ============================================================ instruments
    function bindInstruments() {
        // --- drum grid: click / shift / right click / drag paint
        const grid = $('drumGrid');
        grid.addEventListener('pointerdown', e => {
            const pad = e.target.closest('.pad');
            if (!pad) return;
            e.preventDefault();
            const inst = pad.dataset.instrument;
            const step = parseInt(pad.dataset.step);
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
            if (!state.paint || !(e.buttons & 3)) return;
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
        const endPaint = () => { state.paint = null; };
        document.addEventListener('pointerup', endPaint);
        document.addEventListener('pointercancel', endPaint);

        $('clear808').addEventListener('click', () => { sequencer.clearPattern808(); buildDrumGrid(); flash('808 PATTERN CLEARED'); markDirty(); });
        $('clear303').addEventListener('click', () => { sequencer.clearPattern303(); state.selectedStep303 = null; updateBassGridDisplay(); flash('303 PATTERN CLEARED'); markDirty(); });

        $('copy808').addEventListener('click', () => {
            state.clip808 = JSON.parse(JSON.stringify(sequencer.pattern808));
            $('paste808').disabled = false;
            flash('808 PATTERN COPIED');
        });
        $('paste808').addEventListener('click', () => { if (state.clip808) { apply808(state.clip808); flash('808 PATTERN PASTED'); } });
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

        // --- 303 synth knobs
        $('cutoff').addEventListener('input', e => { tb303.setCutoff(parseFloat(e.target.value)); markDirty(); });
        $('resonance').addEventListener('input', e => { tb303.setResonance(parseFloat(e.target.value)); markDirty(); });
        $('envMod').addEventListener('input', e => { tb303.setEnvMod(parseFloat(e.target.value)); markDirty(); });
        $('decay').addEventListener('input', e => { tb303.setDecay(parseFloat(e.target.value)); markDirty(); });
        $('accent').addEventListener('input', e => { tb303.setAccent(parseFloat(e.target.value)); markDirty(); });
        $('level303').addEventListener('input', e => { tb303.setLevel(parseFloat(e.target.value) / 100); markDirty(); });
        $('waveSaw').addEventListener('click', () => { tb303.setWaveform('sawtooth'); syncTB303Knobs(); markDirty(); });
        $('waveSqr').addEventListener('click', () => { tb303.setWaveform('square'); syncTB303Knobs(); markDirty(); });

        document.querySelectorAll('.oct-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                setOctaveUI(parseInt(btn.dataset.oct));
                if (state.selectedStep303 !== null) {
                    const s = sequencer.pattern303[state.selectedStep303];
                    s.octave = state.selectedOctave;
                    updateBassGridDisplay();
                    previewBass(s);
                    markDirty();
                }
            });
        });
    }

    // ============================================================ chaos fx
    function bindChaosFX() {
        const toggle = (id, fn, label) => {
            const btn = $(id);
            btn.addEventListener('click', () => {
                audioEngine.init();
                chaosFx.init();
                const on = !btn.classList.contains('active');
                fn(on);
                setToggleUI(btn, on);
                flash(label + (on ? ' ON' : ' OFF'));
            });
        };
        const knob = (id, fn) => $(id).addEventListener('input', e => fn(parseFloat(e.target.value)));

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
                sequencer.pattern808[target] = gate.map(v => v ? 1 : 0);
                buildDrumGrid();
                markDirty();
                const inst = tr808.instruments.find(x => x.id === target);
                flash('EUCLID ' + hits + '/16 → ' + (inst ? inst.longName : target));
            }
        });

        $('mutateBtn').addEventListener('click', () => {
            const amount = parseInt($('mutateAmount').value);
            apply808(chaosFx.mutatePattern808(sequencer.pattern808, amount));
            apply303(chaosFx.mutatePattern303(sequencer.pattern303, amount, { root: state.root, scale: state.scale }));
            flash('MUTATED ' + amount + '%');
        });
        $('reverseBtn').addEventListener('click', () => {
            apply808(chaosFx.reversePattern808(sequencer.pattern808));
            apply303(chaosFx.reversePattern303(sequencer.pattern303));
            flash('REVERSED');
        });
        $('palindromeBtn').addEventListener('click', () => {
            apply808(chaosFx.palindromePattern808(sequencer.pattern808));
            apply303(chaosFx.palindromePattern303(sequencer.pattern303));
            flash('PALINDROME');
        });
        $('shiftLBtn').addEventListener('click', () => {
            apply808(chaosFx.shiftPattern808(sequencer.pattern808, 'left'));
            apply303(chaosFx.shiftPattern303(sequencer.pattern303, 'left'));
            flash('SHIFT ◀');
        });
        $('shiftRBtn').addEventListener('click', () => {
            apply808(chaosFx.shiftPattern808(sequencer.pattern808, 'right'));
            apply303(chaosFx.shiftPattern303(sequencer.pattern303, 'right'));
            flash('SHIFT ▶');
        });
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
            if (on) chaosFx.startChaosLFO(tb303, syncTB303Knobs); else chaosFx.stopChaosLFO();
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

        $('polyToggle').addEventListener('click', () => {
            chaosFx.polyEnabled = !chaosFx.polyEnabled;
            sequencer.steps303 = chaosFx.polyEnabled ? chaosFx.polySteps : 16;
            setToggleUI($('polyToggle'), chaosFx.polyEnabled);
            updateBassGridDisplay();
            flash(chaosFx.polyEnabled ? 'POLY · 303 = ' + chaosFx.polySteps + ' STEPS' : 'POLY OFF');
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
            chaosFx.screamMode(tb303);
            syncTB303Knobs();
            markDirty();
            flash('SCREAM!!!');
        });
        $('robotModeBtn').addEventListener('click', () => {
            chaosFx.robotAcid(tb303, 'acid');
            apply303(MusicGen.generateLine({ root: state.root, scale: state.scale, density: 'dense' }));
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
            const c = MusicGen.compose({});
            applyComposition(c);
            $('app').classList.add('shake');
            setTimeout(() => $('app').classList.remove('shake'), 400);
        });
    }

    // ============================================================ keyboard
    function bindKeyboard() {
        document.addEventListener('keydown', e => {
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
            if (e.target.classList && e.target.classList.contains('knob')) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    if (e.repeat) return;
                    if (sequencer.isPlaying) stopPlayback(); else startPlayback();
                    break;
                case '1': switchMode('instruments'); break;
                case '2': switchMode('fx'); break;
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
                    updateBassGridDisplay();
                    break;
            }
        });
    }

    function switchMode(mode) {
        state.mode = mode;
        document.querySelectorAll('.mode-btn').forEach(btn => {
            const on = btn.dataset.mode === mode;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        $('section808').classList.toggle('active', mode === 'instruments');
        $('section303').classList.toggle('active', mode === 'instruments');
        $('sectionFX').classList.toggle('active', mode === 'fx');
    }

    // ============================================================ draw loop
    let lastBpmText = '';
    let beatTimer = 0;
    function frame() {
        const now = audioEngine.currentTime;

        let latest = null;
        while (drawQueue.length && drawQueue[0].t <= now + 0.004) latest = drawQueue.shift();
        if (latest) {
            highlightStep(latest.s, latest.s3);
            if (latest.s % 4 === 0) {
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
                refreshGrids();
            }
            if (ev.bar !== undefined) {
                const bars = sequencer.chain.enabled ? sequencer.chain.bars : 0;
                $('lcdBar').textContent = bars ? (((ev.bar - 1) % bars) + 1) + '/' + bars : String(ev.bar);
            }
        }

        const bpmText = sequencer.effectiveBpm.toFixed(1);
        if (bpmText !== lastBpmText) { $('lcdBpm').textContent = bpmText; lastBpmText = bpmText; }

        requestAnimationFrame(frame);
    }

    function highlightStep(s, s3) {
        const prev = state.lastHighlight;
        if (prev.s >= 0 && prev.s !== s) {
            dom.padCols[prev.s].forEach(p => p.classList.remove('current'));
            dom.dots808[prev.s].classList.remove('active');
            dom.lcdSteps[prev.s].classList.remove('active');
        }
        if (prev.s3 >= 0 && prev.s3 !== s3) {
            dom.bassCols[prev.s3].forEach(b => b.classList.remove('current'));
            dom.dots303[prev.s3].classList.remove('active');
        }
        if (s >= 0) {
            dom.padCols[s].forEach(p => p.classList.add('current'));
            dom.dots808[s].classList.add('active');
            dom.lcdSteps[s].classList.add('active');
        }
        if (s3 >= 0 && s3 < 16) {
            dom.bassCols[s3].forEach(b => b.classList.add('current'));
            dom.dots303[s3].classList.add('active');
        }
        state.lastHighlight = { s, s3 };
    }

    function clearStepHighlights() {
        document.querySelectorAll('.current').forEach(el => el.classList.remove('current'));
        document.querySelectorAll('.step-dot.active, .lcd-steps .active').forEach(el => el.classList.remove('active'));
        state.lastHighlight = { s: -1, s3: -1 };
    }

    // ============================================================ persistence
    function markDirty() { state.dirty = true; }

    function serialize() {
        return {
            v: 3,
            seq: sequencer.toJSON(),
            tb303: tb303.getParams(),
            volumes: tr808.volumes,
            master: audioEngine.masterVolume,
            root: state.root,
            scale: state.scale,
            style: state.style,
            octave: state.selectedOctave,
            mode: state.mode
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

    function loadState() {
        let data = null;
        try { data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { data = null; }
        if (!data || data.v !== 3) {
            // first run: give the user something that already sounds like music
            const c = MusicGen.compose({ style: 'techno' });
            c.patterns808.forEach((p, i) => sequencer.setPattern808(i, p));
            c.patterns303.forEach((l, i) => sequencer.setPattern303(i, l));
            sequencer.setBPM(c.bpm);
            sequencer.setSwing(c.swing);
            sequencer.setChainBars(4);
            sequencer.chain.enabled = true;
            state.root = c.root;
            state.scale = c.scale;
            state.style = c.style;
            tb303.setCutoff(c.synth.cutoff);
            tb303.setResonance(c.synth.resonance);
            tb303.setEnvMod(c.synth.envMod);
            tb303.setDecay(c.synth.decay);
            tb303.setAccent(c.synth.accent);
            tb303.setWaveform(c.synth.waveform);
            state.selectedOctave = 1;
            return;
        }
        try {
            sequencer.fromJSON(data.seq);
            if (data.tb303) {
                tb303.setCutoff(data.tb303.cutoff);
                tb303.setResonance(data.tb303.resonance);
                tb303.setEnvMod(data.tb303.envMod);
                tb303.setDecay(data.tb303.decay);
                tb303.setAccent(data.tb303.accent);
                tb303.setWaveform(data.tb303.waveform);
                tb303.setLevel(data.tb303.level ?? 0.8);
            }
            if (data.volumes) Object.keys(data.volumes).forEach(k => { if (k in tr808.volumes) tr808.setVolume(k, data.volumes[k]); });
            if (typeof data.master === 'number') audioEngine.masterVolume = Math.max(0, Math.min(1, data.master));
            if (Number.isInteger(data.root)) state.root = Math.max(0, Math.min(11, data.root));
            if (MusicGen.SCALES[data.scale]) state.scale = data.scale;
            if (MusicGen.STYLES[data.style]) state.style = data.style;
            if ([1, 2, 3].includes(data.octave)) state.selectedOctave = data.octave;
        } catch (e) {
            console.warn('state restore failed', e);
        }
    }

    function bindPersistence() {
        setInterval(() => { if (state.dirty) saveNow(); }, 1500);
        window.addEventListener('beforeunload', saveNow);
        window.addEventListener('beforeunload', () => {
            chaosFx.stopChaosLFO();
            if (chaosFx.earthquakeOn) chaosFx.toggleEarthquake(false);
        });
    }
});
