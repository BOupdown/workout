import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * Icône iOS (écran d'accueil), même composition à l'échelle 180 px.
 * Icône d'application : une haltère composée de rectangles, sur le vert
 * d'accent. Formes géométriques uniquement, pas de tracé dessiné à la main.
 *
 * Le glyphe est sombre sur le vert, comme partout ailleurs dans l'app : à cette
 * luminance, l'accent ne peut porter que de l'encre foncée.
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
