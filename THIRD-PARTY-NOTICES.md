# Third-party notices

Book Desk has no runtime dependencies: nothing is bundled into `main.js` but the plugin's own source.

## PDF++

Text highlights use the link format of [PDF++](https://github.com/RyotaUshio/obsidian-pdf-plus), so that both plugins show
the same highlights. To draw a highlight in exactly the same place as PDF++ does, `src/pdf-highlights.js` follows the way
PDF++ turns a selection into rectangles on the page (its `computeMergedHighlightRects`). PDF++ is used under this licence:

> MIT License
>
> Copyright (c) 2023 Ryota Ushio
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## PDF.js

PDF pages are drawn by the copy of [PDF.js](https://mozilla.github.io/pdf.js/) that Obsidian itself ships (Apache License 2.0).
It is not part of this plugin.
