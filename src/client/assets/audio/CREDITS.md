# Battlefield audio sources

All distributed samples are derived from assets released under **CC0 1.0**.

- Tabasco — [Gunshot Sounds](https://opengameart.org/content/gunshot-sounds): CZ pistol, SKS rifle, Mosin rifle, shotgun. Transients cut from recordings, high-pass filtering, normalized and encoded to Ogg Vorbis.
- SpringySpringo — [Gun reload sounds](https://opengameart.org/content/gun-reload-sounds): rifle/pistol reload and shotgun mechanism recordings.
- Kenney — [Impact Sounds](https://kenney.nl/assets/impact-sounds): footsteps, glass, wood, metal, cloth and masonry impacts.
- rubberduck — [25 CC0 bang/firework SFX](https://opengameart.org/content/25-cc0-bang-firework-sfx): recorded cannon/firework transients used for explosions and launchers.
- pauliuw — [Engine sounds (2)](https://opengameart.org/content/engine-sounds2): motor loop, cut and crossfaded.
- WuxiaScrub — [Helicopter SFX](https://opengameart.org/content/helicopter-sfx): helicopter loop, cut and crossfaded.

- Luke.RUSTLTD — [wind1](https://opengameart.org/content/wind1): a synthesized wind recording used as a quiet crossfaded environmental bed.

Processing: `tools/audio/build-battlefield.py`. The manifest groups 58 edited samples; total compressed payload is approximately 552 KiB. UI and lock warning tones remain intentionally electronic; gameplay transients and vehicle loops use these sample assets. Cannon/firework recordings stand in for combat explosions and launchers, rather than recordings of those exact weapons.
