import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  ComponentProps,
  RefCallback,
} from 'react';
import { Rive, EventType } from '@rive-app/canvas';
import {
  UseRiveParameters,
  UseRiveOptions,
  RiveState,
  Dimensions,
} from '../types';
import { isIE, useWindowSize } from '../utils';

type RiveComponentProps = {
  setContainerRef: RefCallback<HTMLElement>;
  setCanvasRef: RefCallback<HTMLCanvasElement>;
};

function RiveComponent({
  setContainerRef,
  setCanvasRef,
  className = '',
  style,
  ...rest
}: RiveComponentProps & ComponentProps<'canvas'>) {
  const containerStyle = {
    width: '100%',
    height: '100%',
    ...style,
  };

  return (
    <div
      ref={setContainerRef}
      className={className}
      {...(!className && { style: containerStyle })}
    >
      <canvas ref={setCanvasRef} style={{ verticalAlign: 'top' }} {...rest} />
    </div>
  );
}

const defaultOptions = {
  useDevicePixelRatio: true,
  fitCanvasToArtboardHeight: false,
  useOffscreenRenderer: true,
};

/**
 * Returns options, with defaults set.
 *
 * @param opts
 * @returns
 */
function getOptions(opts: Partial<UseRiveOptions>) {
  return Object.assign({}, defaultOptions, opts);
}

/**
 * Custom Hook for loading a Rive file.
 *
 * Waits until the load event has fired before returning it.
 * We can then listen for changes to this animation in other hooks to detect
 * when it has loaded.
 *
 * @param riveParams - Object containing parameters accepted by the Rive object
 *   in the rive-js runtime, with the exception of Canvas as that is attached
 *   via the ref callback `setCanvasRef`.
 *
 * @param opts - Optional list of options that are specific for this hook.
 * @returns {RiveAnimationState}
 */
export default function useRive(
  riveParams?: UseRiveParameters,
  opts: Partial<UseRiveOptions> = {}
): RiveState {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  const [rive, setRive] = useState<Rive | null>(null);
  const [dimensions, setDimensions] = useState<Dimensions>({
    height: 0,
    width: 0,
  });

  // Listen to changes in the window sizes and update the bounds when changes
  // occur.
  const windowSize = useWindowSize();

  // when the container dimensions change, we need to re evaluate our dimensions.
  const [containerDimensions, setContainerDimensions] = useState<Dimensions>({
    height: 0,
    width: 0,
  });

  const isParamsLoaded = Boolean(riveParams);
  const options = getOptions(opts);

  /**
   * Gets the intended dimensions of the canvas element.
   *
   * The intended dimensions are those of the container element, unless the
   * option `fitCanvasToArtboardHeight` is true, then they are adjusted to
   * the height of the artboard.
   *
   * @returns Dimensions object.
   */
  function getCanvasDimensions() {
    const { width, height } =
      containerRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);

    if (rive && options.fitCanvasToArtboardHeight) {
      const { maxY, maxX } = rive.bounds;
      return { width, height: width * (maxY / maxX) };
    }
    return { width, height };
  }

  /**
   * Updates the width and height of the canvas.
   */
  function updateBounds() {
    if (!containerRef.current) {
      return;
    }

    const { width, height } = getCanvasDimensions();
    const boundsChanged =
      width !== dimensions.width || height !== dimensions.height;
    if (canvasRef.current && rive && boundsChanged) {
      if (options.fitCanvasToArtboardHeight) {
        containerRef.current.style.height = height + 'px';
      }
      if (options.useDevicePixelRatio) {
        const dpr = window.devicePixelRatio || 1;
        canvasRef.current.width = dpr * width;
        canvasRef.current.height = dpr * height;
        canvasRef.current.style.width = width + 'px';
        canvasRef.current.style.height = height + 'px';
      } else {
        canvasRef.current.width = width;
        canvasRef.current.height = height;
      }
      setDimensions({ width, height });

      // Updating the canvas width or height will clear the canvas, so call
      // startRendering() to redraw the current frame as the animation might
      // be paused and not advancing.
      rive.startRendering();
    }

    // Always resize to Canvas
    if (rive) {
      rive.resizeToCanvas();
    }
  }

  /**
   * Listen to changes on the windowSize and the rive file being loaded
   * and update the canvas bounds as needed.
   *
   * ie does not support ResizeObservers, so we fallback to the window listener there
   */
  if (isIE()) {
    useEffect(() => {
      if (rive) {
        updateBounds();
      }
    }, [rive, windowSize]);
  } else {
    const observer = React.useRef(
      new ResizeObserver((entries) => {
        setContainerDimensions(entries[entries.length - 1].contentRect);
      })
    );
    useEffect(() => {
      if (rive) {
        console.log('updating');
        updateBounds();
      }
    }, [rive, containerDimensions]);

    useEffect(() => {
      if (containerRef.current) {
        observer.current.observe(containerRef.current);
      }

      return () => {
        observer.current.disconnect();
      };
    }, [containerRef.current, observer]);
  }

  /**
   * Ref callback called when the canvas element mounts and unmounts.
   */
  const setCanvasRef: RefCallback<HTMLCanvasElement> = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      if (canvas && riveParams) {
        const { useOffscreenRenderer } = options;
        const r = new Rive({
          useOffscreenRenderer,
          ...riveParams,
          canvas,
        });
        r.on(EventType.Load, () => setRive(r));
      } else if (canvas === null && canvasRef.current) {
        canvasRef.current.height = 0;
        canvasRef.current.width = 0;
      }

      canvasRef.current = canvas;
    },
    [isParamsLoaded]
  );
  /**
   * Ref callback called when the container element mounts
   */
  const setContainerRef: RefCallback<HTMLElement> = useCallback(
    (container: HTMLElement | null) => {
      containerRef.current = container;
    },
    []
  );

  /**
   * Set up IntersectionObserver to stop rendering if the animation is not in
   * view.
   */
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      entry.isIntersecting
        ? rive && rive.startRendering()
        : rive && rive.stopRendering();
    });

    if (canvasRef.current) {
      observer.observe(canvasRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [rive]);

  /**
   * On unmount, stop rive from rendering.
   */
  useEffect(() => {
    return () => {
      if (rive) {
        rive.stop();
        setRive(null);
      }
    };
  }, [rive]);

  /**
   * Listen for changes in the animations params
   */
  const animations = riveParams?.animations;
  useEffect(() => {
    if (rive && animations) {
      if (rive.isPlaying) {
        rive.stop(rive.animationNames);
        rive.play(animations);
      } else if (rive.isPaused) {
        rive.stop(rive.animationNames);
        rive.pause(animations);
      }
    }
  }, [animations, rive]);

  const Component = useCallback(
    (props: ComponentProps<'canvas'>): JSX.Element => {
      return (
        <RiveComponent
          setContainerRef={setContainerRef}
          setCanvasRef={setCanvasRef}
          {...props}
        />
      );
    },
    []
  );

  return {
    canvas: canvasRef.current,
    setCanvasRef,
    setContainerRef,
    rive,
    RiveComponent: Component,
  };
}
