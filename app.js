document.addEventListener('DOMContentLoaded', () => {
    const tr808 = new TR808(audioEngine);
    const tb303 = new TB303(audioEngine);
    const chaosFx = new ChaosFX(audioEngine);
    const sequencer = new Sequencer(audioEngine, tr808, tb303);

    let currentMode = 'instruments';
    let selectedNote = 'C';
    let selectedOctave = 2;
    let selectedStep303 = null;

    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    initUI();
    bindEvents();
    bindChaosFX();

    function initUI() {
        buildStepIndicators();
        buildDrumGrid();
        buildDrumMixer();
        buildBassGrid();
        buildNoteSelect();
    }

    function buildStepIndicators() {
        const indicator808 = document.getElementById('stepIndicator808');
        const indicator303 = document.getElementById('stepIndicator303');

        for (let i = 0; i < 16; i++) {
            const dot808 = document.createElement('div');
            dot808.className = 'step-dot' + (i % 4 === 0 ? ' beat' : '');
            dot808.dataset.step = i;
            indicator808.appendChild(dot808);

            const dot303 = document.createElement('div');
            dot303.className = 'step-dot' + (i % 4 === 0 ? ' beat' : '');
            dot303.dataset.step = i;
            indicator303.appendChild(dot303);
        }
    }

    function buildDrumGrid() {
        const grid = document.getElementById('drumGrid');
        grid.innerHTML = '';

        tr808.instruments.forEach(inst => {
            const row = document.createElement('div');
            row.className = 'drum-row';

            const label = document.createElement('div');
            label.className = 'drum-label';
            label.textContent = inst.name;
            row.appendChild(label);

            for (let step = 0; step < 16; step++) {
                const pad = document.createElement('button');
                pad.className = 'drum-pad';
                pad.dataset.instrument = inst.id;
                pad.dataset.step = step;

                if (sequencer.pattern808[inst.id][step]) {
                    pad.classList.add('on');
                }

                pad.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    const isOn = sequencer.toggle808Step(inst.id, step);
                    pad.classList.toggle('on', isOn);
                    previewDrumSound(inst.id);
                });

                pad.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    pad.classList.toggle('accent');
                });

                row.appendChild(pad);
            }

            grid.appendChild(row);
        });
    }

    function buildDrumMixer() {
        const mixer = document.getElementById('drumMixer');
        mixer.innerHTML = '';

        tr808.instruments.forEach(inst => {
            const channel = document.createElement('div');
            channel.className = 'mixer-channel';

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0';
            slider.max = '100';
            slider.value = String(inst.defaultVol * 100);
            slider.addEventListener('input', () => {
                tr808.setVolume(inst.id, slider.value / 100);
            });

            const label = document.createElement('label');
            label.textContent = inst.name;

            channel.appendChild(slider);
            channel.appendChild(label);
            mixer.appendChild(channel);
        });
    }

    function buildBassGrid() {
        const grid = document.getElementById('bassGrid');
        grid.innerHTML = '';

        const noteRow = document.createElement('div');
        noteRow.className = 'bass-row';

        const rowLabel = document.createElement('div');
        rowLabel.className = 'bass-row-label';
        rowLabel.textContent = 'NOTE';
        noteRow.appendChild(rowLabel);

        for (let step = 0; step < 16; step++) {
            const btn = document.createElement('button');
            btn.className = 'bass-step';
            btn.dataset.step = step;

            const stepData = sequencer.pattern303[step];
            if (stepData.active) {
                btn.classList.add('on');
                btn.textContent = stepData.note;
            }
            if (stepData.slide) btn.classList.add('slide');
            if (stepData.accent) btn.classList.add('accent');

            btn.addEventListener('click', () => handleBassStepClick(step, btn));
            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                handleBassStepRightClick(step, btn);
            });

            noteRow.appendChild(btn);
        }
        grid.appendChild(noteRow);

        const slideRow = document.createElement('div');
        slideRow.className = 'bass-row';
        const slideLabel = document.createElement('div');
        slideLabel.className = 'bass-row-label';
        slideLabel.textContent = 'SLIDE';
        slideRow.appendChild(slideLabel);

        for (let step = 0; step < 16; step++) {
            const btn = document.createElement('button');
            btn.className = 'bass-step';
            btn.dataset.step = step;
            btn.dataset.type = 'slide';

            if (sequencer.pattern303[step].slide) btn.classList.add('on');

            btn.addEventListener('click', () => {
                const pattern = sequencer.pattern303;
                pattern[step].slide = !pattern[step].slide;
                btn.classList.toggle('on', pattern[step].slide);
                updateBassGridDisplay();
            });

            slideRow.appendChild(btn);
        }
        grid.appendChild(slideRow);

        const accentRow = document.createElement('div');
        accentRow.className = 'bass-row';
        const accentLabel = document.createElement('div');
        accentLabel.className = 'bass-row-label';
        accentLabel.textContent = 'ACCENT';
        accentRow.appendChild(accentLabel);

        for (let step = 0; step < 16; step++) {
            const btn = document.createElement('button');
            btn.className = 'bass-step';
            btn.dataset.step = step;
            btn.dataset.type = 'accent';

            if (sequencer.pattern303[step].accent) btn.classList.add('on');

            btn.addEventListener('click', () => {
                const pattern = sequencer.pattern303;
                pattern[step].accent = !pattern[step].accent;
                btn.classList.toggle('on', pattern[step].accent);
                updateBassGridDisplay();
            });

            accentRow.appendChild(btn);
        }
        grid.appendChild(accentRow);
    }

    function handleBassStepClick(step, btn) {
        const pattern = sequencer.pattern303;

        if (pattern[step].active && selectedStep303 === step) {
            pattern[step].active = false;
            selectedStep303 = null;
        } else {
            pattern[step].active = true;
            pattern[step].note = selectedNote;
            pattern[step].octave = selectedOctave;
            selectedStep303 = step;
        }

        updateBassGridDisplay();
    }

    function handleBassStepRightClick(step, btn) {
        const pattern = sequencer.pattern303;
        if (pattern[step].active) {
            pattern[step].slide = !pattern[step].slide;
            updateBassGridDisplay();
        }
    }

    function updateBassGridDisplay() {
        const grid = document.getElementById('bassGrid');
        const noteSteps = grid.querySelectorAll('.bass-row:first-child .bass-step');

        noteSteps.forEach((btn, i) => {
            const stepData = sequencer.pattern303[i];
            btn.className = 'bass-step';
            if (stepData.active) {
                btn.classList.add('on');
                btn.textContent = stepData.note + stepData.octave;
                if (stepData.slide) btn.classList.add('slide');
                if (stepData.accent) btn.classList.add('accent');
            } else {
                btn.textContent = '';
            }
        });
    }

    function buildNoteSelect() {
        const container = document.getElementById('noteSelect');
        container.innerHTML = '';

        notes.forEach(note => {
            const btn = document.createElement('button');
            btn.className = 'note-btn' + (note === selectedNote ? ' active' : '');
            if (note.includes('#')) btn.classList.add('is-black');
            btn.textContent = note;
            btn.addEventListener('click', () => {
                container.querySelectorAll('.note-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedNote = note;

                if (selectedStep303 !== null) {
                    sequencer.pattern303[selectedStep303].note = note;
                    updateBassGridDisplay();
                }
            });
            container.appendChild(btn);
        });
    }

    function previewDrumSound(instrumentId) {
        audioEngine.init();
        audioEngine.resume();
        tr808.init();
        tr808.trigger(instrumentId, audioEngine.currentTime);
    }

    function bindEvents() {
        document.getElementById('playBtn').addEventListener('click', () => {
            audioEngine.init();
            chaosFx.init();
            sequencer.start();
            document.getElementById('playBtn').classList.add('playing');
            document.getElementById('playBtn').textContent = '⏸ PAUSE';
            document.getElementById('statusText').textContent = 'PLAYING';
        });

        document.getElementById('stopBtn').addEventListener('click', () => {
            sequencer.stop();
            chaosFx.stopStutter();
            document.getElementById('playBtn').classList.remove('playing');
            document.getElementById('playBtn').textContent = '▶ PLAY';
            document.getElementById('statusText').textContent = 'STOPPED';
            clearStepHighlights();
        });

        window.addEventListener('beforeunload', () => {
            chaosFx.stopStutter();
            chaosFx.stopChaosLFO();
            if (chaosFx.earthquakeOn) chaosFx.toggleEarthquake(false);
        });

        document.getElementById('bpmSlider').addEventListener('input', (e) => {
            const bpm = parseInt(e.target.value);
            sequencer.setBPM(bpm);
            document.getElementById('bpmValue').textContent = bpm;
            chaosFx.updateDelay(bpm);
        });

        document.getElementById('swingSlider').addEventListener('input', (e) => {
            const swing = parseInt(e.target.value);
            sequencer.setSwing(swing);
            document.getElementById('swingValue').textContent = swing + '%';
        });

        document.getElementById('masterVol').addEventListener('input', (e) => {
            audioEngine.init();
            audioEngine.setMasterVolume(e.target.value / 100);
        });

        document.getElementById('modeInst').addEventListener('click', () => switchMode('instruments'));
        document.getElementById('modeFX').addEventListener('click', () => switchMode('fx'));

        document.getElementById('pattern808').addEventListener('change', (e) => {
            sequencer.currentPattern808 = parseInt(e.target.value);
            buildDrumGrid();
        });

        document.getElementById('pattern303').addEventListener('change', (e) => {
            sequencer.currentPattern303 = parseInt(e.target.value);
            buildBassGrid();
        });

        document.getElementById('clear808').addEventListener('click', () => {
            sequencer.clearPattern808();
            buildDrumGrid();
        });

        document.getElementById('clear303').addEventListener('click', () => {
            sequencer.clearPattern303();
            buildBassGrid();
        });

        document.getElementById('cutoff').addEventListener('input', (e) => {
            tb303.setCutoff(parseFloat(e.target.value));
        });

        document.getElementById('resonance').addEventListener('input', (e) => {
            tb303.setResonance(parseFloat(e.target.value));
        });

        document.getElementById('envMod').addEventListener('input', (e) => {
            tb303.setEnvMod(parseFloat(e.target.value));
        });

        document.getElementById('decay').addEventListener('input', (e) => {
            tb303.setDecay(parseFloat(e.target.value));
        });

        document.getElementById('accent').addEventListener('input', (e) => {
            tb303.setAccent(parseFloat(e.target.value));
        });

        document.getElementById('waveSaw').addEventListener('click', () => {
            tb303.setWaveform('sawtooth');
            document.getElementById('waveSaw').classList.add('active');
            document.getElementById('waveSqr').classList.remove('active');
        });

        document.getElementById('waveSqr').addEventListener('click', () => {
            tb303.setWaveform('square');
            document.getElementById('waveSqr').classList.add('active');
            document.getElementById('waveSaw').classList.remove('active');
        });

        document.querySelectorAll('.oct-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.oct-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedOctave = parseInt(btn.dataset.oct);

                if (selectedStep303 !== null) {
                    sequencer.pattern303[selectedStep303].octave = selectedOctave;
                    updateBassGridDisplay();
                }
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return;
            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    if (sequencer.isPlaying) {
                        document.getElementById('stopBtn').click();
                    } else {
                        document.getElementById('playBtn').click();
                    }
                    break;
                case '1':
                    switchMode('instruments');
                    break;
                case '2':
                    switchMode('fx');
                    break;
            }
        });

        sequencer.onStepChange = (step) => {
            updateStepHighlight(step);

            if (chaosFx.drunkMode) {
                const offset = chaosFx.getDrunkBPMOffset();
                sequencer.setBPM(sequencer.bpm + offset);
            }
        };
    }

    function bindChaosFX() {
        // --- STUTTER ---
        const stutterBtn = document.getElementById('stutterBtn');
        stutterBtn.addEventListener('mousedown', () => {
            audioEngine.init();
            chaosFx.init();
            stutterBtn.classList.add('active');
            const currentStep = sequencer.currentStep;
            chaosFx.startStutter(() => {
                if (currentStep >= 0) {
                    sequencer._playStep(currentStep, audioEngine.currentTime);
                }
            });
        });
        stutterBtn.addEventListener('mouseup', () => {
            stutterBtn.classList.remove('active');
            chaosFx.stopStutter();
        });
        stutterBtn.addEventListener('mouseleave', () => {
            stutterBtn.classList.remove('active');
            chaosFx.stopStutter();
        });

        document.getElementById('stutterRate').addEventListener('input', (e) => {
            chaosFx.stutterRate = parseInt(e.target.value);
        });
        document.getElementById('stutterDecay').addEventListener('input', (e) => {
            chaosFx.stutterDecay = parseInt(e.target.value);
        });

        // --- TAPE STOP ---
        document.getElementById('tapeStopBtn').addEventListener('click', () => {
            audioEngine.init();
            chaosFx.init();
            chaosFx.tapeStop(sequencer, 2.0);
            flashStatus('☢ TAPE STOP');
        });

        // --- VINYL BRAKE ---
        document.getElementById('vinylBrakeBtn').addEventListener('click', () => {
            audioEngine.init();
            chaosFx.init();
            chaosFx.vinylBrake(sequencer, () => {
                flashStatus('💿 VINYL BRAKE');
            });
        });

        // --- BIT CRUSHER ---
        const bitCrushToggle = document.getElementById('bitCrushToggle');
        bitCrushToggle.addEventListener('click', () => {
            audioEngine.init();
            chaosFx.init();
            const enabled = !chaosFx.bitCrushEnabled;
            chaosFx.toggleBitCrush(enabled);
            bitCrushToggle.classList.toggle('active', enabled);
            bitCrushToggle.textContent = enabled ? 'ON' : 'OFF';
            flashStatus(enabled ? '👾 BIT CRUSH ON' : 'BIT CRUSH OFF');
        });

        document.getElementById('bitDepth').addEventListener('input', (e) => {
            chaosFx.setBitDepth(parseInt(e.target.value));
        });
        document.getElementById('sampleRateReduce').addEventListener('input', (e) => {
            chaosFx.setSampleRateReduce(parseInt(e.target.value));
        });
        document.getElementById('crushMix').addEventListener('input', (e) => {
            chaosFx.setCrushMix(parseInt(e.target.value));
        });

        // --- DELAY ---
        const delayToggle = document.getElementById('delayToggle');
        delayToggle.addEventListener('click', () => {
            audioEngine.init();
            chaosFx.init();
            const enabled = !chaosFx.delayEnabled;
            chaosFx.toggleDelay(enabled);
            chaosFx.updateDelay(sequencer.bpm);
            delayToggle.classList.toggle('active', enabled);
            delayToggle.textContent = enabled ? 'ON' : 'OFF';
            flashStatus(enabled ? '🌀 DELAY ON' : 'DELAY OFF');
        });

        document.getElementById('delayTime').addEventListener('input', (e) => {
            chaosFx.setDelayTime(parseInt(e.target.value));
            chaosFx.updateDelay(sequencer.bpm);
        });
        document.getElementById('delayFeedback').addEventListener('input', (e) => {
            chaosFx.setDelayFeedback(parseInt(e.target.value));
            chaosFx.updateDelay(sequencer.bpm);
        });
        document.getElementById('delayFilter').addEventListener('input', (e) => {
            chaosFx.setDelayFilter(parseInt(e.target.value));
            chaosFx.updateDelay(sequencer.bpm);
        });
        document.getElementById('delayMix').addEventListener('input', (e) => {
            chaosFx.setDelayMix(parseInt(e.target.value));
            chaosFx.updateDelay(sequencer.bpm);
        });

        document.querySelectorAll('.delay-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.delay-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                chaosFx.setDelayMode(btn.dataset.mode);
            });
        });

        // --- EUCLIDEAN ---
        document.getElementById('euclideanBtn').addEventListener('click', () => {
            const hits = parseInt(document.getElementById('euclideanHits').value);
            const rotate = parseInt(document.getElementById('euclideanRotate').value);
            const eucPattern = chaosFx.euclidean(16, hits, rotate);

            const targetIs303 = Math.random() < 0.5;
            if (!targetIs303) {
                const instruments = Object.keys(sequencer.pattern808);
                const randomInst = instruments[Math.floor(Math.random() * instruments.length)];
                sequencer.pattern808[randomInst] = eucPattern;
                buildDrumGrid();
                flashStatus('🎲 EUCLIDEAN → ' + randomInst.toUpperCase());
            } else {
                for (let i = 0; i < 16; i++) {
                    sequencer.pattern303[i].active = eucPattern[i];
                    if (eucPattern[i]) {
                        const scale = [0, 3, 5, 7, 10];
                        sequencer.pattern303[i].note = notes[scale[Math.floor(Math.random() * scale.length)]];
                        sequencer.pattern303[i].octave = selectedOctave;
                    }
                }
                buildBassGrid();
                flashStatus('🎲 EUCLIDEAN → 303');
            }
        });

        // --- MUTATE ---
        document.getElementById('mutateBtn').addEventListener('click', () => {
            const amount = parseInt(document.getElementById('mutateAmount').value);

            const mutated808 = chaosFx.mutatePattern808(sequencer.pattern808, amount);
            Object.keys(mutated808).forEach(key => {
                sequencer.pattern808[key] = mutated808[key];
            });

            const mutated303 = chaosFx.mutatePattern303(sequencer.pattern303, amount);
            for (let i = 0; i < 16; i++) {
                sequencer.pattern303[i] = mutated303[i];
            }

            buildDrumGrid();
            buildBassGrid();
            flashStatus('🧬 MUTATED ' + amount + '%');
        });

        // --- REVERSE ---
        document.getElementById('reverseBtn').addEventListener('click', () => {
            const rev808 = chaosFx.reversePattern808(sequencer.pattern808);
            Object.keys(rev808).forEach(key => {
                sequencer.pattern808[key] = rev808[key];
            });

            const rev303 = chaosFx.reversePattern303(sequencer.pattern303);
            for (let i = 0; i < 16; i++) {
                sequencer.pattern303[i] = rev303[i];
            }

            buildDrumGrid();
            buildBassGrid();
            flashStatus('🔄 REVERSED');
        });

        // --- ACID RANDOM ---
        document.getElementById('randomAcidBtn').addEventListener('click', () => {
            const acidLine = chaosFx.generateAcidLine();
            for (let i = 0; i < 16; i++) {
                sequencer.pattern303[i] = acidLine[i];
            }
            buildBassGrid();
            flashStatus('🧪 ACID LINE GENERATED');
        });

        // --- PALINDROME ---
        document.getElementById('palindromeBtn').addEventListener('click', () => {
            const pal808 = chaosFx.palindromePattern808(sequencer.pattern808);
            Object.keys(pal808).forEach(key => {
                sequencer.pattern808[key] = pal808[key];
            });

            const pal303 = chaosFx.palindromePattern303(sequencer.pattern303);
            for (let i = 0; i < 16; i++) {
                sequencer.pattern303[i] = pal303[i];
            }

            buildDrumGrid();
            buildBassGrid();
            flashStatus('🪞 PALINDROME');
        });

        // --- SHIFT ---
        document.getElementById('shiftLBtn').addEventListener('click', () => {
            const shifted808 = chaosFx.shiftPattern808(sequencer.pattern808, 'left');
            Object.keys(shifted808).forEach(key => {
                sequencer.pattern808[key] = shifted808[key];
            });

            const shifted303 = chaosFx.shiftPattern303(sequencer.pattern303, 'left');
            for (let i = 0; i < 16; i++) {
                sequencer.pattern303[i] = shifted303[i];
            }

            buildDrumGrid();
            buildBassGrid();
            flashStatus('← SHIFTED LEFT');
        });

        document.getElementById('shiftRBtn').addEventListener('click', () => {
            const shifted808 = chaosFx.shiftPattern808(sequencer.pattern808, 'right');
            Object.keys(shifted808).forEach(key => {
                sequencer.pattern808[key] = shifted808[key];
            });

            const shifted303 = chaosFx.shiftPattern303(sequencer.pattern303, 'right');
            for (let i = 0; i < 16; i++) {
                sequencer.pattern303[i] = shifted303[i];
            }

            buildDrumGrid();
            buildBassGrid();
            flashStatus('SHIFTED RIGHT →');
        });

        // --- PROBABILITY ---
        document.getElementById('probability').addEventListener('input', (e) => {
            chaosFx.setProbability(parseInt(e.target.value));
            sequencer.probabilityFn = () => chaosFx.shouldTrigger();
        });

        // --- POLYRHYTHM ---
        const polyToggle = document.getElementById('polyToggle');
        polyToggle.addEventListener('click', () => {
            chaosFx.polyEnabled = !chaosFx.polyEnabled;
            polyToggle.classList.toggle('active', chaosFx.polyEnabled);
            polyToggle.textContent = chaosFx.polyEnabled ? 'ON' : 'OFF';
            sequencer.steps303 = chaosFx.polyEnabled ? chaosFx.polySteps : 16;
            flashStatus(chaosFx.polyEnabled ? '🔀 POLY ON (' + chaosFx.polySteps + ')' : 'POLY OFF');
        });

        document.getElementById('polySteps').addEventListener('input', (e) => {
            chaosFx.polySteps = parseInt(e.target.value);
            if (chaosFx.polyEnabled) {
                sequencer.steps303 = chaosFx.polySteps;
            }
        });

        document.getElementById('timeStretch').addEventListener('input', (e) => {
            const stretch = parseInt(e.target.value);
            chaosFx.timeStretch = stretch;
            const baseBpm = parseInt(document.getElementById('bpmSlider').value);
            sequencer.setBPM(baseBpm * (stretch / 100));
        });

        document.getElementById('halftimeBtn').addEventListener('click', () => {
            const current = parseInt(document.getElementById('bpmSlider').value);
            const newBpm = Math.max(60, Math.floor(current / 2));
            document.getElementById('bpmSlider').value = newBpm;
            document.getElementById('bpmValue').textContent = newBpm;
            sequencer.setBPM(newBpm);
            flashStatus('🐢 HALFTIME: ' + newBpm + ' BPM');
        });

        document.getElementById('doubletimeBtn').addEventListener('click', () => {
            const current = parseInt(document.getElementById('bpmSlider').value);
            const newBpm = Math.min(200, current * 2);
            document.getElementById('bpmSlider').value = newBpm;
            document.getElementById('bpmValue').textContent = newBpm;
            sequencer.setBPM(newBpm);
            flashStatus('🐇 DOUBLETIME: ' + newBpm + ' BPM');
        });

        document.getElementById('tripletBtn').addEventListener('click', () => {
            const current = parseInt(document.getElementById('bpmSlider').value);
            const tripletBpm = Math.round(current * 1.5);
            const newBpm = Math.min(200, tripletBpm);
            document.getElementById('bpmSlider').value = newBpm;
            document.getElementById('bpmValue').textContent = newBpm;
            sequencer.setBPM(newBpm);
            flashStatus('🎵 TRIPLET: ' + newBpm + ' BPM');
        });

        // --- REVERB ---
        const reverbToggle = document.getElementById('reverbToggle');
        reverbToggle.addEventListener('click', () => {
            audioEngine.init();
            chaosFx.init();
            const enabled = !chaosFx.reverbEnabled;
            chaosFx.toggleReverb(enabled);
            reverbToggle.classList.toggle('active', enabled);
            reverbToggle.textContent = enabled ? 'ON' : 'OFF';
            flashStatus(enabled ? '🌌 REVERB ON' : 'REVERB OFF');
        });
        document.getElementById('reverbDecay').addEventListener('input', (e) => {
            chaosFx.setReverbDecay(parseFloat(e.target.value));
        });
        document.getElementById('reverbMix').addEventListener('input', (e) => {
            chaosFx.setReverbMix(parseInt(e.target.value));
        });
        const freezeBtn = document.getElementById('freezeBtn');
        freezeBtn.addEventListener('click', () => {
            audioEngine.init();
            chaosFx.init();
            const frozen = !chaosFx.reverbFrozen;
            chaosFx.freezeReverb(frozen);
            freezeBtn.classList.toggle('active', frozen);
            freezeBtn.textContent = frozen ? '🧊 FROZEN' : '❄ FREEZE';
            flashStatus(frozen ? '🧊 REVERB FROZEN' : 'REVERB UNFROZEN');
        });

        // --- PHASER ---
        const phaserToggle = document.getElementById('phaserToggle');
        phaserToggle.addEventListener('click', () => {
            audioEngine.init();
            chaosFx.init();
            const enabled = !chaosFx.phaserEnabled;
            chaosFx.togglePhaser(enabled);
            phaserToggle.classList.toggle('active', enabled);
            phaserToggle.textContent = enabled ? 'ON' : 'OFF';
            flashStatus(enabled ? '🌊 PHASER ON' : 'PHASER OFF');
        });
        document.getElementById('phaserRate').addEventListener('input', (e) => {
            chaosFx.setPhaserRate(parseFloat(e.target.value));
        });
        document.getElementById('phaserDepth').addEventListener('input', (e) => {
            chaosFx.setPhaserDepth(parseFloat(e.target.value));
        });
        document.getElementById('phaserMix').addEventListener('input', (e) => {
            chaosFx.setPhaserMix(parseInt(e.target.value));
        });

        // --- RING MOD ---
        const ringModToggle = document.getElementById('ringModToggle');
        ringModToggle.addEventListener('click', () => {
            audioEngine.init();
            chaosFx.init();
            const enabled = !chaosFx.ringModEnabled;
            chaosFx.toggleRingMod(enabled);
            ringModToggle.classList.toggle('active', enabled);
            ringModToggle.textContent = enabled ? 'ON' : 'OFF';
            flashStatus(enabled ? '🛸 RING MOD ON' : 'RING MOD OFF');
        });
        document.getElementById('ringModFreq').addEventListener('input', (e) => {
            chaosFx.setRingModFreq(parseFloat(e.target.value));
        });
        document.getElementById('ringModMix').addEventListener('input', (e) => {
            chaosFx.setRingModMix(parseInt(e.target.value));
        });

        // --- WAVE FOLDER ---
        const waveFolderToggle = document.getElementById('waveFolderToggle');
        waveFolderToggle.addEventListener('click', () => {
            audioEngine.init();
            chaosFx.init();
            const enabled = !chaosFx.waveFolderEnabled;
            chaosFx.toggleWaveFolder(enabled);
            waveFolderToggle.classList.toggle('active', enabled);
            waveFolderToggle.textContent = enabled ? 'ON' : 'OFF';
            flashStatus(enabled ? '🌀 FOLDER ON' : 'FOLDER OFF');
        });
        document.getElementById('foldAmount').addEventListener('input', (e) => {
            chaosFx.setFoldAmount(parseFloat(e.target.value));
        });
        document.getElementById('foldMix').addEventListener('input', (e) => {
            chaosFx.setFoldMix(parseInt(e.target.value));
        });

        // --- AUTO PAN ---
        const autoPanToggle = document.getElementById('autoPanToggle');
        autoPanToggle.addEventListener('click', () => {
            audioEngine.init();
            chaosFx.init();
            const enabled = !chaosFx.autoPanEnabled;
            chaosFx.toggleAutoPan(enabled);
            autoPanToggle.classList.toggle('active', enabled);
            autoPanToggle.textContent = enabled ? 'ON' : 'OFF';
            flashStatus(enabled ? '🔄 AUTO PAN ON' : 'AUTO PAN OFF');
        });
        document.getElementById('autoPanRate').addEventListener('input', (e) => {
            chaosFx.setAutoPanRate(parseFloat(e.target.value));
        });
        document.getElementById('autoPanDepth').addEventListener('input', (e) => {
            chaosFx.setAutoPanDepth(parseInt(e.target.value));
        });

        // --- CHAOS LFO ---
        const chaosLFOToggle = document.getElementById('chaosLFOToggle');
        chaosLFOToggle.addEventListener('click', () => {
            const enabled = !chaosFx.chaosLFOEnabled;
            if (enabled) {
                chaosFx.startChaosLFO(tb303);
            } else {
                chaosFx.stopChaosLFO();
            }
            chaosLFOToggle.classList.toggle('active', enabled);
            chaosLFOToggle.textContent = enabled ? 'ON' : 'OFF';
            flashStatus(enabled ? '😈 CHAOS LFO ON' : 'CHAOS LFO OFF');
        });

        // --- GLITCH JUMP ---
        const glitchJumpToggle = document.getElementById('glitchJumpToggle');
        glitchJumpToggle.addEventListener('click', () => {
            const enabled = !chaosFx.glitchJumpEnabled;
            chaosFx.toggleGlitchJump(enabled);
            glitchJumpToggle.classList.toggle('active', enabled);
            glitchJumpToggle.textContent = enabled ? 'ON' : 'OFF';
            sequencer.glitchJumpFn = enabled ? (() => Math.random() < 0.1) : null;
            flashStatus(enabled ? '⚡ GLITCH JUMP ON' : 'GLITCH JUMP OFF');
        });

        // --- EARTHQUAKE ---
        const earthquakeToggle = document.getElementById('earthquakeToggle');
        earthquakeToggle.addEventListener('click', () => {
            audioEngine.init();
            chaosFx.init();
            const enabled = !chaosFx.earthquakeOn;
            chaosFx.toggleEarthquake(enabled);
            earthquakeToggle.classList.toggle('active', enabled);
            earthquakeToggle.textContent = enabled ? 'ON' : 'OFF';
            flashStatus(enabled ? '🌍 EARTHQUAKE ON' : 'EARTHQUAKE OFF');
        });

        // --- SCREAM ---
        document.getElementById('screamBtn').addEventListener('click', () => {
            chaosFx.screamMode(tb303);
            document.getElementById('cutoff').value = tb303.cutoff;
            document.getElementById('resonance').value = tb303.resonance;
            document.getElementById('envMod').value = tb303.envMod;
            document.getElementById('decay').value = tb303.decay;
            document.getElementById('accent').value = tb303.accentLevel;
            flashStatus('🔊🔊 SCREAM!!! 🔊🔊');
        });

        // --- TOTAL DESTRUCTION ---
        document.getElementById('randomizeAllBtn').addEventListener('click', () => {
            audioEngine.init();
            chaosFx.randomizeAll(sequencer, tr808, tb303);

            const newBpm = sequencer.bpm;
            document.getElementById('bpmSlider').value = newBpm;
            document.getElementById('bpmValue').textContent = Math.round(newBpm);
            document.getElementById('cutoff').value = tb303.cutoff;
            document.getElementById('resonance').value = tb303.resonance;
            document.getElementById('envMod').value = tb303.envMod;
            document.getElementById('decay').value = tb303.decay;

            buildDrumGrid();
            buildBassGrid();
            flashStatus('☢ TOTAL DESTRUCTION ☢');
            document.getElementById('app').classList.add('drunk-active');
            setTimeout(() => document.getElementById('app').classList.remove('drunk-active'), 1000);
        });

        // --- DRUNK MODE ---
        document.getElementById('drunkModeBtn').addEventListener('click', () => {
            const isDrunk = chaosFx.drunkify(sequencer);
            document.getElementById('drunkModeBtn').classList.toggle('active', isDrunk);
            document.getElementById('app').classList.toggle('drunk-active', isDrunk);
            flashStatus(isDrunk ? '🍺 DRUNK MODE ON - THINGS WILL GET WEIRD' : '🍺 SOBERING UP...');
        });

        // --- ROBOT ACID ---
        document.getElementById('robotModeBtn').addEventListener('click', () => {
            chaosFx.robotAcid(tb303);
            const acidLine = chaosFx.generateAcidLine();
            for (let i = 0; i < 16; i++) {
                sequencer.pattern303[i] = acidLine[i];
            }

            document.getElementById('cutoff').value = tb303.cutoff;
            document.getElementById('resonance').value = tb303.resonance;
            document.getElementById('envMod').value = tb303.envMod;
            document.getElementById('decay').value = tb303.decay;

            buildBassGrid();
            flashStatus('🤖 ROBOT ACID ACTIVATED');
            document.getElementById('app').classList.add('robot-active');
            setTimeout(() => document.getElementById('app').classList.remove('robot-active'), 2000);
        });
    }

    function switchMode(mode) {
        currentMode = mode;

        document.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        document.getElementById('section808').classList.toggle('active', mode === 'instruments');
        document.getElementById('section303').classList.toggle('active', mode === 'instruments');
        document.getElementById('sectionFX').classList.toggle('active', mode === 'fx');
    }

    function updateStepHighlight(step) {
        const indicators808 = document.querySelectorAll('#stepIndicator808 .step-dot');
        const indicators303 = document.querySelectorAll('#stepIndicator303 .step-dot');

        indicators808.forEach((dot, i) => {
            dot.classList.toggle('active', i === step);
        });
        indicators303.forEach((dot, i) => {
            dot.classList.toggle('active', i === step);
        });

        document.querySelectorAll('.drum-pad').forEach(pad => {
            pad.classList.toggle('current', parseInt(pad.dataset.step) === step);
        });

        const bassSteps = document.querySelectorAll('.bass-row:first-child .bass-step');
        bassSteps.forEach((btn, i) => {
            btn.classList.toggle('current', i === step);
        });
    }

    function clearStepHighlights() {
        document.querySelectorAll('.step-dot').forEach(dot => dot.classList.remove('active'));
        document.querySelectorAll('.drum-pad').forEach(pad => pad.classList.remove('current'));
        document.querySelectorAll('.bass-step').forEach(btn => btn.classList.remove('current'));
    }

    function flashStatus(text) {
        const el = document.getElementById('statusText');
        el.textContent = text;
        el.style.color = '#ff006e';
        setTimeout(() => {
            el.style.color = '';
        }, 1500);
    }
});
