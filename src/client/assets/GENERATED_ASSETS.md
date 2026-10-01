# Frontline graphics pass

## Reference-to-Blender world rebuild

The latest world pass starts with three generated 2D production reference sheets in `references/`: `vehicles-v2.png`, `architecture-v2.png`, and `props-v2.png`. The built-in image generation tool also created seamless plain burlap, lime plaster and slate albedos in `tex/*-v2.png`. Exact prompts and tool route are in `world-v2-prompts.json`.

Blender MCP recreated all six vehicles from these references: enclosed four-door armored truck; wedge-armored tank with continuous tracks and fourteen articulated road wheels; eight-wheel APC; ATV; tandem-canopy attack helicopter; and open patrol boat with twin outboards. Separate wheels, cannon, rotor and gun pivots retain the game's driving and aiming behavior. Generated field-metal skins stay embedded in the exports.

The subsequent fidelity pass adds faceted hull cross-sections, separate bevelled armor plates and fasteners, shaped wheel guards, correctly oriented staggered tire blocks, rounded rim lips and hub recesses, handles, hinges, winch/tow fittings, cargo straps, smoke tubes, framed tandem glazing, turbine exhausts, rotor linkages and outboard propellers. Tank road wheels use smooth rubber rings. HMGs have detailed receivers, grips, ammunition feeds and a separate plate shield with a barrel aperture; the shield retains first-person visibility handling.

`vehicle_surfaces.py` bakes the assembled mesh's vertex contact shading, curvature-controlled edge wear, ground-level dust, generated paint grain, tangent normals and packed roughness/metallic maps into UV atlases per moving part. Maps are retained under `vehicles/surfaces/` and embedded in the GLBs. Matching wheel meshes reuse the baked wheel material. This reduces material draw calls and preserves the surface treatment through export. `node tools/modelreview.mjs` renders those actual runtime GLBs in neutral lighting, using the game's loader and assembly, to `output/qa/reference-model-*.png`; it does not generate another concept image. `node tools/world-qa.mjs` runs the graphics, vehicle, crew, flight and terrain suites sequentially, followed by both visual reviews.

The prop library contains filled, irregular stitched sacks with a plain woven fabric texture, individual crate boards and metal handles, ribbed olive drums, corrugated steel cargo panels with locking bars, concrete barriers, rubble, and the established generated oak. `foliage/oak-source.glb` is the independent foliage source; rebuilding does not depend on QA backups.

Architecture uses brick, plaster and stone storey modules with recessed opaque glazing, stone sills and lintels, timber muntins and shutters, foundation and cornice bands, corner quoins, open doorway trim, slate roofs, eaves, gutters, downpipes and twin-pot chimneys. Storeys retain their physical height; shared-material storeys and roof details are batched. Roof collapse, clear doorways and roof landings retain the shared collision envelope.

Rebuild the world through the connected Blender MCP:

```bash
uvx --from mcp-for-blender python tools/blender/mcp_client.py execute tools/blender/build_world_v2.py
```

Or use `/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/blender/build_world_v2.py`. Cycles bakes shallow normal maps and roughness companions from the generated material inputs. Editable packed sources, including the actual reference image, are saved to `output/models-v2/`: `jeep.blend`, `tank.blend`, `apc.blend`, `quad.blend`, `heli.blend`, `boat.blend`, `battlefield-props.blend`, and `modular-buildings.blend`. `build_frontline.py` includes this pass so a full rebuild retains the new models. Older individual build commands below describe earlier revisions and can replace individual assets with those older designs.

`node tools/artreview.mjs` captures actual in-game world views, rather than concept mockups, to `output/qa/world-v2-*.png`.

These eight source images were created with the built-in image generation tool. Runtime textures are compressed copies; the full generated originals remain here.

| Source | Used by |
| --- | --- |
| `art/river-crossing.png` | Main menu cinematic background |
| `skins/woodland.png` | Soldier uniform, trousers and first-person sleeves; `woodland-runtime.jpg` is embedded in GLBs |
| `skins/field-metal.png` | Weathered weapon receivers and vehicle armor; `field-metal-runtime.jpg` is embedded in GLBs |
| `tex/concrete-generated.png` | Destructible building surfaces; runtime uses `concrete-generated.jpg` with existing normal/roughness maps |
| `tex/brick-generated.png` | Building walls; runtime uses `brick-generated.jpg` with matching Blender-baked `brick-generated-n.jpg` and `brick-generated-r.jpg` |
| `foliage/oak-leaves.png` | Transparent oak branch cutouts on Blender leaf cards; runtime alpha-tested foliage |
| `foliage/oak-bark.png` | Bark on branching oak trunks, roots and limbs |
| `tex/grass-generated.png` | Meadow and debris floors; sampled continuously in world coordinates into 512px ground chunks at Medium/High quality |

The Blender MCP build is reproducible with `uvx --from mcp-for-blender python tools/blender/mcp_client.py execute tools/blender/build_frontline.py` while Blender's MCP add-on is connected. A normal Blender background build also works: `/Applications/Blender.app/Contents/MacOS/Blender --background --python tools/blender/build_frontline.py`. The build saves an editable `output/soldier.blend` and exports game-ready GLBs. Team patches stay blue for friends and red for enemies, while the uniforms retain natural camouflage.

Exact generation prompts are in `generation-prompts.json`.

The environment continuation rebuilt `props.glb` through Blender MCP with branching trees, subdued foliage, crate planks/lifting hardware, worn barrels and sandbag seams. Reproduce it with `uvx --from mcp-for-blender python tools/blender/mcp_client.py execute tools/blender/build_environment.py`; the packed editable scene is saved to `output/environment.blend`. Companion brick maps are relief estimates derived in Blender from the generated albedo, so their layout matches the visible mortar.

Smoke and explosion dust use shared soft particle textures generated by canvas code, camera-facing instancing and individual alpha fading. They do not add image-generation assets or draw calls per particle. Quality switches dispose transient world materials and textures while keeping shared source assets available.

The size/architecture revision uses 16 game units per metre for every vehicle, matching infantry. Larger visible hulls have matching entry prompts, safe exits and weapon muzzle heights. All five mounted machine guns are tested against infantry at the crosshair distance. The helicopter flies above the taller trees and roofs.

Houses use map-authored footprints for pitched/flat roofs, gable ends, wooden fascia and ceilings. Framed windows and chimneys are exported from Blender in `architecture.glb`; the packed editable source is `output/architecture.blend`. Roof envelopes are shared with bullet collision and collapse when 30% of their original perimeter supports are destroyed. Existing movement paths and door openings are preserved. Trees use branching trunks with generated transparent leaf cards, rather than solid polygon canopies. Low quality keeps the modeled trees and architecture with simpler lighting materials.

The vehicle-controls revision was also exported through Blender MCP. Tank and APC GLBs have separate `cannon` meshes and authored `cannon_mount` pivots so their barrels pitch independently of the turrets. Reproduce these two exports with `uvx --from mcp-for-blender python tools/blender/mcp_client.py execute tools/blender/build_vehicle_controls.py`. Runtime muzzle positions, barrel lengths and firing pitch share the same dimensions as the Blender models.

The handling revision exports four quad wheels, four jeep wheels, eight APC wheels and fourteen tank road wheels as separate axle-centered nodes. They retain the generated armor material and existing scale. Runtime steering and axle rotation use these pivots; the complete chassis, turret, gun and rotor assemblies now share the damped body pose. Reproduce the export through Blender MCP with `uvx --from mcp-for-blender python tools/blender/mcp_client.py execute tools/blender/build_vehicle_handling.py`.

The truck gunner revision raises the jeep HMG mount to 1.9 m on an authored pedestal, clearing the cabin roof. It retains all four articulated wheel nodes and the generated armor skin. Jeep, tank, APC and boat HMG shields are separate `gun_shield` nodes with an open upper aperture. The first-person view hides these shields, and weapon zoom hides the local world gun. The camera offset follows elevation, the local gun avoids external chassis tilt, and the rendered barrel pitches around the shared firing bore. Reproduce all four exports with `uvx --from mcp-for-blender python tools/blender/mcp_client.py execute tools/blender/build_gunner.py`.

Building wall heights are authored in storeys of 3.25 m, with repeated window geometry and matching roof/header collision. Harbor exteriors use two to four storeys, while taller rural/desert houses remain mixed with single-storey buildings. Tree geometry scales to its shared 7–11 m physical height. Helicopters start on clear ground pads, maintain actual world altitude, climb/descend with Shift and Ctrl/C, and can land on roofs.

The anti-air/sights revision adds a distinct Stinger model with an olive canister, battery/cooling unit, grip stock and open sight hood using the generated field-metal skin. Iron sights are separate foldable nodes with real open apertures and aligned posts. The holographic lower bar sits below the viewing window, and optic glass is lightly tinted. The viewmodel pins the sight axis during ADS; small red-dot/holographic reticles are drawn at the authoritative shot direction. Reproduce all eight weapon exports and the attachment set through Blender MCP with `uvx --from mcp-for-blender python tools/blender/mcp_client.py execute tools/blender/build_air_defense.py`.

## Character and weapon art pass

The soldier was rebuilt from organic forms instead of slab boxes: a lofted field jacket and pelvis, neck and head with ballistic glasses and face gaiter, MICH-style helmet with NVG shroud, rails and comms, a slimmer plate carrier with MOLLE rows, triple mag/admin/dump/holster pouches, assault pack with bedroll, side pockets and whip antenna, tapered sleeves with elbow pads and fingered gloves, and bloused trousers with cargo and knee pads over laced boots with tread. New `Builder.stack` (superellipse ring solids) and `Builder.sweep` (tapered tubes with a rounded-rectangle option) in `lib.py` make this possible. Node and material names are unchanged (`legL`, `legR`, `weapon`, `head_top`; `uniform`, `helmet`, `vest`, `accent`, `team_patch`).

Two contract changes, both mirrored in `assets.js`: the `weapon` empty is now exactly where the right hand grips (the game previously offset it by a fixed amount, leaving rifles floating ~10 cm high), and the left arm is a separate `armL` node pivoting at the shoulder with an `armL_hand` rest marker. `soldierGun` swings and stretches it so the glove meets each weapon's `grip_l` (rifle, SMG, pistol, launcher).

Weapons use lofted receivers, tapered handguards that run flush with the top rail, sculpted stocks with cheek pieces, swept pistol grips with a bowed backstrap, smooth swept magazines with ribs and feed lips, and trigger-guard loops. All named empties (`muzzle`, `ads`, `mount_*`, `grip_*`) and magazine variants keep their positions. Rebuild with `uvx --from mcp-for-blender python tools/blender/mcp_client.py execute tools/blender/build_characters.py` (and `build_weapons.py`). `node tools/soldierreview.mjs` renders the runtime soldier with rifle, SMG, pistol and launcher to `output/qa/soldier-*.png`.
