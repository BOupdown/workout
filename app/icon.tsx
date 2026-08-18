import { ImageResponse } from 'next/og';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

/**
 * Icône d'application : une haltère composée de rectangles, sur le vert
 * d'accent. Formes géométriques uniquement, pas de tracé dessiné à la main.
 *
 * Le glyphe est sombre sur le vert, comme partout ailleurs dans l'app : à cette
 * luminance, l'accent ne peut porter que de l'encre foncée.
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
