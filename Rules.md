Rules.md


Map Annotation/overlay stuff. 

Error:
* `Map.convertCoordinateToPointOnPage` threw because Super Zoom passed plain `{ latitude, longitude }` objects instead of real `mapkit.Coordinate` instances.

Fix:
* Wrap projected coordinates with `new mapkit.Coordinate(lat, lng)` before calling `convertCoordinateToPointOnPage`.

Avoid next time:
* Treat MapKit conversion APIs as strict about constructor types: for coordinate-to-page, pass real `mapkit.Coordinate`; for page-to-coordinate, pass real `DOMPoint`.