import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

/**
 * App icon: a barbell made of rectangles, on the accent green. Geometric shapes
 * only, no hand-drawn paths.
 *
 * The glyph is dark on the green, as everywhere else in the app: at this
 * lightness the accent can only carry dark ink.
 */
export default function Icon() {
  const bar = { background: '#111113', borderRadius: 12 };

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          background: '#ccec4b',
        }}
      >
        <div style={{ ...bar, width: 34, height: 168 }} />
        <div style={{ ...bar, width: 34, height: 264 }} />
        <div style={{ ...bar, width: 150, height: 46 }} />
        <div style={{ ...bar, width: 34, height: 264 }} />
        <div style={{ ...bar, width: 34, height: 168 }} />
      </div>
    ),
    size,
  );
}
