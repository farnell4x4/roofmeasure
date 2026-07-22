"use client";

import { useEffect } from "react";

export function PageZoomGuard() {
  useEffect(() => {
    function isImageCanvasEvent(event: Event) {
      return event.target instanceof Element && Boolean(event.target.closest("[data-image-zoom-canvas]"))
    }

    function preventMultiTouchZoom(event: TouchEvent) {
      if (event.touches.length > 1 && !isImageCanvasEvent(event)) {
        event.preventDefault();
      }
    }

    function preventGestureZoom(event: Event) {
      if (!isImageCanvasEvent(event)) event.preventDefault();
    }

    document.addEventListener("touchmove", preventMultiTouchZoom, { passive: false });
    document.addEventListener("gesturestart", preventGestureZoom);
    document.addEventListener("gesturechange", preventGestureZoom);
    document.addEventListener("gestureend", preventGestureZoom);

    return () => {
      document.removeEventListener("touchmove", preventMultiTouchZoom);
      document.removeEventListener("gesturestart", preventGestureZoom);
      document.removeEventListener("gesturechange", preventGestureZoom);
      document.removeEventListener("gestureend", preventGestureZoom);
    };
  }, []);

  return null;
}
