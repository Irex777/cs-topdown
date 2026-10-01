postprocessing 6.39.5 (pmndrs, Zlib license), unmodified `build/index.js` renamed to `postprocessing.js`.
Imports `three` by bare name; `index.html` maps that to `../three/three.module.js` (three r186; this build supports r168-r186).
To update: `npm install postprocessing@<version>` in a scratch directory and copy `node_modules/postprocessing/build/index.js` here.
