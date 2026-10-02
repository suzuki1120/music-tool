/**
 * MidiIO — Web MIDI bridge.
 *
 *   OUT : MIDI clock (24 ppqn) + start / stop, drum notes on channel 10, 303 notes on channel 1,
 *         stab chords on channel 2 — all timestamped from the audio clock.
 *   IN  : CC → knob mapping with MIDI learn, note-on plays the 303 live.
 *
 * Chrome / Edge / Opera support Web MIDI; Safari does not (supported === false → UI shows a notice).
 */
class MidiIO {
    constructor(engine, sequencer) {
        this.engine = engine;
        this.sequencer = sequencer;
        this.supported = typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
        this.access = null;
        this.inputs = [];
        this.outputs = [];
        this.outId = '';
        this.inId = '';
        this.clockOut = true;
        this.notesOut = true;
        this.learning = null;        // { id, done }
        this.mappings = {};          // 'ch:cc' → { id }
        this.onDevices = null;       // () → UI
        this.onCC = null;            // (inputId, normalised 0..1, raw)
        this.onNote = null;          // (midiNote, velocity 0..1, on)
        this.onLearned = null;       // (key, id)
        this._input = null;
        this._pendingNoteOffs = [];
        this._loadMappings();

        sequencer.stepHooks.push((tick, time, dur) => this._clock(tick, time, dur));
    }

    async init() {
        if (!this.supported || this.access) return this.access;
        try {
            this.access = await navigator.requestMIDIAccess({ sysex: false });
        } catch (e) {
            this.supported = false;
            return null;
        }
        this.access.onstatechange = () => this._refresh();
        this._refresh();
        return this.access;
    }

    _refresh() {
        if (!this.access) return;
        this.inputs = Array.from(this.access.inputs.values()).map(p => ({ id: p.id, name: p.name || p.id }));
        this.outputs = Array.from(this.access.outputs.values()).map(p => ({ id: p.id, name: p.name || p.id }));
        if (this.outId && !this.outputs.find(o => o.id === this.outId)) this.outId = '';
        if (this.inId && !this.inputs.find(i => i.id === this.inId)) this.setInput('');
        if (this.onDevices) this.onDevices();
    }

    get output() {
        return this.access && this.outId ? this.access.outputs.get(this.outId) : null;
    }

    setOutput(id) { this.outId = id || ''; }

    setInput(id) {
        if (this._input) { this._input.onmidimessage = null; this._input = null; }
        this.inId = id || '';
        if (this.access && this.inId) {
            this._input = this.access.inputs.get(this.inId) || null;
            if (this._input) this._input.onmidimessage = (e) => this._onMessage(e);
        }
    }

    // ---------------------------------------------------------------- out
    _ts(audioTime) { return this.engine.audioTimeToPerf(audioTime); }

    _send(bytes, audioTime) {
        const out = this.output;
        if (!out) return;
        try { out.send(bytes, audioTime !== undefined ? this._ts(audioTime) : undefined); } catch (e) { /* closed port */ }
    }

    _clock(tick, time, dur) {
        if (!this.clockOut || !this.output) return;
        for (let k = 0; k < 6; k++) this._send([0xF8], time + (k * dur) / 6);
    }

    start(audioTime) {
        if (!this.clockOut) return;
        this._send([0xFA], audioTime);
    }

    stop() {
        if (this.clockOut) this._send([0xFC]);
        this.allNotesOff();
    }

    allNotesOff() {
        if (!this.output) return;
        [0, 1, 9].forEach(ch => this._send([0xB0 | ch, 123, 0]));
    }

    static noteNumber(note, octave) {
        return (octave + 1) * 12 + MusicGen.NOTES.indexOf(note);
    }

    /** Sequencer trigger hook. */
    trigger(type, data, time) {
        if (!this.notesOut || !this.output) return;
        const vel = Math.max(1, Math.min(127, Math.round((data.accent ? 127 : 100) * (data.velocity ?? 1))));
        if (type === '808') {
            const n = data.midi || 36;
            this._send([0x99, n, vel], time);
            this._send([0x89, n, 0], time + 0.05);
        } else if (type === '303') {
            const n = MidiIO.noteNumber(data.note, data.octave);
            if (n < 0 || n > 127) return;
            this._send([0x90, n, vel], time);
            this._send([0x80, n, 0], time + Math.max(0.03, data.gate || 0.1));
        } else if (type === 'stab') {
            const chord = MusicGen.CHORDS[data.chord] || MusicGen.CHORDS.min;
            const base = MidiIO.noteNumber(data.note, data.octave);
            chord.iv.forEach(iv => {
                const n = base + iv;
                if (n < 0 || n > 127) return;
                this._send([0x91, n, vel], time);
                this._send([0x81, n, 0], time + Math.max(0.03, data.gate || 0.2));
            });
        }
    }

    // ---------------------------------------------------------------- in
    _onMessage(e) {
        const [status, d1, d2] = e.data;
        if (status === undefined) return;
        const type = status & 0xF0;
        const ch = status & 0x0F;
        if (type === 0xB0) {
            const key = ch + ':' + d1;
            if (this.learning) {
                this.mappings[key] = { id: this.learning.id };
                const l = this.learning;
                this.learning = null;
                this._saveMappings();
                if (this.onLearned) this.onLearned(key, l.id);
                if (l.done) l.done(key);
                return;
            }
            const m = this.mappings[key];
            if (m && this.onCC) this.onCC(m.id, d2 / 127, d2);
        } else if (type === 0x90 && d2 > 0) {
            if (this.onNote) this.onNote(d1, d2 / 127, true);
        } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
            if (this.onNote) this.onNote(d1, 0, false);
        }
    }

    learn(id, done) { this.learning = { id, done }; }
    cancelLearn() { this.learning = null; }
    forget(id) {
        Object.keys(this.mappings).forEach(k => { if (this.mappings[k].id === id) delete this.mappings[k]; });
        this._saveMappings();
    }
    clearMappings() { this.mappings = {}; this._saveMappings(); }

    _saveMappings() {
        try { localStorage.setItem('synthseq.midimap', JSON.stringify(this.mappings)); } catch (e) { /* ignore */ }
    }
    _loadMappings() {
        try {
            const m = JSON.parse(localStorage.getItem('synthseq.midimap') || '{}');
            if (m && typeof m === 'object') this.mappings = m;
        } catch (e) { this.mappings = {}; }
    }
}
