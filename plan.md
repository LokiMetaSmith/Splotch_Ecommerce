1. **Understand the Goal**: The user wants to convert the plain text note "Keep important elements 2-3mm from edge!" into a "bubble text" style that does not occlude the artwork. Currently, it's a `<p>` tag positioned `absolute bottom-2 right-2` inside the `canvas-container`.
2. **Current Implementation**:
   - `index.html` has:
     ```html
     <p
       id="designMarginNote"
       class="absolute bottom-2 right-2 text-xs text-splotch-red p-1 bg-white bg-opacity-75 rounded"
       style="font-family: var(--font-baumans); display: none"
       contenteditable="false"
     >
       Keep important elements 2-3mm from edge!
     </p>
     ```
3. **Proposed Changes**:
   - To make it a "bubble text", we can change its styling in `index.html`. We can use a combination of padding, border-radius, background color, text color, and perhaps a small triangle (using `::after` or a small SVG) pointing towards the image, or simply styling it as a floating pill/bubble.
   - To prevent it from occluding the artwork, we can move it *outside* the canvas (e.g., just below it), or position it in a way that it floats outside the bounding box of the canvas, but since the canvas container is `relative w-fit mx-auto`, placing it absolutely *outside* (e.g., `bottom: -30px`) might be better. Or we can just put it below the canvas container in the normal flow.
   - Wait, if it's currently inside `#canvas-container`, it overlaps the canvas. If we move it outside the absolute positioning to be a block below the canvas, it won't occlude the artwork.
   - Let's look at the image provided by the user: The text is right below the image bounding box, stylized as a red pill/bubble with a green circle drawn around it by the user. In the user's screenshot, it looks like it's currently a text floating *over* the bottom part of the canvas (occluding the dashed red cutline). The user says "make this a bubble text that doesn't occlude the artwork".
   - So I should:
     1. Move the `p#designMarginNote` outside of the `canvas` overlap.
     2. Style it to look like a bubble.
