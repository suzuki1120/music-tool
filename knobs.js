/**
 * Knobs — progressive enhancement of <input type="range" data-knob> into hardware style rotary knobs.
 *
 *  - drag vertically (Shift = fine), mouse wheel, arrow keys, double-click resets to the initial value
 *  - the original <input> stays in the DOM: reading / writing .value and listening to 'input' keep working
 *  - Knobs.set(input, value, { emit }) updates value + visual and optionally dispatches 'input'
 *  - data-format: int | pct | hz | sec | ms | bpm | x | semi | pan | filter | float1 | float2 | custom via data-unit
 *  - data-bipolar: the value arc grows from the centre (pan, filter, pitch)
 *  - data-size: s | l
 */
const Knobs = (() => {
    const registry = new WeakMap();
    const MIN_ANGLE = -135;
    const MAX_ANGLE = 135;

    function fmt(input, v) {
        const f = input.dataset.format || 'int';
        const unit = input.dataset.unit || '';
        switch (f) {
            case 'pct': return Math.round(v) + '%';
            case 'hz': return v >= 1000 ? (v / 1000).toFixed(2).replace(/\.?0+$/, '') + 'k' : Math.round(v) + 'Hz';
            case 'sec': return (v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's');
            case 'ms': return Math.round(v) + 'ms';
            case 'float1': return v.toFixed(1) + unit;
            case 'float2': return v.toFixed(2) + unit;
            case 'x': return v.toFixed(1) + '×';
            case 'div': return '1/' + Math.round(v * 4);
            case 'semi': return (v > 0 ? '+' : '') + Math.round(v) + 'st';
            case 'pan': { const p = Math.round(v); return p === 0 ? 'C' : (p < 0 ? 'L' + Math.abs(p) : 'R' + p); }
            case 'filter': { const p = Math.round(v); return p === 0 ? 'FLAT' : (p < 0 ? 'LP ' + Math.abs(p) : 'HP ' + p); }
            default: return Math.round(v) + unit;
        }
    }

    function clamp(input, v) {
        const min = parseFloat(input.min), max = parseFloat(input.max);
        const step = parseFloat(input.step) || 1;
        v = Math.max(min, Math.min(max, v));
        v = Math.round((v - min) / step) * step + min;
        const dec = (String(step).split('.')[1] || '').length;
        return parseFloat(v.toFixed(dec));
    }

    function update(input) {
        const k = registry.get(input);
        if (!k) return;
        const min = parseFloat(input.min), max = parseFloat(input.max);
        const v = parseFloat(input.value);
        const t = max > min ? (v - min) / (max - min) : 0;
        const angle = MIN_ANGLE + t * (MAX_ANGLE - MIN_ANGLE);
        k.el.style.setProperty('--angle', angle + 'deg');
        if (k.bipolar) {
            const a = Math.min(t, 0.5) * 270, b = Math.max(t, 0.5) * 270;
            k.el.style.setProperty('--arc-start', a + 'deg');
            k.el.style.setProperty('--arc-end', b + 'deg');
        } else {
            k.el.style.setProperty('--arc-start', '0deg');
            k.el.style.setProperty('--arc-end', (t * 270) + 'deg');
        }
        k.el.setAttribute('aria-valuenow', v);
        k.el.setAttribute('aria-valuetext', fmt(input, v));
        k.out.textContent = fmt(input, v);
    }

    function emit(input) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function enhance(input) {
        if (registry.has(input)) return;
        const wrapper = input.closest('.knob-wrapper') || input.parentElement;
        const label = wrapper ? wrapper.querySelector('label') : null;

        const el = document.createElement('div');
        el.className = 'knob' + (input.dataset.size ? ' knob-' + input.dataset.size : '');
        el.tabIndex = 0;
        el.setAttribute('role', 'slider');
        el.setAttribute('aria-valuemin', input.min);
        el.setAttribute('aria-valuemax', input.max);
        if (label) el.setAttribute('aria-label', label.textContent.trim());
        el.innerHTML = '<div class="knob-body"><div class="knob-dial"></div></div>';

        const out = document.createElement('output');
        out.className = 'knob-value';

        input.classList.add('knob-input');
        input.tabIndex = -1;
        input.insertAdjacentElement('beforebegin', el);
        if (label) label.insertAdjacentElement('afterend', out);
        else input.insertAdjacentElement('afterend', out);

        const initial = parseFloat(input.dataset.default ?? input.value);
        registry.set(input, { el, out, initial, bipolar: input.dataset.bipolar !== undefined });

        // --- drag
        let startY = 0, startVal = 0, dragging = false;
        el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            dragging = true;
            startY = e.clientY;
            startVal = parseFloat(input.value);
            el.setPointerCapture(e.pointerId);
            el.classList.add('is-dragging');
            document.body.classList.add('knob-dragging');
            el.dispatchEvent(new CustomEvent('knobgrab', { bubbles: true, detail: { input } }));
            e.preventDefault();
        });
        el.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const min = parseFloat(input.min), max = parseFloat(input.max);
            const range = max - min;
            const px = e.shiftKey ? 600 : 160;
            const dv = ((startY - e.clientY) / px) * range;
            const nv = clamp(input, startVal + dv);
            if (nv !== parseFloat(input.value)) {
                input.value = nv;
                update(input);
                emit(input);
            }
        });
        const endDrag = () => {
            if (!dragging) return;
            dragging = false;
            el.classList.remove('is-dragging');
            document.body.classList.remove('knob-dragging');
        };
        el.addEventListener('pointerup', endDrag);
        el.addEventListener('pointercancel', endDrag);
        el.addEventListener('lostpointercapture', endDrag);

        // --- wheel
        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            const min = parseFloat(input.min), max = parseFloat(input.max);
            const step = parseFloat(input.step) || 1;
            const big = (max - min) / 50;
            const delta = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? step : Math.max(step, big));
            const nv = clamp(input, parseFloat(input.value) + delta);
            if (nv !== parseFloat(input.value)) { input.value = nv; update(input); emit(input); }
        }, { passive: false });

        // --- keyboard
        el.addEventListener('keydown', (e) => {
            const min = parseFloat(input.min), max = parseFloat(input.max);
            const step = parseFloat(input.step) || 1;
            const big = Math.max(step, (max - min) / 20);
            let nv = null;
            switch (e.key) {
                case 'ArrowUp': case 'ArrowRight': nv = parseFloat(input.value) + (e.shiftKey ? big : step); break;
                case 'ArrowDown': case 'ArrowLeft': nv = parseFloat(input.value) - (e.shiftKey ? big : step); break;
                case 'Home': nv = min; break;
                case 'End': nv = max; break;
                default: return;
            }
            e.preventDefault();
            nv = clamp(input, nv);
            if (nv !== parseFloat(input.value)) { input.value = nv; update(input); emit(input); }
        });

        // --- reset
        el.addEventListener('dblclick', () => {
            const k = registry.get(input);
            input.value = clamp(input, k.initial);
            update(input);
            emit(input);
        });

        input.addEventListener('input', () => update(input));
        input.addEventListener('change', () => update(input));
        update(input);
    }

    function enhanceAll(root = document) {
        root.querySelectorAll('input[type="range"][data-knob]').forEach(enhance);
    }

    function set(input, value, { emit: doEmit = false } = {}) {
        if (typeof input === 'string') input = document.getElementById(input);
        if (!input) return;
        input.value = clamp(input, Number(value));
        update(input);
        if (doEmit) emit(input);
    }

    /** Map a normalised 0..1 value (MIDI CC) onto the knob's range. */
    function setNormalized(input, t, opts) {
        if (typeof input === 'string') input = document.getElementById(input);
        if (!input) return;
        const min = parseFloat(input.min), max = parseFloat(input.max);
        set(input, min + (max - min) * Math.max(0, Math.min(1, t)), opts);
    }

    function refresh(input) {
        if (typeof input === 'string') input = document.getElementById(input);
        if (input) update(input);
    }

    function element(input) {
        if (typeof input === 'string') input = document.getElementById(input);
        const k = input ? registry.get(input) : null;
        return k ? k.el : null;
    }

    return { enhance, enhanceAll, set, setNormalized, refresh, format: fmt, element };
})();
