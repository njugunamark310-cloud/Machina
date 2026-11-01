// MACHINA - live horsepower and torque readout.
// Reads window.machina.engine (rpm + boost) from script.js. Nothing else is changed.
// Add to your HTML after script.js:   <script src="hp.js" defer></script>
(function () {
    // ---- Tune these to change the engine's output ----
    const BASE_HP = 144;   // power at 7000 RPM with zero boost (2.0L, after losses)
    const MAX_RPM = 7000;  // same as script.js
    const SHOW_KW = false; // true = show kW instead of HP

    // Use your own elements if they exist, otherwise create a small floating readout.
    let hpEl = document.querySelector("#hp-value");
    let nmEl = document.querySelector("#torque-value");

    if (!hpEl) {
        const box = document.createElement("div");
        box.style.cssText =
            "position:fixed;top:12px;left:12px;z-index:40;padding:8px 12px;" +
            "border:1px solid rgba(0,229,255,.45);border-radius:10px;" +
            "background:rgba(5,8,15,.85);color:#cfefff;" +
            "font:600 13px/1.4 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em";
        box.innerHTML =
            '<div style="color:#ff8a00;font-size:20px"><span id="hp-value">0</span> ' +
            '<span style="font-size:12px;color:#7fdcff">' + (SHOW_KW ? "KW" : "HP") + "</span></div>" +
            '<div><span id="torque-value">0</span> <span style="color:#7fdcff">NM</span></div>';
        document.body.appendChild(box);
        hpEl = box.querySelector("#hp-value");
        nmEl = box.querySelector("#torque-value");
    }

    function calc(rpm, boost) {
        // Power rises with rpm and with absolute intake pressure (1 + boost bar).
        // A small turbo-lag factor trims power below ~2500 RPM.
        const lag = 0.6 + 0.4 * Math.min(rpm / 2500, 1);
        const hp = BASE_HP * (1 + boost) * (rpm / MAX_RPM) * lag;
        const nm = rpm > 300 ? (hp * 7120.9) / rpm : 0; // torque = power / angular speed
        return { hp, nm };
    }

    setInterval(function () {
        const sim = window.machina && window.machina.engine;
        if (!sim) return;

        const rpm = Number.isFinite(sim.rpm) ? sim.rpm : 0;
        const boost = Number.isFinite(sim.boost) ? Math.max(sim.boost, 0) : 0;
        const out = calc(rpm, boost);

        hpEl.textContent = Math.round(SHOW_KW ? out.hp * 0.7457 : out.hp);
        if (nmEl) nmEl.textContent = Math.round(out.nm);
    }, 100);
})();