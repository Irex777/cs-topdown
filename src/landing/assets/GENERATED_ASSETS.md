# Game selector artwork

- `frontline-cover.jpg`: optimized copy of the existing AI-generated `src/client/assets/art/river-crossing.png`. Original prompt is recorded in `src/client/assets/generation-prompts.json` under `hero`.
- `tactical-cover.jpg`: generated with the built-in `image_gen` tool on 2026-09-30, saved in this directory as an optimized JPEG. The full-resolution original remains in the Codex generated image directory.

## Tactical cover prompt

Use case: stylized-concept. Asset type: cinematic cover artwork for a browser top-down tactical shooter game selector. Primary request: a sophisticated directly overhead tactical illustration of a tense bomb-defusal site in a weathered industrial warehouse courtyard. Two small blue counter-terrorist operators taking cover on the right and two small muted terracotta opposing operators approaching from the upper left, viewed strictly from above, tiny readable human silhouettes with weapons. Concrete corridors, industrial crates, a yellow painted bomb-site marking on the floor with no lettering, realistic dust, a spreading small smoke cloud, a few subtle directional vision cones and a thin tracer. Style: detailed game concept illustration with top-down 2D readability, tactile materials and restrained realism, not pixel art, not cartoon icons. Muted slate blue, warm concrete, subdued amber practical lights, cool shadows. Composition: portrait 2:3, interesting tactical action in the upper two thirds, darker and simpler lower third for HTML text overlay. Strong thoughtful lighting, crisp geometry, premium art direction. No text, no letters, no UI, no logos, no watermark, no border or split panels.

## Verification

Reviewed desktop and mobile screenshots in native Chrome. Verified loaded artwork and unclipped headings at 320, 390, 768, 820, 1156, 1440 and 1920 pixels wide; keyboard launch, both game destinations, encoded invite propagation, live room counts, API failure fallback and reduced-motion support passed. Gameplay code is unchanged by this selector redesign.
