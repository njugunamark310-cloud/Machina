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
 
