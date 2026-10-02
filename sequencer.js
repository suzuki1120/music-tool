class Sequencer {
    constructor(engine, tr808, tb303) {
        this.engine = engine;
        this.tr808 = tr808;
        this.tb303 = tb303;

        this.steps = 16;
        this.steps303 = 16;
        this.bpm = 128;
        this.swing = 0;
        this.isPlaying = false;
        this.currentStep = -1;
        this.currentStep303 = -1;
        this.timerId = null;
        this.nextStepTime = 0;
        this.scheduleAheadTime = 0.1;
        this.lookAhead = 25;

        this.patterns808 = this._createEmptyPatterns808(4);
        this.patterns303 = this._createEmptyPatterns303(4);
        this.currentPattern808 = 0;
        this.currentPattern303 = 0;

        this.onStepChange = null;
        this.probabilityFn = null;
        this.glitchJumpFn = null;
    }

    _createEmptyPatterns808(count) {
        const patterns = [];
        for (let p = 0; p < count; p++) {
            const pattern = {};
            this.tr808.instruments.forEach(inst => {
                pattern[inst.id] = new Array(this.steps).fill(false);
            });
            patterns.push(pattern);
        }
        return patterns;
    }

    _createEmptyPatterns303(count) {
        const patterns = [];
        for (let p = 0; p < count; p++) {
            const pattern = [];
            for (let i = 0; i < this.steps; i++) {
                pattern.push({
                    active: false,
                    note: 'C',
                    octave: 2,
                    accent: false,
                    slide: false
                });
            }
            patterns.push(pattern);
        }
        return patterns;
    }

    get pattern808() {
        return this.patterns808[this.currentPattern808];
    }

    get pattern303() {
        return this.patterns303[this.currentPattern303];
    }

    setBPM(bpm) {
        this.bpm = bpm;
    }

    setSwing(value) {
        this.swing = value / 100;
    }

    toggle808Step(instrumentId, step) {
        const pattern = this.pattern808;
        pattern[instrumentId][step] = !pattern[instrumentId][step];
        return pattern[instrumentId][step];
    }

    set303Step(step, data) {
        const pattern = this.pattern303;
        Object.assign(pattern[step], data);
    }

    toggle303Step(step) {
        const pattern = this.pattern303;
        pattern[step].active = !pattern[step].active;
        return pattern[step].active;
    }

    clearPattern808() {
        const pattern = this.pattern808;
        Object.keys(pattern).forEach(key => {
            pattern[key] = new Array(this.steps).fill(false);
        });
    }

    clearPattern303() {
        const pattern = this.pattern303;
        for (let i = 0; i < this.steps; i++) {
            pattern[i] = {
                active: false,
                note: 'C',
                octave: 2,
                accent: false,
                slide: false
            };
        }
    }

    start() {
        if (this.isPlaying) return;

        this.engine.init();
        this.engine.resume();
        this.tr808.init();

        this.isPlaying = true;
        this.currentStep = -1;
        this.currentStep303 = -1;
        this.nextStepTime = this.engine.currentTime + 0.05;

        this._schedule();
    }

    stop() {
        this.isPlaying = false;
        this.currentStep = -1;
        this.currentStep303 = -1;
        this.tb303.reset();
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        if (this.onStepChange) {
            this.onStepChange(-1);
        }
    }

    _schedule() {
        if (!this.isPlaying) return;

        while (this.nextStepTime < this.engine.currentTime + this.scheduleAheadTime) {
            this.currentStep = (this.currentStep + 1) % this.steps;
            this.currentStep303 = (this.currentStep303 + 1) % this.steps303;

            // Glitch jump — random step skip during runtime
            if (this.glitchJumpFn && this.glitchJumpFn()) {
                this.currentStep = Math.floor(Math.random() * this.steps);
                this.currentStep303 = Math.floor(Math.random() * this.steps303);
            }

            this._playStep(this.currentStep, this.currentStep303, this.nextStepTime);

            if (this.onStepChange) {
                const step = this.currentStep;
                setTimeout(() => this.onStepChange(step),
                    (this.nextStepTime - this.engine.currentTime) * 1000);
            }

            this._advanceTime();
        }

        this.timerId = setTimeout(() => this._schedule(), this.lookAhead);
    }

    _advanceTime() {
        const secondsPerBeat = 60.0 / this.bpm;
        const secondsPer16th = secondsPerBeat / 4;

        let swingOffset = 0;
        if (this.currentStep % 2 === 1) {
            swingOffset = secondsPer16th * this.swing * 0.5;
        }

        this.nextStepTime += secondsPer16th + swingOffset;
    }

    _playStep(step, step303, time) {
        if (step303 === undefined) step303 = step;
        const shouldPlay = this.probabilityFn ? this.probabilityFn() : true;

        const pattern808 = this.pattern808;
        this.tr808.instruments.forEach(inst => {
            if (pattern808[inst.id][step]) {
                const instPlay = this.probabilityFn ? this.probabilityFn() : true;
                if (instPlay) {
                    this.tr808.trigger(inst.id, time);
                }
            }
        });

        const stepData = this.pattern303[step303];
        if (stepData && stepData.active && shouldPlay) {
            const stepDuration = (60.0 / this.bpm) / 4;
            this.tb303.trigger(stepData.note, stepData.octave, time, {
                accent: stepData.accent,
                slide: stepData.slide,
                gate: stepDuration * 0.9
            });
        }
    }

    getPresetPattern808(name) {
        const presets = {
            'basic': {
                kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
                snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                hihat_c: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
                hihat_o: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,1,0]
            },
            'house': {
                kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
                clap: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
                hihat_c: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
                hihat_o: [0,0,0,0, 0,0,0,1, 0,0,0,0, 0,0,0,1]
            },
            'techno': {
                kick: [1,0,0,0, 1,0,0,0, 1,0,0,1, 1,0,0,0],
                hihat_c: [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
                clap: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
                rimshot: [0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,0]
            }
        };
        return presets[name] || null;
    }

    loadPreset808(name) {
        const preset = this.getPresetPattern808(name);
        if (!preset) return;
        
        this.clearPattern808();
        const pattern = this.pattern808;
        Object.keys(preset).forEach(inst => {
            if (pattern[inst]) {
                pattern[inst] = preset[inst].map(v => !!v);
            }
        });
    }
}
