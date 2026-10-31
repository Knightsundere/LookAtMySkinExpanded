# 24x texture check

Builds the same test assets twice, at 16x and at 24x (every 16x texture is made of 2x2
blocks, so its 24x twin of 3x3 blocks is exactly the same picture), renders each one in the
real app through the Vite dev bridge, and compares the pairs pixel by pixel. UVs stay in
16-unit space, as in the Cosmica asset pipeline, so every pair should match.

Covers: a block JSON with a rotated element and odd UVs, the same block opened from its PNG,
an item/generated sprite, an animated 24x96 strip (two frames), GeckoLib geo on 64x64 and
64x32 layouts (opened directly and from the entity PNG), a box-UV .bbmodel with embedded
texture, and wide, slim and legacy player skins (96x96 / 96x48).

    python3 make_fixtures.py <work>/fixtures
    npx vite --port 1420          # from LamsEX/, in another terminal
    node render.cjs <LamsEX dir> <work>/fixtures <work>/out http://localhost:1420/
    python3 compare.py <work>/out

`render.cjs` overwrites `dev-run/config.txt`. Needs Pillow and Playwright.
