/**
 * OptimizedImage
 *
 * Drop-in replacement for <img> that adds:
 *  - Lazy loading for below-fold images (loading="lazy" + IntersectionObserver fallback)
 *  - Blur placeholder while the real image loads
 *  - srcSet for responsive images (multiple widths via Vite ?w= hint or explicit sizes)
 *  - WebP/AVIF format support via <picture> + <source> when the browser supports it
 *  - IPFS image proxy with caching (rewrites ipfs:// and ipfs.io URLs through a local proxy)
 *
 * Usage:
 *   // Basic (lazy by default)
 *   <OptimizedImage src="/sub-rosa-logo.png" alt="Sub Rosa" width={40} height={40} />
 *
 *   // Above the fold (eager)
 *   <OptimizedImage src="/sub-rosa-logo.png" alt="" priority />
 *
 *   // IPFS asset (auto-proxied)
 *   <OptimizedImage src="ipfs://Qm..." alt="asset" width={200} height={200} />
 *
 *   // With explicit responsive sizes
 *   <OptimizedImage src="/hero.png" alt="Hero" sizes="(max-width:768px) 100vw, 50vw" />
 */

import {
  useState,
  useRef,
  useEffect,
  type ImgHTMLAttributes,
  type CSSProperties,
} from "react";

// ---------------------------------------------------------------------------
// IPFS proxy
// ---------------------------------------------------------------------------

/**
 * IPFS_GATEWAY is the proxy base used to rewrite IPFS URLs.
 *
 * In development Vite proxies /ipfs/* to the public gateway (see vite.config.ts).
 * In production point VITE_IPFS_GATEWAY to your own caching gateway, e.g.
 *   https://cloudflare-ipfs.com/ipfs/
 */
const IPFS_GATEWAY =
  (import.meta as unknown as { env: Record<string, string> }).env?.VITE_IPFS_GATEWAY ??
  "/ipfs/";

function resolveIpfs(src: string): string {
  // ipfs://Qm... or ipfs://bafy...
  if (src.startsWith("ipfs://")) {
    const cid = src.slice("ipfs://".length);
    return `${IPFS_GATEWAY}${cid}`;
  }
  // https://ipfs.io/ipfs/...
  if (src.includes("ipfs.io/ipfs/")) {
    const cid = src.split("/ipfs/")[1];
    return `${IPFS_GATEWAY}${cid}`;
  }
  return src;
}

// ---------------------------------------------------------------------------
// srcSet builder
// ---------------------------------------------------------------------------

/**
 * Build a srcSet string for a given image src.
 *
 * For local/public images Vite's image transform can produce multiple widths via
 * `?w=N` query params. For external URLs we just return a single-entry srcSet so
 * the browser still picks the right DPR copy if one exists on the CDN.
 */
const DEFAULT_WIDTHS = [320, 640, 960, 1280, 1920];

function buildSrcSet(src: string, widths: number[]): string {
  // Only apply Vite ?w= transforms to local assets (starts with / or ./)
  const isLocal = src.startsWith("/") || src.startsWith("./");
  if (!isLocal) return `${src} 1x`;
  return widths.map((w) => `${src}?w=${w} ${w}w`).join(", ");
}

// ---------------------------------------------------------------------------
// Tiny SVG blur placeholder (20px wide, base64)
// ---------------------------------------------------------------------------

function buildBlurDataUrl(color = "#1a1a2e"): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">
    <filter id="b"><feGaussianBlur stdDeviation="4"/></filter>
    <rect width="100%" height="100%" fill="${color}" filter="url(#b)"/>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

const DEFAULT_PLACEHOLDER = buildBlurDataUrl();

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface OptimizedImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "loading"> {
  src: string;
  alt: string;
  /** Treat as above-the-fold: eager load, no blur placeholder */
  priority?: boolean;
  /** Widths for the srcSet. Defaults to [320,640,960,1280,1920] */
  widths?: number[];
  /** CSS sizes attribute for responsive layout, e.g. "(max-width:768px) 100vw, 50vw" */
  sizes?: string;
  /** Override the blur placeholder data URL */
  placeholder?: string;
  /** Disable blur placeholder */
  noPlaceholder?: boolean;
}

export function OptimizedImage({
  src,
  alt,
  priority = false,
  widths = DEFAULT_WIDTHS,
  sizes,
  placeholder = DEFAULT_PLACEHOLDER,
  noPlaceholder = false,
  style,
  className,
  width,
  height,
  onLoad,
  ...rest
}: OptimizedImageProps) {
  const resolved = resolveIpfs(src);
  const srcSet = buildSrcSet(resolved, widths);

  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(priority);
  const containerRef = useRef<HTMLDivElement>(null);

  // IntersectionObserver for lazy loading fallback (browsers that ignore
  // loading="lazy" on <picture>) — only needed when not priority.
  useEffect(() => {
    if (priority || visible) return;
    const el = containerRef.current;
    if (!el) return;

    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [priority, visible]);

  const showPlaceholder = !noPlaceholder && !loaded;

  const containerStyle: CSSProperties = {
    position: "relative",
    display: "inline-block",
    overflow: "hidden",
    width: width ? `${width}px` : undefined,
    height: height ? `${height}px` : undefined,
    ...style,
  };

  const imgStyle: CSSProperties = {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    transition: "opacity 0.3s ease",
    opacity: loaded ? 1 : 0,
  };

  const placeholderStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    backgroundImage: `url("${placeholder}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    transition: "opacity 0.3s ease",
    opacity: showPlaceholder ? 1 : 0,
    pointerEvents: "none",
  };

  // Derive WebP/AVIF source URLs for local assets
  const isLocal = resolved.startsWith("/") || resolved.startsWith("./");
  const base = resolved.replace(/\.(png|jpe?g)$/i, "");
  const avifSrcSet = isLocal
    ? widths.map((w) => `${base}.avif?w=${w} ${w}w`).join(", ")
    : null;
  const webpSrcSet = isLocal
    ? widths.map((w) => `${base}.webp?w=${w} ${w}w`).join(", ")
    : null;

  return (
    <div ref={containerRef} style={containerStyle} className={className}>
      {showPlaceholder && <div aria-hidden="true" style={placeholderStyle} />}

      {visible && (
        <picture>
          {avifSrcSet && (
            <source
              type="image/avif"
              srcSet={avifSrcSet}
              sizes={sizes}
            />
          )}
          {webpSrcSet && (
            <source
              type="image/webp"
              srcSet={webpSrcSet}
              sizes={sizes}
            />
          )}
          <img
            src={resolved}
            srcSet={srcSet}
            sizes={sizes}
            alt={alt}
            width={width}
            height={height}
            loading={priority ? "eager" : "lazy"}
            decoding={priority ? "sync" : "async"}
            fetchPriority={priority ? "high" : "auto"}
            style={imgStyle}
            onLoad={(e) => {
              setLoaded(true);
              onLoad?.(e);
            }}
            {...rest}
          />
        </picture>
      )}
    </div>
  );
}