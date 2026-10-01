// Post-processing chain (pmndrs/postprocessing, vendored): bloom, colour grade, vignette, ACES tone mapping and anti-aliasing.
// Quality 0 draws straight to the canvas as before. 1 = lighter chain with SMAA. 2 = 4x MSAA in a half-float buffer plus the full chain.
// The library loads on demand, so Low-quality players never download it; until it arrives (or if it fails) the scene renders directly.
import * as THREE from '../../vendor/three/three.module.js';

/** the look, in one place: tuned so the difference from the plain render is obvious but the picture stays natural */
export const LOOK = { bloom: 1.0, bloomThreshold: 0.62, saturation: 0.3, brightness: 0.015, contrast: 0.17, vignetteOffset: 0.2, vignetteDarkness: 0.72, grain: 0.07, fringe: 0.0011 };

let libPromise = null;
const loadLib = () => libPromise || (libPromise = import('../../vendor/postprocessing/postprocessing.js'));

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.composer = null; this.want = 0; this.failed = false; this.size = null;
  }

  /** (re)build the chain for a graphics quality; resolves once it is live */
  configure(quality) {
    this.want = quality;
    if (quality <= 0 || this.failed) { this.dispose(); return Promise.resolve(); }
    return loadLib().then((lib) => { if (this.want === quality) this.build(lib, quality); })
      .catch((e) => { this.failed = true; this.dispose(); console.warn('post-processing unavailable:', e); });
  }

  build(lib, quality) {
    const { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode, HueSaturationEffect, BrightnessContrastEffect, NoiseEffect, ChromaticAberrationEffect, BlendFunction } = lib;
    this.dispose();
    const high = quality >= 2, L = LOOK;
    const composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: high ? 4 : 0 });
    composer.addPass(new RenderPass(this.scene, this.camera));
    // Bloom works on linear HDR values, so sun-lit haze, muzzle flashes, fire and glints glow while shaded surfaces stay crisp.
    this.bloom = new BloomEffect({ intensity: high ? L.bloom : L.bloom * 0.75, luminanceThreshold: L.bloomThreshold, luminanceSmoothing: 0.4, mipmapBlur: true, radius: 0.85, levels: high ? 8 : 6 });
    const grade = [new HueSaturationEffect({ saturation: L.saturation }), new BrightnessContrastEffect({ brightness: L.brightness, contrast: L.contrast })];
    this.vignette = new VignetteEffect({ offset: L.vignetteOffset, darkness: L.vignetteDarkness });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN }); grain.blendMode.opacity.value = L.grain;
    const lens = new ChromaticAberrationEffect({ offset: new THREE.Vector2(L.fringe, L.fringe), radialModulation: true, modulationOffset: 0.35 });
    composer.addPass(new EffectPass(this.camera, this.bloom, ...grade, this.tone, this.vignette, grain));
    composer.addPass(new EffectPass(this.camera, high ? lens : new SMAAEffect()));
    if (!high) composer.addPass(new EffectPass(this.camera, lens));
    if (this.size) composer.setSize(this.size[0], this.size[1], false);
    this.composer = composer;
  }

  resize(w, h) {
    this.size = [w, h];
    if (this.composer) this.composer.setSize(w, h, false);
  }

  /** draw a frame through the chain; false means it is not active and the caller should render directly */
  render(dt) {
    if (!this.composer) return false;
    this.composer.render(dt);
    return true;
  }

  get active() { return !!this.composer; }

  dispose() {
    if (this.composer) { this.composer.dispose(); this.composer = null; }
  }
}
