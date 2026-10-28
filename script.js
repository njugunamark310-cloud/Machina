
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const container = document.querySelector("#engine-canvas");

if (!container) {
    throw new Error("Engine viewer container was not found.");
}

const scene = new THREE.Scene();
scene.background = new THREE.Color("#080d17");

const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    100
);

camera.position.set(3, 2, 5);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;

container.querySelector(".engine-loading")?.remove();
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 3;
controls.maxDistance = 10;
controls.target.set(0, 0, 0);

const engineGroup = new THREE.Group();
scene.add(engineGroup);


const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

let selectedPart = null;

const componentInfo = {
    "Engine Block": {
        description: "The main structure that houses the cylinders and supports major engine components.",
        material: "Cast metal simulation",
        function: "Supports the cylinders and internal moving parts."
    },
    "Cylinder Head": {
        description: "The upper engine assembly that closes the cylinders and houses the combustion chamber area.",
        material: "Aluminium alloy simulation",
        function: "Supports the valves and combustion chamber."
    },
    "Oil Pan": {
        description: "The lower engine enclosure that represents the engine's oil reservoir.",
        material: "Metal alloy simulation",
        function: "Stores engine oil for the lubrication system."
    },
    "Cylinder": {
        description: "Represents one of the four cylinders in this simplified engine model.",
        material: "Metal alloy simulation",
        function: "Represents the chamber where combustion drives the piston."
    },
    "Exhaust Pipe": {
        description: "Carries exhaust gases away from the engine in this simplified model.",
        material: "Heat-resistant metal simulation",
        function: "Represents the exhaust gas path."
    }
};


const engineMaterial = new THREE.MeshStandardMaterial({
    color: "#536579",
    metalness: 0.85,
    roughness: 0.28
});

const headMaterial = new THREE.MeshStandardMaterial({
    color: "#9aabbc",
    metalness: 0.9,
    roughness: 0.22
});

const cylinderMaterial = new THREE.MeshStandardMaterial({
    color: "#60758a",
    metalness: 0.9,
    roughness: 0.24,
    emissive: "#071522",
    emissiveIntensity: 0.35
});

const exhaustMaterial = new THREE.MeshStandardMaterial({
    color: "#a6b4c2",
    metalness: 0.95,
    roughness: 0.22
});

const boltMaterial = new THREE.MeshStandardMaterial({
    color: "#d7e6f5",
    metalness: 1,
    roughness: 0.2
});

const hologramMaterial = new THREE.LineBasicMaterial({
    color: "#00e5ff",
    transparent: true,
    opacity: 0.9
});

const blockGeometry = new THREE.BoxGeometry(1.8, 1.5, 1.2);
const engineBlock = new THREE.Mesh(blockGeometry, engineMaterial);
engineGroup.add(engineBlock);

const blockEdges = new THREE.EdgesGeometry(blockGeometry);
const blockWireframe = new THREE.LineSegments(
    blockEdges,
    hologramMaterial
);
blockWireframe.scale.setScalar(1.003);
engineGroup.add(blockWireframe);

const headGeometry = new THREE.BoxGeometry(1.65, 0.35, 1.1);
const cylinderHead = new THREE.Mesh(headGeometry, headMaterial);
cylinderHead.position.y = 0.92;
engineGroup.add(cylinderHead);

const headEdges = new THREE.EdgesGeometry(headGeometry);
const headWireframe = new THREE.LineSegments(
    headEdges,
    hologramMaterial
);
headWireframe.scale.setScalar(1.003);
headWireframe.position.copy(cylinderHead.position);
engineGroup.add(headWireframe);

const boltGeometry = new THREE.CylinderGeometry(
    0.055, 0.055, 0.035, 12
);

for (let i = 0; i < 6; i++) {
    const bolt = new THREE.Mesh(boltGeometry, boltMaterial);
    const x = -0.65 + (i % 3) * 0.65;
    const z = i < 3 ? -0.42 : 0.42;

    bolt.position.set(x, 1.12, z);
    engineGroup.add(bolt);
}

const cylinderGeometry = new THREE.CylinderGeometry(
    0.19, 0.19, 0.65, 24
);

for (let i = 0; i < 4; i++) {
    const cylinder = new THREE.Mesh(
        cylinderGeometry,
        cylinderMaterial
    );

    cylinder.position.set(-0.57 + i * 0.38, 0.38, 0.48);
    engineGroup.add(cylinder);
}

const oilPanGeometry = new THREE.BoxGeometry(1.35, 0.38, 1.0);
const oilPanMaterial = new THREE.MeshStandardMaterial({
    color: "#354657",
    metalness: 0.85,
    roughness: 0.32
});

const oilPan = new THREE.Mesh(oilPanGeometry, oilPanMaterial);
oilPan.position.set(0, -0.85, 0);
engineGroup.add(oilPan);

const oilPanEdges = new THREE.EdgesGeometry(oilPanGeometry);
const oilPanWireframe = new THREE.LineSegments(
    oilPanEdges,
    hologramMaterial
);
oilPanWireframe.position.copy(oilPan.position);
oilPanWireframe.scale.setScalar(1.003);
engineGroup.add(oilPanWireframe);

const sideBoltGeometry = new THREE.CylinderGeometry(
    0.045, 0.045, 0.06, 12
);

for (let i = 0; i < 3; i++) {
    const sideBolt = new THREE.Mesh(
        sideBoltGeometry,
        boltMaterial
    );

    sideBolt.rotation.x = Math.PI / 2;
    sideBolt.position.set(-0.48 + i * 0.48, -0.85, 0.53);
    engineGroup.add(sideBolt);
}

const exhaustGeometry = new THREE.CylinderGeometry(
    0.075, 0.095, 0.7, 16
);

for (let i = 0; i < 4; i++) {
    const exhaustPipe = new THREE.Mesh(
        exhaustGeometry,
        exhaustMaterial
    );

    exhaustPipe.position.set(
        -0.57 + i * 0.38,
        -0.05,
        -0.68
    );

    exhaustPipe.rotation.x = Math.PI / 2;
    engineGroup.add(exhaustPipe);
}

const mainLight = new THREE.DirectionalLight("#ffffff", 3);
mainLight.position.set(3, 4, 5);
scene.add(mainLight);

const cyanLight = new THREE.PointLight("#00e5ff", 12, 8);
cyanLight.position.set(-3, 1, 2);
scene.add(cyanLight);

const orangeLight = new THREE.PointLight("#ff8a00", 8, 8);
orangeLight.position.set(3, -1, -2);
scene.add(orangeLight);

scene.add(new THREE.AmbientLight("#ffffff", 1));


const resetButton = document.querySelector("#reset-view");
const hologramButton = document.querySelector("#toggle-hologram");
const explodedButton = document.querySelector("#toggle-exploded");

const rpmValue = document.querySelector("#rpm-value");
const tempValue = document.querySelector("#temp-value");
const boostValue = document.querySelector("#boost-value");

const rpmBar = document.querySelector("#rpm-bar");
const tempBar = document.querySelector("#temp-bar");
const boostBar = document.querySelector("#boost-bar");

const hologramParts = [
    blockWireframe,
    headWireframe,
    oilPanWireframe
];

let hologramEnabled = true;
let exploded = false;

const cameraStart = new THREE.Vector3(3, 2, 5);
const targetStart = new THREE.Vector3(0, 0, 0);

const cylinderParts = engineGroup.children.filter(
    part => part.geometry === cylinderGeometry
);

const exhaustParts = engineGroup.children.filter(
    part => part.geometry === exhaustGeometry
);

const movableParts = [
    {
        object: cylinderHead,
        wireframe: headWireframe,
        offset: new THREE.Vector3(0, 1.1, 0)
    },
    {
        object: oilPan,
        wireframe: oilPanWireframe,
        offset: new THREE.Vector3(0, -0.9, 0)
    },
    ...cylinderParts.map((object, index) => ({
        object,
        offset: new THREE.Vector3(
            0,
            0.65,
            index % 2 === 0 ? 0.35 : -0.35
        )
    })),
    ...exhaustParts.map((object, index) => ({
        object,
        offset: new THREE.Vector3(
            0,
            -0.15,
            index % 2 === 0 ? -1.0 : -1.35
        )
    }))
];

for (const part of movableParts) {
    part.start = part.object.position.clone();
    part.destination = part.start.clone();
}

resetButton?.addEventListener("click", () => {
    camera.position.copy(cameraStart);
    controls.target.copy(targetStart);
    controls.update();
});

hologramButton?.addEventListener("click", () => {
    hologramEnabled = !hologramEnabled;

    hologramParts.forEach(part => {
        part.visible = hologramEnabled;
    });

    hologramButton.textContent = hologramEnabled
        ? "HOLOGRAM: ON"
        : "HOLOGRAM: OFF";

    hologramButton.classList.toggle("active", hologramEnabled);
});

explodedButton?.addEventListener("click", () => {
    exploded = !exploded;

    movableParts.forEach(part => {
        part.destination = exploded
            ? part.start.clone().add(part.offset)
            : part.start.clone();
    });

    explodedButton.textContent = exploded
        ? "ASSEMBLE ENGINE"
        : "EXPLODED VIEW";

    explodedButton.classList.toggle("active", exploded);
});

function updateTelemetry(time) {
    const rpm = Math.round(
        2200 + Math.sin(time * 0.0012) * 1400
    );

    const temperature = Math.round(
        88 + Math.sin(time * 0.00045) * 5
    );

    const boost = Math.max(
        0.1,
        0.8 + Math.sin(time * 0.0015) * 0.65
    );

    if (rpmValue) rpmValue.textContent = rpm;
    if (tempValue) tempValue.textContent = temperature;
    if (boostValue) boostValue.textContent = boost.toFixed(1);

    if (rpmBar) rpmBar.style.width = `${(rpm / 7000) * 100}%`;
    if (tempBar) tempBar.style.width = `${(temperature / 130) * 100}%`;
    if (boostBar) boostBar.style.width = `${(boost / 2) * 100}%`;

    const gaugeText = document.querySelector("#gauge-text");
    const gaugePath = document.querySelector("#gauge-value");

    if (gaugeText) gaugeText.textContent = rpm;

    if (gaugePath) {
        const progress = Math.min(rpm / 7000, 1);
        const circumference = Math.PI * 80;
        gaugePath.style.strokeDasharray =
            `${circumference * progress} ${circumference}`;
    }
}

function updateExplodedView() {
    movableParts.forEach(part => {
        part.object.position.lerp(part.destination, 0.07);

        if (part.wireframe) {
            part.wireframe.position.copy(part.object.position);
        }
    });
}


function animate(time = 0) {
    requestAnimationFrame(animate);

    controls.update();
    updateExplodedView();
    updateTelemetry(time);

    renderer.render(scene, camera);
}

function resizeRenderer() {
    const width = container.clientWidth;
    const height = container.clientHeight;

    if (width === 0 || height === 0) {
        return;
    }

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

window.addEventListener("resize", resizeRenderer);

resizeRenderer();
animate();
