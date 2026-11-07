# App icon

`public/icon.png` (512 px, the `signalk.appIcon`) is rendered from
[`icon.svg`](icon.svg): a little golden squirrel sitting on the stern of a
sailboat whose sails are white solar panels, while the sun in the top left
blows golden energy into the sails like wind. Flat, on navy (signalk-visuals
13). It is a hand-drawn vector stand-in. To replace it with an image-model
icon in the same family, use this prompt with an existing BoatHacks icon as
the reference, then save the result as `public/icon.png`:

```
New app icon, flat vector style, for a SignalK plugin called "Solar Sailing",
which shows how much motor power an electric boat can use on solar power alone.

Subject: a little golden squirrel sitting on a small sailboat. The boat's sails
are solar panels: white triangles divided into a grid of panel cells. In the
upper left corner a gold sun "blows" energy into the sails like wind: three or
four wavy gold wind streaks run from the sun into the sails, as if the sun were
a cartoon wind face blowing (but no face on the sun). The squirrel sits on the
deck at the stern, facing the sails, with its bushy tail curled up behind it.

Style: 3 colors only: navy blue background (#002058), gold (#FDBB15) for the
sun, wind streaks, hull and squirrel, and white for the solar-panel sails with
navy grid lines. Flat colors, no shading, no gradients, no shadows, thick
simple shapes. No water details, no text, no letters, no numbers.

Composition: square canvas, background fills the whole square, no rounded
corners, no border. The boat is centered slightly low and fills about 75
percent of the frame width. It must stay readable when scaled down to 72 x 72
pixels, so leave out small details. Make sure the squirrel is recognisable
(bushy tail, ear tufts) and the sails clearly read as solar panels.

Output: 1024 x 1024 PNG.
```

Render the SVG again after editing it:

```sh
node -e "require('playwright').chromium.launch().then(async (b) => { const p = await b.newPage({ viewport: { width: 512, height: 512 } }); await p.goto('file://' + process.cwd() + '/docs/icon.svg'); await p.screenshot({ path: 'public/icon.png' }); await b.close() })"
```
