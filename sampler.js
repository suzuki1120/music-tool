/**
 * Sampler — four one-shot pads (S1–S4) sequenced as extra rows of the drum grid.
 *
 *   load(idx, file|ArrayBuffer, name)   decode + keep the raw bytes for IndexedDB persistence
 *   trigger(idx, time, { accent, velocity }, dest)
 *   pad params: pitch (semitones), decay (seconds, 0 = full length), start (0..1), reverse
 *
 * Audio is stored in IndexedDB (`synthseq-samples`), settings travel with the normal JSON state.
 */
class Sampler {
    constructor(engine) {
        this.engine = engine;
        this.pads = [0, 1, 2, 3].map(() => this._emptyPad());
        this.onChange = null;   // (idx) → UI
        this._dbName = 'synthseq-samples';
        this._store = 'pads';
        this._touched = [false, false, false, false];   // loaded / cleared by the user this session → restore must not overwrite
    }

    _emptyPad() {
        return { name: '', buffer: null, reversed: null, raw: null, pitch: 0, decay: 0, start: 0, reverse: false, choke: false };
    }

    getParams() {
        return this.pads.map(p => ({ name: p.name, pitch: p.pitch, decay: p.decay, start: p.start, reverse: p.reverse, choke: p.choke }));
    }

    setParams(list) {
        if (!Array.isArray(list)) return;
        list.slice(0, 4).forEach((p, i) => {
            if (!p) return;
            const pad = this.pads[i];
            if (typeof p.pitch === 'number') pad.pitch = Math.max(-24, Math.min(24, p.pitch));
            if (typeof p.decay === 'number') pad.decay = Math.max(0, Math.min(4, p.decay));
            if (typeof p.start === 'number') pad.start = Math.max(0, Math.min(0.95, p.start));
            pad.reverse = !!p.reverse;
            pad.choke = !!p.choke;
            if (typeof p.name === 'string' && !pad.name) pad.name = p.name;
        });
    }

    setPitch(idx, v) { this.pads[idx].pitch = Math.max(-24, Math.min(24, v)); }
    setDecay(idx, v) { this.pads[idx].decay = Math.max(0, Math.min(4, v)); }
    setStart(idx, v) { this.pads[idx].start = Math.max(0, Math.min(0.95, v)); }
    setReverse(idx, on) { this.pads[idx].reverse = !!on; }
    /** True once audio is stored for the pad (it may still be waiting for the AudioContext to decode). */
    hasSample(idx) { const p = this.pads[idx]; return !!(p.buffer || p.raw); }

    // ---------------------------------------------------------------- loading
    async load(idx, source, name = '') {
        if (!this.engine.init()) throw new Error('no audio context');
        this._touched[idx] = true;
        let raw;
        if (source instanceof ArrayBuffer) raw = source;
        else raw = await source.arrayBuffer();
        if (raw.byteLength > 12 * 1024 * 1024) throw new Error('file too large (max 12 MB)');
        const buffer = await this.engine.ctx.decodeAudioData(raw.slice(0));
        const pad = this.pads[idx];
        pad.buffer = buffer;
        pad.reversed = null;
        pad.raw = raw;
        pad.name = name || (source && source.name) || ('sample ' + (idx + 1));
        if (this.onChange) this.onChange(idx);
        this._persist(idx).catch(() => { /* IndexedDB unavailable */ });
        return pad;
    }

    clear(idx) {
        this._touched[idx] = true;
        const keep = this.pads[idx];
        this.pads[idx] = this._emptyPad();
        this.pads[idx].pitch = keep.pitch;
        this.pads[idx].decay = keep.decay;
        if (this.onChange) this.onChange(idx);
        this._remove(idx).catch(() => { /* ignore */ });
    }

    _reversedBuffer(pad) {
        if (pad.reversed) return pad.reversed;
        const src = pad.buffer;
        const out = this.engine.ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
        for (let c = 0; c < src.numberOfChannels; c++) {
            const a = src.getChannelData(c);
            const b = out.getChannelData(c);
            for (let i = 0, n = a.length; i < n; i++) b[i] = a[n - 1 - i];
        }
        pad.reversed = out;
        return out;
    }

    // ---------------------------------------------------------------- playback
    trigger(idx, time, opts = {}, dest = null) {
        const pad = this.pads[idx];
        if (!pad || !pad.buffer || !this.engine.ctx) return;
        const ctx = this.engine.ctx;
        const { accent = false, velocity = 1 } = opts;
        const vol = (accent ? 1.4 : 1) * velocity;
        const target = dest || this.engine.channelInput('s' + (idx + 1));

        if (pad.choke && pad._last) {
            // Drop the old voice's pending GATE envelope first, or it would bring the level back up.
            try { const g = pad._last.gain.gain; g.cancelScheduledValues(time); g.setTargetAtTime(0, time, 0.008); } catch (e) { /* done */ }
        }

        const src = ctx.createBufferSource();
        src.buffer = pad.reverse ? this._reversedBuffer(pad) : pad.buffer;
        const pf = this.engine.pitchFactor || 1;
        src.playbackRate.value = Math.pow(2, pad.pitch / 12) * pf;

        const gain = ctx.createGain();
        const dur = pad.buffer.duration;
        const offset = Math.min(dur * 0.98, dur * pad.start);
        const remaining = (dur - offset) / src.playbackRate.value;
        const len = pad.decay > 0 ? Math.min(remaining, pad.decay) : remaining;

        gain.gain.setValueAtTime(vol, time);
        if (pad.decay > 0) {
            gain.gain.setValueAtTime(vol, time + Math.max(0, len - 0.03));
            gain.gain.linearRampToValueAtTime(0.0001, time + len);
        }
        src.connect(gain);
        gain.connect(target);
        src.start(time, offset);
        src.stop(time + len + 0.05);
        pad._last = { gain };
    }

    // ---------------------------------------------------------------- IndexedDB
    _db() {
        return new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
            const req = indexedDB.open(this._dbName, 1);
            req.onupgradeneeded = () => { req.result.createObjectStore(this._store); };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async _persist(idx) {
        const pad = this.pads[idx];
        if (!pad.raw) return;
        const db = await this._db();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(this._store, 'readwrite');
            tx.objectStore(this._store).put({ name: pad.name, raw: pad.raw }, idx);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    }

    async _remove(idx) {
        const db = await this._db();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(this._store, 'readwrite');
            tx.objectStore(this._store).delete(idx);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    }

    /**
     * Restore stored samples. Reading IndexedDB needs no AudioContext, so this runs at page load and the
     * pads show their names right away; decoding waits for the context (decodePending, called on init).
     */
    async restore() {
        let db;
        try { db = await this._db(); } catch (e) { return 0; }
        const rows = await new Promise((resolve) => {
            const out = [];
            const tx = db.transaction(this._store, 'readonly');
            const store = tx.objectStore(this._store);
            const req = store.openCursor();
            req.onsuccess = () => {
                const cur = req.result;
                if (cur) { out.push({ idx: cur.key, ...cur.value }); cur.continue(); }
                else resolve(out);
            };
            req.onerror = () => resolve(out);
        });
        db.close();
        let n = 0;
        for (const row of rows) {
            if (typeof row.idx !== 'number' || row.idx < 0 || row.idx > 3 || !row.raw) continue;
            if (this._touched[row.idx]) continue;
            const pad = this.pads[row.idx];
            pad.raw = row.raw;
            pad.buffer = null;
            pad.reversed = null;
            pad.name = row.name || pad.name;
            n++;
            if (this.onChange) this.onChange(row.idx);
        }
        await this.decodePending();
        return n;
    }

    /** Decode restored pads that are still raw bytes. No-op until the AudioContext exists. */
    async decodePending() {
        if (!this.engine.ctx) return;
        for (let idx = 0; idx < 4; idx++) {
            const pad = this.pads[idx];
            if (!pad.raw || pad.buffer) continue;
            const raw = pad.raw;
            try {
                const buffer = await this.engine.ctx.decodeAudioData(raw.slice(0));
                // The pad may have been reloaded or cleared while decoding.
                if (this.pads[idx] !== pad || pad.raw !== raw || pad.buffer) continue;
                pad.buffer = buffer;
                pad.reversed = null;
                if (this.onChange) this.onChange(idx);
            } catch (e) { /* undecodable */ }
        }
    }
}
