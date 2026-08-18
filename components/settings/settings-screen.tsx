'use client';

import {
  DeviceMobile,
  DownloadSimple,
  HardDrives,
  ShieldCheck,
  UploadSimple,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { useInstallPrompt } from '@/hooks/use-install-prompt';
import { useStorageStatus } from '@/hooks/use-storage-status';
import {
  backupFileName,
  BackupFormatError,
  exportDatabase,
  importDatabase,
  parseBackup,
  type BackupSummary,
} from '@/lib/db/backup';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function SettingsScreen() {
  const storage = useStorageStatus();
  const install = useInstallPrompt();
  const fileInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const backup = await exportDatabase();
      const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.download = backupFileName(backup.exportedAt);
      link.click();
      URL.revokeObjectURL(url);

      setMessage(
        `Sauvegarde de ${backup.sessions.length} séance${backup.sessions.length > 1 ? 's' : ''} téléchargée.`,
      );
    } catch {
      setError('La sauvegarde a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const backup = parseBackup(await file.text());
      const summary: BackupSummary = await importDatabase(backup);
      setMessage(
        `${summary.sessions} séance${summary.sessions > 1 ? 's' : ''} et ${summary.sets} série${summary.sets > 1 ? 's' : ''} restaurées.`,
      );
    } catch (thrown) {
      setError(
        thrown instanceof BackupFormatError
          ? thrown.message
          : 'Restauration impossible : le fichier contient des données invalides. Rien n’a été modifié.',
      );
    } finally {
      setBusy(false);
      setConfirming(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-line bg-raised px-4 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3.5">
        <h1 className="text-[0.9375rem] font-semibold text-ink">Réglages</h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <section className="flex gap-3 rounded-panel bg-raised px-4 py-3.5">
          <ShieldCheck size={20} weight="duotone" className="mt-0.5 shrink-0 text-muted" />
          <p className="text-sm text-muted">
            Tes données restent sur ton téléphone. Aucun compte, aucun serveur, rien n’est envoyé.
          </p>
        </section>

        {message ? (
          <p role="status" className="rounded-control bg-accent-wash px-3 py-2 text-sm text-ink">
            {message}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        {!install.installed ? (
          <section className="rounded-panel bg-raised px-4 py-3.5">
            <div className="flex items-center gap-2">
              <DeviceMobile size={18} weight="bold" className="shrink-0 text-ink" />
              <h2 className="text-[0.9375rem] font-semibold text-ink">Installer l’app</h2>
            </div>
            <p className="mt-1.5 text-sm text-muted">
              Sur l’écran d’accueil, l’app s’ouvre en plein écran et ses données sont bien mieux
              protégées de l’effacement automatique.
            </p>

            {install.canPrompt ? (
              <button
                type="button"
                onClick={install.promptInstall}
                className="mt-3 h-14 w-full rounded-control bg-accent text-[0.9375rem] font-semibold text-accent-ink transition-transform active:scale-[0.98]"
              >
                Ajouter à l’écran d’accueil
              </button>
            ) : (
              <p className="mt-2.5 text-sm text-muted">
                Sur iPhone : bouton Partager, puis « Sur l’écran d’accueil ». Sur Android : menu du
                navigateur, puis « Installer l’application ».
              </p>
            )}
          </section>
        ) : null}

        <section className="rounded-panel bg-raised px-4 py-3.5">
          <div className="flex items-center gap-2">
            <HardDrives size={18} weight="bold" className="shrink-0 text-ink" />
            <h2 className="text-[0.9375rem] font-semibold text-ink">Stockage</h2>
          </div>

          {!storage.supported ? (
            <p className="mt-1.5 text-sm text-muted">
              Ce navigateur ne renseigne pas l’état du stockage.
            </p>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-muted">
                {storage.persisted === null
                  ? 'Vérification…'
                  : storage.persisted
                    ? 'Stockage durable accordé : tes données ne seront pas effacées si l’appareil manque de place.'
                    : 'Stockage non durable : le navigateur peut effacer tes données s’il manque de place.'}
                {storage.usageBytes !== null ? ` ${formatBytes(storage.usageBytes)} utilisés.` : ''}
              </p>

              {storage.persisted === false ? (
                <button
                  type="button"
                  onClick={storage.requestPersist}
                  className="mt-3 h-14 w-full rounded-control bg-ink text-[0.9375rem] font-semibold text-surface transition-transform active:scale-[0.98]"
                >
                  Demander un stockage durable
                </button>
              ) : null}
            </>
          )}
        </section>

        <section className="rounded-panel bg-raised px-4 py-3.5">
          <div className="flex items-center gap-2">
            <DownloadSimple size={18} weight="bold" className="shrink-0 text-ink" />
            <h2 className="text-[0.9375rem] font-semibold text-ink">Sauvegarde</h2>
          </div>
          <p className="mt-1.5 text-sm text-muted">
            Un fichier que tu gardes. C’est la seule protection qui survit à un effacement du
            navigateur ou à un changement de téléphone.
          </p>

          <button
            type="button"
            onClick={handleExport}
            disabled={busy}
            className="mt-3 h-14 w-full rounded-control bg-accent text-[0.9375rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Un instant…' : 'Exporter mes données'}
          </button>
        </section>

        <section className="rounded-panel bg-raised px-4 py-3.5">
          <div className="flex items-center gap-2">
            <UploadSimple size={18} weight="bold" className="shrink-0 text-ink" />
            <h2 className="text-[0.9375rem] font-semibold text-ink">Restaurer</h2>
          </div>
          <p className="mt-1.5 text-sm text-muted">
            Remplace <strong className="font-semibold text-ink">toutes</strong> tes données
            actuelles par celles du fichier. Si le fichier est invalide, rien n’est modifié.
          </p>

          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />

          {confirming ? (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-14 flex-1 rounded-control bg-surface text-[0.9375rem] font-medium text-muted transition-transform active:scale-[0.98]"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
                className="h-14 flex-1 rounded-control bg-ink text-[0.9375rem] font-semibold text-surface transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                Choisir le fichier
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="mt-3 h-14 w-full rounded-control border-2 border-line text-[0.9375rem] font-semibold text-ink transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              Restaurer une sauvegarde
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
