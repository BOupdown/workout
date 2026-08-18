import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Workout — suivi de séances, poids et répétitions série par série';

/**
 * Carte d'aperçu des réseaux sociaux.
 *
 * Sans elle, un lien partagé s'affiche sans vignette et passe pour mort. Même
 * langage que l'app : fond vert d'accent, encre sombre dessus — cet accent ne
 * peut pas porter de texte clair.
 */
export default function OpengraphImage() {
  const bar = { background: '#111113', borderRadius: 10 };

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#ccec4b',
          color: '#111113',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ ...bar, width: 20, height: 84 }} />
          <div style={{ ...bar, width: 20, height: 130 }} />
          <div style={{ ...bar, width: 74, height: 24 }} />
          <div style={{ ...bar, width: 20, height: 130 }} />
          <div style={{ ...bar, width: 20, height: 84 }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 108, fontWeight: 700, letterSpacing: -3 }}>Workout</div>
          <div style={{ fontSize: 40, marginTop: 8, opacity: 0.72 }}>
            Poids et répétitions, série par série.
          </div>
          <div style={{ fontSize: 30, marginTop: 28, opacity: 0.55 }}>
            Vos données restent sur votre téléphone.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
