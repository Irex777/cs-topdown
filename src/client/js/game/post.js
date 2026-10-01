// Post-processing chain (pmndrs/postprocessing, vendored): bloom, colour grade, vignette, ACES tone mapping and anti-aliasing.
// Quality 0 draws straight to the canvas as before. 1 = lighter chain with SMAA. 2 = 4x MSAA in a half-float buffer plus the full chain.
// The library loads on demand, so Low-quality players never download it; until it arrives (or if it fails) the scene renders directly.
import * as THREE from '../../vendor/three/three.module.js';

/** The look, in one place. The default keeps the game's own colours: no saturation/contrast push, no grain or fringing (set those above 0 to
 * opt in). What stays is smoothing (MSAA/SMAA), a soft bloom on genuinely bright areas and a very light vignette. */
export const LOOK = { bloom: 0.45, bloomThreshold: 0.9, saturation: 0, brightness: 0, contrast: 0, vignetteOffset: 0.42, vignetteDarkness: 0.22, grain: 0, fringe: 0 };

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
    const effects = [this.bloom];
    if (L.saturation) effects.push(new HueSaturationEffect({ saturation: L.saturation }));
    if (L.brightness || L.contrast) effects.push(new BrightnessContrastEffect({ brightness: L.brightness, contrast: L.contrast }));
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    effects.push(this.tone);
    this.vignette = new VignetteEffect({ offset: L.vignetteOffset, darkness: L.vignetteDarkness });
    effects.push(this.vignette);
    if (L.grain) { const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN }); grain.blendMode.opacity.value = L.grain; effects.push(grain); }
    composer.addPass(new EffectPass(this.camera, ...effects));
    if (!high) composer.addPass(new EffectPass(this.camera, new SMAAEffect()));
    if (L.fringe) composer.addPass(new EffectPass(this.camera, new ChromaticAberrationEffect({ offset: new THREE.Vector2(L.fringe, L.fringe), radialModulation: true, modulationOffset: 0.35 })));
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
