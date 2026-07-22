Rules.md


Don't run npm run build ever. 



Map Annotation/overlay stuff. 

Error:
* `Map.convertCoordinateToPointOnPage` threw because Super Zoom passed plain `{ latitude, longitude }` objects instead of real `mapkit.Coordinate` instances.

Fix:
* Wrap projected coordinates with `new mapkit.Coordinate(lat, lng)` before calling `convertCoordinateToPointOnPage`.

Avoid next time:
* Treat MapKit conversion APIs as strict about constructor types: for coordinate-to-page, pass real `mapkit.Coordinate`; for page-to-coordinate, pass real `DOMPoint`.
Add a horizontally scrollable measurement toolbar near the top with these primary measurement types:

* Eave
* Valley
* Rake
* Hip
* Ridge

Give each type a clean visual identity that remains understandable without overwhelming the map. Selected state should be unmistakable.

The selected measurement type persists throughout the active measuring session until the user changes it. [completed]

When the user taps the map without first selecting a measurement type:

* Prompt them to choose a measurement type
* Briefly emphasize the measurement toolbar
* Preserve the map position and their workflow

Point and line placement [completed]

Measurement creation should feel similar to placing a digital tape measure.

Flow:
   
* First tap: place the starting point.
* Second tap: create the first measured line.
* Third tap in Continuous mode: create another line starting from the second tap’s endpoint.
* Third tap in New Line mode: start a completely new line and do not create a segment yet.
DO NOT AUTO DESIDE NEW LINE VS CONTINUOUS. LEAVE NIL AT BEGINNING OFF EVERY PROJECT START. THEN WHEN USER TAPS THIRD POINT, ASK THEM IF THEY WANT TO CONTINE FROM PREVIOUCS OR START NEW. AND THEN SHOW ONE WORD SETTINGS OVERLAYED NEAR TOP OF MAP. 

Use geographic coordinates as the canonical stored geometry and calculate real-world distances from those coordinates.

Provide:
   
* Clear point markers
* Clean line overlays
* Active-line preview
* Snapping assistance when a tap is close to an existing endpoint
* Haptic-style visual feedback
* Selected measurement highlighting
* Easy endpoint editing
* Segment deletion
* Undo and redo
* Zoom-safe overlays
* Human-readable feet and inches, with optional decimal feet

Super Zoom coordinate/render fix [completed]

Fix:
* Keep two separate rules:
* `tap/drag -> coordinate`: undo Super Zoom before `convertPointOnPageToCoordinate`
* `coordinate -> dot/line/label`: project forward once for display

Why:
* Mixing those directions caused either wrong measurements or wrong visible placement.
* Handing measurement rendering back to native MapKit at `1x` also caused overlays to disappear, so the projected DOM measurement layer now stays active at every zoom level, including `1x`.

Prevent errors

* Never pass plain `{ latitude, longitude }` objects into MapKit conversion APIs that expect real `mapkit.Coordinate` instances.
* Guard any `window` or `window.mapkit` access so it does not run during Next server render.
* Keep Super Zoom input math and render math separate: undo zoom for coordinate capture, project forward once for display.
* Do not switch measurement rendering between DOM overlay and native MapKit overlays based on zoom level; keep one consistent render path.
* When serializing project geometry, populate all segment endpoints before building the saved `points` array.
* When saving a project after address search, clear measurement geometry first so old points do not carry into the new project.
* When reopening a project, do not persist MapKit's initial/default region while the saved camera or saved property coordinates are still being applied; ignore a default camera that is clearly far from the property and use the property-coordinate fallback.

