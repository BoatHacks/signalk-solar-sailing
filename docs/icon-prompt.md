# App icon

`public/icon.png` (512 px, the `signalk.appIcon`) is rendered from
[`icon.svg`](icon.svg): a golden squirrel holding a white propeller under the
sun, flat, on navy (signalk-visuals 13). It is a hand-drawn vector stand-in.
To replace it with an image-model icon in the same family, use this prompt
with an existing BoatHacks icon as the reference, then save the result as
`public/icon.png`:

```
New app icon, flat vector style, for a SignalK plugin called "Solar Sailing",
which shows how much motor power an electric boat can use on solar power alone.

Subject: a golden squirrel standing upright and holding a white boat propeller
in its front paws, with a gold sun in the upper right corner.

Style: 4 colors only: navy blue background (#002058), gold (#FDBB15), white for
the propeller. Flat colors, no shading, no gradients, no shadows, thick simple
shapes. No text, no letters, no numbers.

Composition: square canvas, background fills the whole square, no rounded
corners, no border. The squirrel is centered and fills about 70 percent of the
frame. It must stay readable when scaled down to 72 x 72 pixels, so leave out
small details. Make sure it looks like a squirrel (bushy tail, ear tufts).

Output: 1024 x 1024 PNG.
```

Render the SVG again after editing it:

```sh
node -e "require('playwright').chromium.launch().then(async (b) => { const p = await b.newPage({ viewport: { width: 512, height: 512 } }); await p.goto('file://' + process.cwd() + '/docs/icon.svg'); await p.screenshot({ path: 'public/icon.png' }); await b.close() })"
```
