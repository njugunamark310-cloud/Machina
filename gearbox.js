import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// 8 speed DCT gearbox with torque converter

const MODULE = 0.011;                       // pitch radius per tooth (scene units)
const TWO_PI = Math.PI * 2;
 
const GEARS = [
    { gear: -1, label: "R", ratio: 3.32, elements: "ACD" },
    { gear: 1, label: "1", ratio: 4.71, elements: "ABC" },
    { gear: 2, label: "2", ratio: 3.14, elements: "ABD" },
    { gear: 3, label: "3", ratio: 2.11, elements: "ABE" },
    { gear: 4, label: "4", ratio: 1.67, elements: "ADE" },
    { gear: 5, label: "5", ratio: 1.29, elements: "CDE" },
    { gear: 6, label: "6", ratio: 1.00, elements: "BDE" },
    { gear: 7, label: "7", ratio: 0.84, elements: "BCE" },
    { gear: 8, label: "8", ratio: 0.67, elements: "BCD" }
];
const ELEMENTS = ["A", "B", "C", "D", "E"];
const TOP_GEAR = 8;

const FINAL_DRIVE = 3.15;
const WHEEL_RADIUS = 0.33;
const IDLE_RPM = 800;
const REDLINE = 7000;
const MASS = 1600;
const ROLLING_N = 171;
const DRAG_K = 0.409;
const BRAKE_N = 14000;
const ENGINE_INERTIA = 0.28;                // kg m^2 (flywheel + converter pump)
const CONVERTER_K = 30;                     // pump capacity factor
const STALL_MULT = 1.9;                     // torque multiplication at stall

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const approach = (current, target, rate, dt) =>
    current + (target - current) * (1 - Math.exp(-rate * dt));
const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
 
const gearEntry = (g) => GEARS.find((e) => e.gear === g);
const gearRatio = (g) => (g === 0 ? 0 : gearEntry(g).ratio);
const GEAR_LABEL = (g) => (g === -1 ? "R" : g === 0 ? "N" : String(g));
const ordinal = (g) => (g === 1 ? "1st" : g === 2 ? "2nd" : g === 3 ? "3rd" : `${g}th`);

// Engine Turbo

const TORQUE_POINTS = [
    [0, 80], [800, 120], [1500, 190], [2500, 250],
    [4500, 270], [6000, 240], [7000, 180], [9000, 100]
];

function torqueCurve(rpm) {
    for (let i = 1; i < TORQUE_POINTS.length; i++) {
        const [r1, t1] = TORQUE_POINTS[i];
        if (rpm <= r1) {
            const [r0, t0] = TORQUE_POINTS[i - 1];
            return t0 + ((rpm - r0) / (r1 - r0)) * (t1 - t0);
        }
    }
    return TORQUE_POINTS[TORQUE_POINTS.length - 1][1];
}

// planetary gear geometry 
// Three sets in series. Ns + Nr = Ns + (Ns + 2 Np), so the ring has Ns + 2 Np teeth.
const PLANETARY_SETS = [
    { name: "Set 1", sun: 28, planet: 16, planets: 4, x: -0.62 },
    { name: "Set 2", sun: 32, planet: 14, planets: 4, x: 0.14 },
    { name: "Set 3", sun: 36, planet: 12, planets: 4, x: 0.82 }
].map((s) => ({ ...s, ring: s.sun + 2 * s.planet, orbit: (s.sun + s.planet) * MODULE }));

// Sun speed multiple of the turbine for each set. The carriers all ride on the
// output, so a lower gear (bigger ratio) makes suns spin much faster than carriers.
const SUN_SPEED = [1.0, 0.62, 0.38];
 
const wrapCentered = (x, period) =>
    ((((x + period / 2) % period) + period) % period) - period / 2;
 
// External mesh: angle of gear B meshing gear A. phi is the direction from A to B.
function meshPartner(thetaA, teethA, teethB, phi) {
    return -(teethA / teethB) * (thetaA - phi) + phi + Math.PI - Math.PI / teethB;
}

// Internal ring angle that meshes with a planet. delta* are tooth-centre offsets
// from the contact direction; the ring must have a tooth where the planet has a gap.
function ringAngle(thetaPlanet, planetTeeth, ringTeeth, phi) {
    const dp = wrapCentered(phi - thetaPlanet, TWO_PI / planetTeeth);
    const rp = planetTeeth * MODULE;
    const rr = ringTeeth * MODULE;
    const pitch = TWO_PI * MODULE;
    const dr = wrapCentered((rp * dp + pitch / 2) / rr, TWO_PI / ringTeeth);
    return phi - dr;
}

// Everything is derived from the sun and carrier angle, so teeth never clash.
function planetaryAngles(set, thetaSun, thetaCarrier) {
    const planets = [];
    let ring = 0;
    for (let i = 0; i < set.planets; i++) {
        const phi = thetaCarrier + (i / set.planets) * TWO_PI;
        const spin = meshPartner(thetaSun, set.sun, set.planet, phi);
        planets.push({ phi, spin });
        if (i === 0) ring = ringAngle(spin, set.planet, set.ring, phi);
    }
    return { planets, ring };
}
 
// shift schedule
// Upshift rpm and kickdown depend on throttle; sport mode holds gears longer.
function upshiftRpm(throttle, sport) {
    const base = sport ? 4300 : 2300;
    const span = sport ? 2300 : 3000;
    return base + clamp(throttle, 0, 1) * span;
}
function downshiftRpm(throttle, sport) {
    return (sport ? 2600 : 1300) + clamp(throttle, 0, 1) * (sport ? 1900 : 1700);
}

// Drivetrain state
function createDrivetrain() {
    return {
        selector: "P",       // P R N D S M
        gear: 0,             // gear currently carrying torque (signed, 0 = none)
        targetGear: 0,
        fromGear: 0,
        shift: 0,            // 0..1 progress of the active shift (0 = none)
        shifting: false,
        shiftTimer: 0,
        shiftTime: 0.16,
        shiftSeq: 0,         // increments on every shift, for sound and UI
        shiftKind: "",       // "UP" | "DOWN"
        holdTimer: 0,        // blocks a second shift right after the first
        manualGear: 1,
        elements: { A: 0, B: 0, C: 0, D: 0, E: 0 },
        speed: 0,
        rpm: IDLE_RPM,
        omega: (IDLE_RPM * TWO_PI) / 60,
        turbineRpm: 0,
        throttle: 0,
        throttleRate: 0,
        brake: 0,
        running: true,
        lockup: 0,           // 0 = converter open, 1 = locked
        slip: 0,
        torqueMult: 1,
        inputRpm: 0,
        outputRpm: 0,
        engineTorque: 0,
        wheelTorque: 0,
        speedKmh: 0,
        overRev: false,
        ratioNow: 0,
        message: "",
        messageTimer: 0
    };
}
 
function say(s, text, time = 2) { s.message = text; s.messageTimer = time; }
 
function requestSelector(s, sel) {
    if (sel === s.selector) return { ok: true };
    const moving = Math.abs(s.speed) > 1.2;
 
    if ((sel === "P") && moving) { say(s, "PARK BLOCKED: STILL MOVING"); return { ok: false }; }
    if (sel === "R" && s.speed > 1.2) { say(s, "REVERSE BLOCKED: STOP FIRST"); return { ok: false }; }
    if ((sel === "D" || sel === "S" || sel === "M") && s.speed < -1.2) { say(s, "DRIVE BLOCKED: STOP FIRST"); return { ok: false }; }
 
    s.selector = sel;
    if (sel === "R") startShift(s, -1);
    else if (sel === "P" || sel === "N") startShift(s, 0);
    else if (sel === "M") s.manualGear = clamp(s.gear > 0 ? s.gear : 1, 1, TOP_GEAR);
    else if (s.gear <= 0) startShift(s, 1);
    return { ok: true };
}

// paddle shift (manual mode)
function paddleShift(s, delta) {
    if (s.selector !== "M" && (s.selector === "D" || s.selector === "S")) {
        s.selector = "M";
        s.manualGear = clamp(s.gear > 0 ? s.gear : 1, 1, TOP_GEAR);
    }
    if (s.selector !== "M") return;
    s.manualGear = clamp(s.manualGear + delta, 1, TOP_GEAR);
}
 
function startShift(s, target) {
    if (target === s.targetGear && !s.shifting) return;
    s.fromGear = s.gear;
    s.targetGear = target;
    s.shifting = true;
    s.shift = 0;
    s.shiftTimer = 0;
    s.shiftSeq += 1;
    const toward = Math.abs(target);
    const away = Math.abs(s.fromGear);
    s.shiftKind = target === 0 || toward < away ? "DOWN" : "UP";
// Snappy: sport and kickdown shifts are the quickest; garage shifts are gentler.
    const garage = target <= 0 || s.fromGear <= 0 || (target < 0 && s.fromGear > 0);
    s.shiftTime = garage ? 0.45 : s.selector === "S" || s.selector === "M" ? 0.11 : s.throttle > 0.7 ? 0.12 : 0.17;
}

function updateElements(s, dt) {
    const target = (g) => (g === 0 ? "" : gearEntry(g).elements);
    const from = target(s.fromGear);
    const to = target(s.shifting ? s.targetGear : s.gear);
    for (const e of ELEMENTS) {
        const was = from.includes(e);
        const will = to.includes(e);
        let value = was && will ? 1 : will ? s.shift : was ? 1 - s.shift : 0;
        if (!s.shifting) value = will ? 1 : 0;
        s.elements[e] = value;
    }
}

function chooseGear(s, dt) {
    if (s.holdTimer > 0) s.holdTimer -= dt;
    if (s.shifting || s.holdTimer > 0) return;
    const g = s.gear;
 
    if (s.selector === "D" || s.selector === "S") {
        if (g <= 0) { startShift(s, 1); return; }
        const sport = s.selector === "S";
        const kickdown = s.throttle > 0.92 && s.throttleRate > 1.2;
        const wheelRpm = (Math.abs(s.speed) / (TWO_PI * WHEEL_RADIUS)) * 60;
        const rpmIn = (n) => wheelRpm * FINAL_DRIVE * gearRatio(n);
 
        if (g < TOP_GEAR && rpmIn(g) > upshiftRpm(s.throttle, sport) && rpmIn(g + 1) > 1200) {
            startShift(s, g + 1);
        } else if (g > 1 && (rpmIn(g) < downshiftRpm(s.throttle, sport) || (kickdown && rpmIn(g - 1) < 6200 && s.rpm < 4500 && g > 2))) {
            startShift(s, kickdown && rpmIn(g - 2) < 5800 && g > 3 ? g - 2 : g - 1);
        }
    } else if (s.selector === "M") {
        if (g > 0 && s.manualGear !== g) startShift(s, s.manualGear);
        else if (g <= 0) startShift(s, s.manualGear);
        // auto upshift just before the limiter, auto downshift to stop stalling
        const wheelRpm = (Math.abs(s.speed) / (TWO_PI * WHEEL_RADIUS)) * 60;
        if (g > 1 && wheelRpm * FINAL_DRIVE * gearRatio(g) < 1000) s.manualGear = g - 1;
        if (g > 0 && g < TOP_GEAR && s.rpm > REDLINE - 60 && s.throttle > 0.5) s.manualGear = g + 1;
    }
}
 
function stepDrivetrain(s, dt, ctrl) {
    const running = ctrl.running !== false;
    s.running = running;
    const prevThrottle = s.throttle;
    s.throttle = running ? clamp(ctrl.throttle, 0, 1) : 0;
    s.throttleRate = approach(s.throttleRate, (s.throttle - prevThrottle) / Math.max(dt, 1e-4), 12, dt);
    s.brake = clamp(ctrl.brake, 0, 1);
 
    if (s.messageTimer > 0) { s.messageTimer -= dt; if (s.messageTimer <= 0) s.message = ""; }
 
    chooseGear(s, dt);

    // Shift progress: fast ramp, ratio blends between the old and new gear
    if (s.shifting) {
        s.shiftTimer += dt;
        s.shift = clamp(s.shiftTimer / s.shiftTime, 0, 1);
        if (s.shift >= 1) {
            s.shifting = false;
            s.gear = s.targetGear;
            s.fromGear = s.gear;
            s.shift = 0;
            s.holdTimer = s.shiftTime > 0.3 ? 0.2 : 0.55;
        }
    }
    updateElements(s, dt);

     const e = smooth(s.shift);
    const ratioFrom = gearRatio(s.fromGear);
    const ratioTo = gearRatio(s.targetGear);
    const ratio = s.shifting ? ratioFrom + (ratioTo - ratioFrom) * e : gearRatio(s.gear);
    const dirGear = s.shifting ? s.targetGear : s.gear;
    const dir = dirGear < 0 ? -1 : 1;
    s.ratioNow = ratio;
 
    const overall = ratio * FINAL_DRIVE;
    const engaged = ratio > 0 && s.selector !== "P" && s.selector !== "N";
 
    // Torque converter lock-up: closes in higher gears at steady cruise, opens
    // under hard acceleration in low gear, and while shifting.
    const wantLock = engaged && s.gear >= 3 && !s.shifting && (s.throttle < 0.85 || s.gear >= 5) && s.speed > 6 && s.rpm > 1400;
    s.lockup = approach(s.lockup, wantLock ? 1 : 0, wantLock ? 5 : 14, dt);
 
    // Shift torque cut: a brief ignition retard mid-shift gives the sharp feel
    const torqueCut = s.shifting && s.shiftKind === "UP" ? 1 - 0.55 * Math.sin(Math.PI * e) : 1;
 
    const steps = 8;
    const h = dt / steps;
    let turbineTorque = 0;
    let slipRpm = 0;
 
    for (let i = 0; i < steps; i++) {
        const rpm = (s.omega * 60) / TWO_PI;
        const wheelRpm = (s.speed / (TWO_PI * WHEEL_RADIUS)) * 60;
        const turbine = engaged ? Math.abs(wheelRpm) * overall : 0;
        const sr = rpm > 50 ? clamp(turbine / rpm, 0, 1.2) : 0;
        const slipFrac = 1 - sr;
        
         // fluid coupling torque (stall at sr=0, falls to zero as sr -> 1)
        const kfac = clamp(slipFrac * 5, -1, 1);
        const pump = CONVERTER_K * (rpm / 1000) * (rpm / 1000) * kfac;
        const mult = 1 + (STALL_MULT - 1) * clamp(1 - sr / 0.85, 0, 1);
 
        // locked clutch behaves like a stiff damper
        const stiff = clamp(3.2 * (rpm - turbine), -650, 650);
 
        const reactOnEngine = engaged ? (1 - s.lockup) * pump + s.lockup * stiff : 0;
        const toTurbine = engaged ? (1 - s.lockup) * pump * (pump > 0 ? mult : 1) + s.lockup * stiff : 0;
 
        // engine torque with limiter, friction and an idle governor
        const limiter = rpm >= REDLINE ? 0 : 1;
        const friction = rpm > 1 ? 12 + rpm * 0.011 : 0;
        const idleHold = running ? clamp((IDLE_RPM - rpm) * 0.55, 0, 140) : 0;
        const engineTorque = running
            ? (s.throttle * torqueCurve(rpm) * limiter * torqueCut - friction * (1 - s.throttle) + idleHold)
            : -friction;
        s.engineTorque = engineTorque;
 
        s.omega = Math.max(0, s.omega + ((engineTorque - reactOnEngine) / ENGINE_INERTIA) * h);


        // vehicle
        const driveForce = engaged ? (dir * toTurbine * overall * 0.93) / WHEEL_RADIUS : 0;
        const v = s.speed;
        const parked = s.selector === "P";
        const holdBrake = parked ? 1e6 : 0;
        const brakeForce = s.brake * BRAKE_N + holdBrake;
 
        if (Math.abs(v) < 0.04 && Math.abs(driveForce) <= ROLLING_N + brakeForce) {
            s.speed = 0;
        } else {
            const sign = v !== 0 ? Math.sign(v) : Math.sign(driveForce || 1);
            const resist = ROLLING_N + DRAG_K * v * v + brakeForce;
            const next = v + ((driveForce - sign * resist) / MASS) * h;
            s.speed = v !== 0 && Math.sign(next) !== Math.sign(v) && Math.abs(driveForce) < resist ? 0 : next;
        }
 
        turbineTorque = toTurbine;
        slipRpm = rpm - turbine;
    }
 
    s.rpm = clamp((s.omega * 60) / TWO_PI, 0, 9000);
    s.overRev = s.rpm > REDLINE + 150;
    s.slip = engaged ? slipRpm : 0;
    s.torqueMult = engaged && s.lockup < 0.5 ? 1 + (STALL_MULT - 1) * clamp(1 - (s.turbineRpm / Math.max(s.rpm, 1)) / 0.85, 0, 1) : 1;
 
    s.wheelTorque = (dir * turbineTorque * overall * 0.93);
    s.speedKmh = s.speed * 3.6;
    s.outputRpm = (s.speed / (TWO_PI * WHEEL_RADIUS)) * 60 * FINAL_DRIVE;
    s.turbineRpm = engaged ? Math.abs(s.outputRpm) * ratio : 0;
    s.inputRpm = approach(s.inputRpm, s.turbineRpm, 30, dt);
 
    return s;
}

// driver aid: demo drive
function createAuto() { return { t: 0, demo: false }; }
 
function autoDrive(s, a, user, dt) {
    a.t += dt;
    let throttle = user.throttle;
    let brake = user.brake;
    if (a.demo) {
        const c = a.t % 44;
        if (c < 3) { throttle = 0; brake = 0; if (s.selector !== "D") requestSelector(s, "D"); }
        else if (c < 24) { throttle = c < 14 ? 0.55 : 1.0; brake = 0; if (c > 14 && s.selector !== "S") requestSelector(s, "S"); }
        else if (c < 34) { throttle = 0; brake = c < 27 ? 0.1 : 0.5; if (s.selector !== "D") requestSelector(s, "D"); }
        else { throttle = 0; brake = 0.75; }
    }
    return { throttle, brake };
}

// gearbox 3D view and controls 

const COLORS = { background: "#05080f", cyan: "#00e5ff", orange: "#ff8a00" };
const SLOW_MOTION = 40;
const RAD_PER_RPM_SEC = TWO_PI / 60 / SLOW_MOTION;
const FLOOR_Y = -1.3;
 
const $ = (selector) => document.querySelector(selector);
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
 
const container = $("#gearbox-canvas");
 
if (container) init(container);
else console.warn("Gearbox viewer container (#gearbox-canvas) was not found.");
 
function init(container) {
    const ui = {
        reset: $("#gb-reset"), housing: $("#gb-housing"), auto: $("#gb-auto"), demo: $("#gb-demo"),
        throttle: $("#gb-throttle"), clutch: $("#gb-clutch"), brake: $("#gb-brake"),
        gear: $("#gb-gear"), rpm: $("#gb-rpm"), speed: $("#gb-speed"), ratio: $("#gb-ratio"),
        input: $("#gb-input"), output: $("#gb-output"), torque: $("#gb-torque"),
        couplingBar: $("#gb-coupling-bar"), rpmBar: $("#gb-rpm-bar"), message: $("#gb-message"),
        gearButtons: [...document.querySelectorAll("[data-gear]")],
        partName: $("#gb-part-name"), partDesc: $("#gb-part-desc"),
        partMaterial: $("#gb-part-material"), partFunction: $("#gb-part-function"),
        section: $("#gearbox-lab")
    };

// Renderer / scene (MSAA + bloom for crisp edges and glow)
const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.background);
    scene.fog = new THREE.Fog(COLORS.background, 11, 28);
 
    const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.1, 100);
    const cameraStart = new THREE.Vector3(2.9, 1.9, 5.4);
    const targetStart = new THREE.Vector3(-0.15, 0.0, 0);
    camera.position.copy(cameraStart);
 
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", "Interactive 3D simulation of an eight-speed automatic transmission");
    renderer.domElement.style.touchAction = "none";
    container.querySelector(".engine-loading, .gb-loading")?.remove();
    container.appendChild(renderer.domElement);
 
    const composerTarget = new THREE.WebGLRenderTarget(
        Math.max(1, container.clientWidth), Math.max(1, container.clientHeight),
        { type: THREE.HalfFloatType, samples: 4 }
    );
    const composer = new EffectComposer(renderer, composerTarget);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight)), 0.5, 0.6, 0.85
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
 
    const pmrem = new THREE.PMREMGenerator(renderer);
    const studio = new RoomEnvironment();
    scene.environment = pmrem.fromScene(studio, 0.04).texture;
    scene.environmentIntensity = 0.75;
    studio.dispose?.();
    pmrem.dispose();
 
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.minDistance = 2.5;
    controls.maxDistance = 12;
    controls.maxPolarAngle = Math.PI * 0.52;
    controls.target.copy(targetStart);
 
    scene.add(new THREE.HemisphereLight("#7fdcff", "#1a0f05", 0.5));
    const key = new THREE.DirectionalLight("#ffffff", 2.4);
    key.position.set(3, 5, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 4, bottom: -4, near: 0.5, far: 18 });
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const rim = new THREE.DirectionalLight("#7fdcff", 1.2);
    rim.position.set(-4, 2, -4);
    scene.add(rim);
    const cyanLight = new THREE.PointLight(COLORS.cyan, 18, 10);
    cyanLight.position.set(-4, 1, 2);
    scene.add(cyanLight);
    const orangeLight = new THREE.PointLight(COLORS.orange, 12, 10);
    orangeLight.position.set(3, -1, -2);
    scene.add(orangeLight);
 
    const floor = new THREE.Group();
    floor.position.y = FLOOR_Y;
    const grid = new THREE.GridHelper(24, 48, COLORS.cyan, "#12384f");
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    grid.material.toneMapped = false;
    floor.add(grid);
    const shadowCatcher = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2),
        new THREE.ShadowMaterial({ color: 0x000814, opacity: 0.55 })
    );
    shadowCatcher.position.y = 0.002;
    shadowCatcher.receiveShadow = true;
    floor.add(shadowCatcher);
    scene.add(floor);

// Materials
 const metal = (color, extra = {}) =>
        new THREE.MeshPhysicalMaterial({
            color, metalness: 0.9, roughness: 0.3, clearcoat: 0.25, clearcoatRoughness: 0.35,
            emissive: "#000000", ...extra
        });
 
    const shaftMat = metal("#c3ced9", { roughness: 0.2 });
    const inputShaftMat = metal("#48c9d8", { roughness: 0.25 });
    const hubMat = metal("#6f8196");
    const markMat = new THREE.MeshStandardMaterial({ color: COLORS.orange, emissive: COLORS.orange, emissiveIntensity: 2.5 });
    const gearColors = { sun: "#2b8fa3", planet: "#7a8ea6", ring: "#4a5d72", carrier: "#8a6a4a" };

// Gear geometry: bevelled, with flank points for a rounder tooth
 const GEAR_WIDTH = 0.14;
    const geometryCache = new Map();
 
    function toothProfile(shape, teeth, pitch, internal) {
        const add = internal ? 0.009 : -0.012;      // root offset from pitch circle
        const tipOffset = internal ? -0.0115 : 0.0095;
        const root = pitch + add;
        const tip = pitch + tipOffset;
        const step = TWO_PI / teeth;
        const pts = [[-0.34, root], [-0.22, root * 0.5 + tip * 0.5], [-0.14, tip], [0.14, tip], [0.22, root * 0.5 + tip * 0.5], [0.34, root]];
        const path = shape;
        let first = true;
        for (let k = 0; k < teeth; k++) {
            for (const [off, r] of pts) {
                const a = k * step + off * step;
                const x = Math.cos(a) * r;
                const y = Math.sin(a) * r;
                if (first) { path.moveTo(x, y); first = false; } else path.lineTo(x, y);
            }
        }
        path.closePath();
    }
 
    function extrude(shape, depth) {
        const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: depth - 0.01, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.003,
            bevelOffset: -0.003, bevelSegments: 1, curveSegments: 20
        });
        geometry.translate(0, 0, -(depth - 0.01) / 2);
        geometry.computeVertexNormals();
        return geometry;
    }

// external gear (sun/planet)

function externalGear(teeth, boreRadius, lightening) {
        const id = `ext${teeth}-${boreRadius}-${lightening}`;
        if (geometryCache.has(id)) return geometryCache.get(id);
        const pitch = teeth * MODULE;
        const shape = new THREE.Shape();
        toothProfile(shape, teeth, pitch, false);
        const bore = new THREE.Path();
        bore.absarc(0, 0, boreRadius, 0, TWO_PI, true);
        shape.holes.push(bore);
        if (lightening) {
            for (let i = 0; i < 6; i++) {
                const a = (i / 6) * TWO_PI;
                const hole = new THREE.Path();
                hole.absarc(Math.cos(a) * pitch * 0.58, Math.sin(a) * pitch * 0.58, pitch * 0.17, 0, TWO_PI, true);
                shape.holes.push(hole);
            }
        }
        const geometry = extrude(shape, GEAR_WIDTH);
        geometryCache.set(id, geometry);
        return geometry;
    }

    // internal gear (ring): solid outer band with teeth pointing inward
    function ringGear(teeth) {
        const id = `ring${teeth}`;
        if (geometryCache.has(id)) return geometryCache.get(id);
        const pitch = teeth * MODULE;
        const shape = new THREE.Shape();
        shape.absarc(0, 0, pitch + 0.07, 0, TWO_PI, false);
        const hole = new THREE.Path();
        toothProfile(hole, teeth, pitch, true);
        shape.holes.push(hole);
        const geometry = extrude(shape, GEAR_WIDTH);
        geometryCache.set(id, geometry);
        return geometry;
    }

     // Gear axes run along world X: the pivot turns local Z into world X.
    function makeGear(geometry, color, position, partKey) {
        const mesh = new THREE.Mesh(geometry, metal(color));
        mesh.userData.partKey = partKey;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const pivot = new THREE.Group();
        pivot.rotation.y = Math.PI / 2;
        pivot.position.copy(position);
        pivot.add(mesh);
        return { pivot, mesh };
    }

    // shafts and flywheel /drive plate
    
    const flywheelGroup = new THREE.Group();
    flywheelGroup.position.set(-2.75, 0, 0);
    const flywheel = cylinderAlongX(0.66, 0.66, 0.1, metal("#7c8a98", { roughness: 0.28 }), "flywheel", 64);
    flywheelGroup.add(flywheel);
    const ringGearTeeth = cylinderAlongX(0.68, 0.68, 0.05, metal("#5f6d7b", { roughness: 0.4 }), null, 96);
    ringGearTeeth.position.x = 0.0;
    flywheelGroup.add(ringGearTeeth);
    const flywheelMark = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.05), markMat);
    flywheelMark.position.set(0.055, 0.5, 0);
    flywheelGroup.add(flywheelMark);
    root.add(flywheelGroup);

    // Input shaft (turbine -> sun gears)
    const inputGroup = new THREE.Group();
    const inputShaft = cylinderAlongX(0.07, 0.07, 3.7, inputShaftMat, "input-shaft", 32);
    inputShaft.position.x = -0.35;
    inputGroup.add(inputShaft);
    const inputMark = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.035), markMat);
    inputMark.position.set(-1.25, 0.075, 0);
    inputGroup.add(inputMark);
    root.add(inputGroup);

     // Output shaft (carriers -> driveshaft)
    const outputGroup = new THREE.Group();
    const outputShaft = cylinderAlongX(0.095, 0.095, 0.95, shaftMat, "output-shaft", 32);
    outputShaft.position.x = 1.85;
    outputGroup.add(outputShaft);
    const flange = cylinderAlongX(0.3, 0.3, 0.08, metal("#8c9ba8", { roughness: 0.25 }), "flange", 64);
    flange.position.x = 2.25;
    outputGroup.add(flange);
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TWO_PI;
        const bolt = cylinderAlongX(0.026, 0.026, 0.1, metal("#d7e6f5", { roughness: 0.2 }), null, 12);
        bolt.position.set(2.25, Math.cos(a) * 0.22, Math.sin(a) * 0.22);
        outputGroup.add(bolt);
    }
    const flangeMark = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.04), markMat);
    flangeMark.position.set(2.3, 0.24, 0);
    outputGroup.add(flangeMark);
    root.add(outputGroup);

    // Torque Converter
     const converter = new THREE.Group();
    converter.position.set(-2.1, 0, 0);
    root.add(converter);

    // translucent cover shell (lathe profile of a flattened doughnut)
     const shellPts = [];
    for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * TWO_PI;            // full ellipse in the (radius, axial) plane
        shellPts.push(new THREE.Vector2(0.43 + Math.cos(t) * 0.27, Math.sin(t) * 0.23));
    }
    const shell = new THREE.Mesh(
        new THREE.LatheGeometry(shellPts, 96).rotateZ(Math.PI / 2),
        new THREE.MeshPhysicalMaterial({
            color: "#4a5f77", metalness: 0.7, roughness: 0.25, transparent: true, opacity: 0.22,
            side: THREE.DoubleSide, depthWrite: false
        })
    );
    addPick(shell, "converter");
    converter.add(shell);
 
    const impeller = new THREE.Group();   // spins with the engine
    const turbineGroup = new THREE.Group(); // spins with the input shaft
    const stator = new THREE.Group();     // locked by the one-way clutch
    converter.add(impeller, turbineGroup, stator);
 
    const bladeMat = {
        impeller: metal("#e87532", { roughness: 0.3 }),
        turbine: metal("#48c9d8", { roughness: 0.3 }),
        stator: metal("#c4ccd3", { roughness: 0.25 })
    };
    const bladeGeo = new THREE.BoxGeometry(0.2, 0.2, 0.012);
    const placeBlades = (group, material, x, tilt, count, key) => {
        for (let i = 0; i < count; i++) {
            const a = (i / count) * TWO_PI;
            const blade = new THREE.Mesh(bladeGeo, material);
            blade.position.set(x, Math.cos(a) * 0.43, Math.sin(a) * 0.43);
            blade.rotation.set(a + Math.PI / 2, tilt, 0, "XYZ");
            blade.castShadow = true;
            addPick(blade, key);
            group.add(blade);
        }
    };
    placeBlades(impeller, bladeMat.impeller, -0.12, 0.45, 30, "impeller");
    placeBlades(turbineGroup, bladeMat.turbine, 0.12, -0.45, 30, "turbine");
    placeBlades(stator, bladeMat.stator, 0, 0.0, 16, "stator-blades");

    //lock-up clutch piston slides toward the cover when the converter locks
    const lockPiston = cylinderAlongX(0.34, 0.34, 0.03, metal("#9a6a3a", { metalness: 0.4, roughness: 0.6 }), "lockup", 48);
    lockPiston.position.x = 0.22;
    turbineGroup.add(lockPiston);
    const lockGlow = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.012, 8, 64).rotateY(Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: "#00e5ff", emissive: "#00e5ff", emissiveIntensity: 0, toneMapped: false })
    );
    lockGlow.position.x = 0.22;
    converter.add(lockGlow);
 
    const hub = cylinderAlongX(0.12, 0.12, 0.62, metal("#8c9ba8", { roughness: 0.25 }), null, 32);
    hub.position.x = 0.05;
    converter.add(hub);
 
    // planetary sets
    const planetary = PLANETARY_SETS.map((set, index) => {
        const sun = makeGear(externalGear(set.sun, 0.075, false), gearColors.sun, new THREE.Vector3(set.x, 0, 0), `sun-${index}`);
        pickables.push(sun.mesh);
        root.add(sun.pivot);
 
        const ring = makeGear(ringGear(set.ring), gearColors.ring, new THREE.Vector3(set.x, 0, 0), `ring-${index}`);
        pickables.push(ring.mesh);
        root.add(ring.pivot);
 
        const carrier = new THREE.Group();
        carrier.position.set(set.x, 0, 0);
        root.add(carrier);
 
        const plateMat = metal(gearColors.carrier, { roughness: 0.35 });
        for (const side of [-1, 1]) {
            const plate = cylinderAlongX(set.orbit + 0.06, set.orbit + 0.06, 0.016, plateMat, side === -1 ? `carrier-${index}` : null, 64);
            plate.position.x = side * 0.095;
        
     // keep the plate clear: cut-out look via a darker inner disc
            carrier.add(plate);
            const hubDisc = cylinderAlongX(0.1, 0.1, 0.03, shaftMat, null, 32);
            hubDisc.position.x = side * 0.095;
            carrier.add(hubDisc);
        }
        const planets = [];
        for (let i = 0; i < set.planets; i++) {
            const planet = makeGear(externalGear(set.planet, 0.03, false), gearColors.planet, new THREE.Vector3(set.x, 0, 0), `planet-${index}`);
            pickables.push(planet.mesh);
            root.add(planet.pivot);
            const pin = cylinderAlongX(0.026, 0.026, 0.22, shaftMat, null, 16);
            carrier.add(pin);
            planets.push({ ...planet, pin, index: i });
        }
        // carrier pins ride with the carrier group, so place them at their base phase
        planets.forEach((p, i) => {
            const phi = (i / set.planets) * TWO_PI;
            p.pin.position.set(0, Math.sin(phi) * set.orbit, -Math.cos(phi) * set.orbit);
        });
        return { set, sun, ring, carrier, planets };
    });

    // shift elements (clutch / brake packs)
    // Alternating steel and friction discs. Applied pack: discs squeeze together and glow.
    const ELEMENT_X = { A: -1.18, B: -0.2, C: 0.34, D: 1.12, E: 1.55 };
    const steelMat = metal("#c3ced9", { roughness: 0.25 });
    const frictionMat = metal("#8a5a3a", { metalness: 0.3, roughness: 0.75 });
    const elementPacks = {};
 
    for (const name of ELEMENTS) {
        const pack = new THREE.Group();
        pack.position.set(ELEMENT_X[name], 0, 0);
        const discs = [];
        for (let i = 0; i < 6; i++) {
            const friction = i % 2 === 1;
            const outer = name === "A" || name === "B" ? 0.56 : 0.5;
            const disc = cylinderAlongX(outer, outer, 0.018, friction ? frictionMat : steelMat, i === 0 ? `element-${name}` : null, 64);
            disc.position.x = (i - 2.5) * 0.034;
            disc.userData.baseX = disc.position.x;
            pack.add(disc);
            discs.push(disc);
        }
        const hubRing = cylinderAlongX(0.17, 0.17, 0.18, hubMat, null, 32);
        pack.add(hubRing);
        const glow = new THREE.Mesh(
            new THREE.TorusGeometry(0.56, 0.014, 10, 80).rotateY(Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: "#ff8a00", emissive: "#ff8a00", emissiveIntensity: 0, toneMapped: false })
        );
        pack.add(glow);
        
         // piston plate that pushes the discs together
        const piston = cylinderAlongX(0.3, 0.3, 0.025, metal("#e87532", { roughness: 0.3 }), null, 32);
        piston.position.x = 0.15;
        pack.add(piston);
 
        // element letter label on a sprite
        const label = makeLabel(name);
        label.position.set(0, 0.74, 0);
        pack.add(label);
 
        root.add(pack);
        elementPacks[name] = { pack, discs, glow, piston, label };
    }
       function makeLabel(text) {
        const canvas = document.createElement("canvas");
        canvas.width = 128; canvas.height = 128;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "rgba(5,8,15,0.7)";
        ctx.beginPath(); ctx.arc(64, 64, 52, 0, TWO_PI); ctx.fill();
        ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 5; ctx.stroke();
        ctx.fillStyle = "#ffffff"; ctx.font = "bold 64px monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(text, 64, 68);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, toneMapped: false }));
        sprite.scale.setScalar(0.2);
        sprite.renderOrder = 8;
        return sprite;
    }
 
//Valve body: hydraulic channels light up with element pressure

     const valveBody = new THREE.Group();
    const valveBlock = new THREE.Mesh(new RoundedBoxGeometry(3.6, 0.16, 0.9, 3, 0.03), metal("#2d3d4f", { roughness: 0.45 }));
    valveBlock.position.set(-0.1, -0.98, 0);
    valveBlock.castShadow = true;
    valveBody.add(valveBlock);
    addPick(valveBlock, "valve-body");
    const channelMats = {};
    for (const name of ELEMENTS) {
        const x = ELEMENT_X[name];
        channelMats[name] = new THREE.MeshStandardMaterial({ color: "#0a3a48", emissive: "#00e5ff", emissiveIntensity: 0, toneMapped: false });
        const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 12), channelMats[name]);
        feed.position.set(x, -0.77, 0);
        valveBody.add(feed);
        const groove = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.8), channelMats[name]);
        groove.position.set(x, -0.896, 0);
        valveBody.add(groove);
    }
    root.add(valveBody);

// Housing
   const housingSize = [5.0, 1.95, 1.75];
    const housing = new THREE.Group();
    housing.position.set(-0.2, -0.05, 0);
    housing.add(new THREE.Mesh(
        new RoundedBoxGeometry(...housingSize, 4, 0.08),
        new THREE.MeshPhysicalMaterial({ color: "#2a3b4d", metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.07, depthWrite: false })
    ));
    housing.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(...housingSize)),
        new THREE.LineBasicMaterial({ color: new THREE.Color(COLORS.cyan).multiplyScalar(1.4), transparent: true, opacity: 0.75, toneMapped: false })
    ));
    scene.add(housing);
 
    root.traverse((o) => { if (o.isMesh && o.material && !o.material.isMeshBasicMaterial) { o.castShadow = o.castShadow || false; } });

    // part info
     const staticInfo = {
        "flywheel": ["Drive Plate / Flywheel", "Bolted to the crankshaft. In an automatic it is a thin drive plate that turns the torque converter cover at engine speed.", "Steel simulation", "Carries engine torque into the converter."],
        "input-shaft": ["Input Shaft", "Splined to the converter turbine. It feeds the sun gears of the three planetary sets, so it turns at turbine speed, not engine speed.", "Hardened steel simulation", "Delivers torque to the gear sets."],
        "output-shaft": ["Output Shaft", "Joined to the planet carriers. It always turns with the wheels, multiplied by the final drive.", "Hardened steel simulation", "Sends torque to the driveshaft."],
        "flange": ["Output Flange", "Where the gearbox hands torque to the driveshaft. The AWD module will connect here.", "Forged steel simulation", "Connects to the driveshaft."],
        "converter": ["Torque Converter", "A fluid coupling between engine and gearbox. It lets the engine idle at a standstill and multiplies torque up to about 1.9x at stall, then locks up at cruise to avoid slip losses.", "Welded steel, transparent shell", "Replaces the clutch pedal."],
        "impeller": ["Impeller (Pump)", "Spins with the engine and flings oil outward toward the turbine.", "Stamped steel simulation", "Drives the fluid."],
        "turbine": ["Turbine", "Catches the oil flow and is splined to the input shaft. It lags the impeller when the converter slips.", "Stamped steel simulation", "Receives torque from the fluid."],
        "stator-blades": ["Stator", "Redirects returning oil so it pushes the impeller forward. This is what multiplies torque. A one-way clutch lets it freewheel once speeds match.", "Cast aluminium simulation", "Multiplies torque at low speed."],
        "lockup": ["Lock-up Clutch", "Presses the turbine to the converter cover and bypasses the fluid. Watch the cyan ring: it closes in the higher gears at light throttle.", "Friction lining on steel", "Removes slip for efficiency."],
        "valve-body": ["Valve Body", "The hydraulic brain. Solenoids route pressure to each shift element. Cyan channels light up when their element is applied.", "Aluminium simulation", "Applies and releases the shift elements."]
    };
 
    function infoFor(key) {
        if (staticInfo[key]) return staticInfo[key];
        const index = Number(key.split("-")[1]);
 
        if (key.startsWith("element-")) {
            const name = key.slice(8);
            const gears = GEARS.filter((g) => g.elements.includes(name)).map((g) => g.label).join(", ");
            return [`Shift Element ${name}`, `A stack of steel and friction discs squeezed by a hydraulic piston. It holds or couples part of a planetary set. Applied in gears: ${gears}. (Layout is simplified for this simulation.)`, "Steel and friction lining", "Locks a planetary member."];
        }
        const set = PLANETARY_SETS[index];
        if (!set) return null;
        if (key.startsWith("sun-")) return [`Sun Gear (${set.name})`, `${set.sun} teeth at the centre of the set, driven by the input shaft.`, "Case-hardened steel simulation", "Drives the planets."];
        if (key.startsWith("planet-")) return [`Planet Gears (${set.name})`, `${set.planets} planets of ${set.planet} teeth mesh with both the sun and the ring. They orbit on the carrier while spinning on their own pins.`, "Case-hardened steel simulation", "Transfer torque between sun, ring and carrier."];
        if (key.startsWith("ring-")) return [`Ring Gear (${set.name})`, `${set.ring} internal teeth. Fixing or driving the ring changes the ratio of the set.`, "Case-hardened steel simulation", "Reacts or drives the set."];
        if (key.startsWith("carrier-")) return [`Planet Carrier (${set.name})`, "Holds the planets on their pins. All three carriers are tied to the output shaft in this simplified layout.", "Cast steel simulation", "Carries the planets round."];
        return null;
    }
 
    const MATERIAL_HIGHLIGHT = new THREE.Color("#00e5ff");
    let selected = null;
 
    function showInfo(key) {
        const info = key ? infoFor(key) : null;
        if (ui.partName) ui.partName.textContent = info ? info[0].toUpperCase() : "NO PART SELECTED";
        if (ui.partDesc) ui.partDesc.textContent = info ? info[1] : "Click a component in the gearbox to inspect it.";
        if (ui.partMaterial) ui.partMaterial.textContent = info ? info[2] : "—";
        if (ui.partFunction) ui.partFunction.textContent = info ? info[3] : "—";
    }
    showInfo(null);

    // picking
     const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = null;
 
    const pointerTo = (event) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    };
    const pick = () => {
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(pickables, false)[0];
        return hit ? hit.object : null;
    };
 
    renderer.domElement.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener("pointerup", (e) => {
        if (!downAt) return;
        const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
        downAt = null;
        if (moved > 5) return;
        pointerTo(e);
        const hit = pick();
        if (selected?.material?.emissive) { selected.material.emissive.set("#000000"); selected.material.emissiveIntensity = 0; }
        selected = hit && hit !== selected ? hit : null;
        showInfo(selected ? selected.userData.partKey : null);
    });
    renderer.domElement.addEventListener("pointermove", (e) => {
        if (e.buttons) return;
        pointerTo(e);
        renderer.domElement.style.cursor = pick() ? "pointer" : "grab";
    });

    // simulation + controls
     const sim = createDrivetrain();
    const auto = createAuto();
    let sport = false;
 
    // Shared bus: the engine page publishes bus.engine; link.engine decides whether the
    // engine follows this gearbox (rpm, boost) and the gearbox follows the engine ON/OFF.
    const bus = (window.machina = window.machina || {});
    bus.drivetrain = sim;
    bus.requestSelector = (id) => requestSelector(sim, id);
    bus.link = bus.link || { engine: false };
 
    let linked = false;
    let linkApplied = false;
    const linkButton = $("#gb-link");
 
    const refreshLink = () => {
        if (!linkButton) return;
        const hasEngine = !!bus.engine;
        linkButton.disabled = !hasEngine;
        linkButton.textContent = hasEngine
            ? `ENGINE LINK: ${bus.link.engine ? "ON" : "OFF"}`
            : "ENGINE LINK: NO ENGINE ON PAGE";
        linkButton.classList.toggle("active", hasEngine && bus.link.engine);
    };
    linkButton?.addEventListener("click", () => {
        bus.link.engine = !bus.link.engine;
        refreshLink();
        window.dispatchEvent(new CustomEvent("machina-link-change"));
    });
    window.addEventListener("machina-link-change", refreshLink);
    refreshLink();
 
    const sliders = { throttle: 0, brake: 0 };
    const keys = new Set();
    const keyed = { throttle: 0, brake: 0 };
    let keysEnabled = false;
 
    for (const name of ["throttle", "brake"]) {
        ui[name]?.addEventListener("input", () => { sliders[name] = Number(ui[name].value); });
    }
 
    // The clutch pedal does not exist on an automatic: hide the old slider.
    if (ui.clutch) {
        const wrap = ui.clutch.closest("label") || ui.clutch.closest(".gb-control, .control, .slider-row");
        (wrap || ui.clutch).style.display = "none";
    }
    // old manual gear buttons are replaced by the selector panel below
    ui.gearButtons.forEach((b) => { b.style.display = "none"; });

    // selector panel (P R N D S M + paddles)
    const selectorPanel = document.createElement("div");
    selectorPanel.id = "gb-selector";
    selectorPanel.setAttribute("role", "group");
    selectorPanel.setAttribute("aria-label", "Gear selector");
    selectorPanel.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0;width:100%";
    const buttonClass = ui.gearButtons[0]?.className || "";
    const selectorButtons = {};
 
    const SELECTORS = [["P", "P"], ["R", "R"], ["N", "N"], ["D", "D"], ["S", "SPORT"], ["M", "MANUAL"]];
    for (const [id, label] of SELECTORS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = buttonClass;
        b.textContent = label;
        b.dataset.selector = id;
        b.style.minWidth = id.length === 1 && label.length === 1 ? "44px" : "auto";
        b.addEventListener("click", () => requestSelector(sim, id));
        selectorPanel.appendChild(b);
        selectorButtons[id] = b;
    }
    const paddle = (label, delta, title) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = buttonClass;
        b.textContent = label;
        b.title = title;
        b.addEventListener("click", () => paddleShift(sim, delta));
        selectorPanel.appendChild(b);
        return b;
    };
    paddle("− DOWN", -1, "Downshift (Q)");
    paddle("UP +", 1, "Upshift (E)");
    const statusLine = document.createElement("div");
    statusLine.style.cssText = "flex-basis:100%;font:600 12px/1.4 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;color:#7fdcff;min-height:1.4em";
    selectorPanel.appendChild(statusLine);
 
    const anchor = ui.gearButtons[0]?.parentElement;
    if (anchor) anchor.parentElement.insertBefore(selectorPanel, anchor);
    else if (ui.section) ui.section.appendChild(selectorPanel);
 
    document.addEventListener("pointerdown", (event) => {
        keysEnabled = !!ui.section && ui.section.contains(event.target);
    });
 
    document.addEventListener("keydown", (event) => {
        if (!keysEnabled || (event.repeat && event.code !== "Space")) return;
        if (event.target.closest?.("input[type=text], textarea")) return;
        const selectorKeys = { KeyP: "P", KeyR: "R", KeyN: "N", KeyD: "D", KeyG: "S", KeyM: "M" };
        if (event.code === "KeyW" || event.code === "KeyS") { keys.add(event.code); event.preventDefault(); }
        else if (selectorKeys[event.code]) { requestSelector(sim, selectorKeys[event.code]); event.preventDefault(); }
        else if (event.code === "KeyE") { paddleShift(sim, 1); event.preventDefault(); }
        else if (event.code === "KeyQ") { paddleShift(sim, -1); event.preventDefault(); }
    });
    document.addEventListener("keyup", (event) => keys.delete(event.code));
    window.addEventListener("blur", () => keys.clear());
 
    const setToggle = (button, on, label) => {
        if (!button) return;
        button.textContent = `${label}: ${on ? "ON" : "OFF"}`;
        button.classList.toggle("active", on);
    };

    // The old AUTO button becomes the SPORT toggle (sharper shifts, higher shift points)
    ui.auto?.addEventListener("click", () => {
        sport = !sport;
        if (sport) { if (sim.selector === "D" || sim.selector === "N" || sim.selector === "P") requestSelector(sim, sim.selector === "D" ? "S" : sim.selector); }
        else if (sim.selector === "S") requestSelector(sim, "D");
        setToggle(ui.auto, sport, "SPORT MODE");
    });
    ui.demo?.addEventListener("click", () => {
        auto.demo = !auto.demo;
        auto.t = 0;
        if (!auto.demo) { for (const n of ["throttle", "brake"]) { sliders[n] = 0; if (ui[n]) ui[n].value = 0; } }
        setToggle(ui.demo, auto.demo, "DEMO DRIVE");
    });
 
    let housingOn = true;
    ui.housing?.addEventListener("click", () => {
        housingOn = !housingOn;
        housing.visible = housingOn;
        setToggle(ui.housing, housingOn, "HOUSING");
    });
    setToggle(ui.auto, false, "SPORT MODE");
    setToggle(ui.demo, false, "DEMO DRIVE");
    setToggle(ui.housing, true, "HOUSING");
 
    // camera fly-to
    const tween = { active: false, t: 0, fromP: new THREE.Vector3(), fromT: new THREE.Vector3() };
    controls.addEventListener("start", () => { tween.active = false; });
    ui.reset?.addEventListener("click", () => {
        if (prefersReducedMotion) { camera.position.copy(cameraStart); controls.target.copy(targetStart); return; }
        tween.fromP.copy(camera.position);
        tween.fromT.copy(controls.target);
        tween.t = 0;
        tween.active = true;
    });
 
    const angle = { flywheel: 0, input: 0, output: 0 };
 
    function stepSim(dt) {
        keyed.throttle = approach(keyed.throttle, keys.has("KeyW") ? 1 : 0, 7, dt);
        keyed.brake = approach(keyed.brake, keys.has("KeyS") ? 1 : 0, 10, dt);
        const hud = bus.hud || { throttle: 0, brake: 0 };
        let user = {
            throttle: Math.max(sliders.throttle, keyed.throttle, hud.throttle),
            brake: Math.max(sliders.brake, keyed.brake, hud.brake)
        };
        if (auto.demo) {
            user = autoDrive(sim, auto, user, dt);
            if (ui.throttle) ui.throttle.value = user.throttle;
            if (ui.brake) ui.brake.value = user.brake;
        }

         // Link to the engine page as soon as it exists (first frame only, so the user can still switch it off).
        if (!linkApplied && bus.engine) {
            linkApplied = true;
            bus.link.engine = true;
            refreshLink();
            window.dispatchEvent(new CustomEvent("machina-link-change"));
        }
        linked = !!(bus.link.engine && bus.engine);
 
        stepDrivetrain(sim, dt, { ...user, running: linked ? bus.engine.running !== false : true });
 
        angle.flywheel += sim.rpm * RAD_PER_RPM_SEC * dt;
        angle.input += sim.inputRpm * RAD_PER_RPM_SEC * dt;
        angle.output += sim.outputRpm * RAD_PER_RPM_SEC * dt;
 
        renderTelemetry(dt);
    }

    // per frame visuals
    const glowOrange = new THREE.Color(COLORS.orange);
    const glowCyan = new THREE.Color(COLORS.cyan);
    const setGlow = (mesh, color, intensity) => {
        mesh.material.emissive.copy(color);
        mesh.material.emissiveIntensity = intensity;
    };
 
    function updateVisuals(time) {
        flywheelGroup.rotation.x = angle.flywheel;
        impeller.rotation.x = angle.flywheel;
        turbineGroup.rotation.x = angle.input;
        // stator is held by its one-way clutch while the converter multiplies torque
        stator.rotation.x = sim.torqueMult > 1.03 ? 0 : angle.input * 0.9;
        inputGroup.rotation.x = angle.input;
        outputGroup.rotation.x = angle.output;
 
        const torqueFraction = clamp(Math.abs(sim.wheelTorque) / 5000, 0, 1);
 
        planetary.forEach((unit, j) => {
            const thetaSun = angle.input * SUN_SPEED[j];
            const thetaCarrier = angle.output;
            const result = planetaryAngles(unit.set, thetaSun, thetaCarrier);
 
            unit.sun.mesh.rotation.z = thetaSun;
            unit.ring.mesh.rotation.z = result.ring;
            unit.carrier.rotation.x = thetaCarrier;
            result.planets.forEach((p, i) => {
                const planet = unit.planets[i];
                planet.mesh.rotation.z = p.spin;
                planet.pivot.position.set(unit.set.x, Math.sin(p.phi) * unit.set.orbit, -Math.cos(p.phi) * unit.set.orbit);
            });
 
            const loaded = sim.gear !== 0 || sim.shifting;
            setGlow(unit.sun.mesh, glowCyan, sim.inputRpm > 30 ? 0.12 + torqueFraction * 0.3 : 0);
            unit.planets.forEach((p) => setGlow(p.mesh, glowOrange, loaded ? 0.1 + torqueFraction * 0.7 : 0));
        });

        // shift elements: discs squeeze together, rim and hydraulic channel glow
        for (const name of ELEMENTS) {
            const v = sim.elements[name];
            const e = elementPacks[name];
            e.discs.forEach((d) => { d.position.x = d.userData.baseX * (1 - 0.42 * v); });
            e.piston.position.x = 0.15 - v * 0.06;
            e.glow.material.emissiveIntensity = v * 2.6;
            e.label.material.opacity = 0.55 + v * 0.45;
            channelMats[name].emissiveIntensity = v * (1.6 + Math.sin(time * 0.012) * 0.3);
        }
