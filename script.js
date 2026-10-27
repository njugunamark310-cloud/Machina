import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
const container = document.querySelector("#engine-canvas");

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

container.querySelector(".engine-loading")?.remove();
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 3;
controls.maxDistance = 10;

const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);

const material = new THREE.MeshStandardMaterial({
    color: "#22d3ee",
    metalness: 0.65,
    roughness: 0.3
});

const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

const light = new THREE.DirectionalLight("#ffffff", 3);
light.position.set(3, 4, 5);
scene.add(light);

scene.add(new THREE.AmbientLight("#ffffff", 1));

function animate() {
    requestAnimationFrame(animate);

    cube.rotation.x += 0.005;
    cube.rotation.y += 0.01;

    renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
    const width = container.clientWidth;
    const height = container.clientHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
});