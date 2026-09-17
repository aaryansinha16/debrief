'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';

export interface RenderStats {
  ms: number;
  calls: number;
}

// Wraps the renderer's render call: draw calls come from renderer.info, the time from the clock around the call.
// Only readPixels waits for the raster; finish() returns at once through the command buffer, so `sync` reads one pixel.
export function RenderMeter({
  onRender,
  sync = false,
}: {
  onRender: (stats: RenderStats) => void;
  sync?: boolean;
}) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const original = gl.render.bind(gl);
    const context = gl.getContext();
    const pixel = new Uint8Array(4);
    gl.render = (scene, camera) => {
      const start = performance.now();
      original(scene, camera);
      if (sync) context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
      onRender({ ms: performance.now() - start, calls: gl.info.render.calls });
    };
    return () => {
      gl.render = original;
    };
  }, [gl, onRender, sync]);
  return null;
}
