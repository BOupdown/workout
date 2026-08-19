import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * iOS home-screen icon, same composition at 180px.
 *
 * A barbell made of rectangles on the accent green, geometric shapes only. The
 * glyph is dark on the green: at this lightness the accent can only carry dark
 * ink.
 */
export default function AppleIcon() {
  const bar = { background: '#111113', borderRadius: 4 };

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 5,
          background: '#ccec4b',
        }}
      >
        <div style={{ ...bar, width: 12, height: 59 }} />
        <div style={{ ...bar, width: 12, height: 93 }} />
        <div style={{ ...bar, width: 53, height: 16 }} />
        <div style={{ ...bar, width: 12, height: 93 }} />
        <div style={{ ...bar, width: 12, height: 59 }} />
      </div>
    ),
    size,
  );
}
