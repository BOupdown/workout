'use client';

import {
  DeviceMobile,
  DownloadSimple,
  HardDrives,
  Scales,
  ShieldCheck,
  Timer,
  UploadSimple,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { useInstallPrompt } from '@/hooks/use-install-prompt';
import { useWeightUnit } from '@/hooks/use-weight-unit';
import { useStorageStatus } from '@/hooks/use-storage-status';
import { useBackupExport } from '@/hooks/use-backup';
import { useRestTimer } from '@/hooks/use-rest-timer';
import {
  BackupFormatError,
  importDatabase,
  parseBackup,
  type BackupSummary,
} from '@/lib/db/backup';
import { formatDuration } from '@/lib/format';
import {
  MAX_REST_SEC,
  MIN_REST_SEC,
  REST_DURATIONS_SEC,
  restDurationFromParts,
  splitRestDuration,
  type RestDurationParts,
} from '@/lib/rest-timer';
import { WEIGHT_UNITS } from '@/lib/units';

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsScreen() {
  const storage = useStorageStatus();
  const install = useInstallPrompt();
  const [unit, setUnit] = useWeightUnit();
  const rest = useRestTimer();
  const backup = useBackupExport();
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * The custom fields hold their own text while being typed. Reading them
   * straight from the stored duration would fight the typing: clearing the
   * minutes to type "2" would land on the floor of 5 s and put "0" back under
   * the thumb. `null` means "not being edited", and the fields then show
   * whatever is in force.
   */
  const [draft, setDraft] = useState<RestDurationParts | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);


  const isPreset = (REST_DURATIONS_SEC as readonly number[]).includes(rest.durationSec);
  // Shown whenever the duration in force is not one of the four, so a custom
  // rest is never hidden behind a button that looks unselected.
  const showCustom = customOpen || !isPreset;
  const parts = draft ?? splitRestDuration(rest.durationSec);

  const editParts = (changes: Partial<RestDurationParts>) => {
    const next = { ...parts, ...changes };
    setDraft(next);

    // Committed on every keystroke, so the choice holds even if the field is
    // never blurred — a phone is just as likely to be pocketed as tapped away.
    const seconds = restDurationFromParts(next);
    if (seconds !== null) rest.setDurationSec(seconds);
  };

  // Back to what was actually kept: an entry out of bounds was clamped, and the
  // fields must say so rather than keep showing the number that did not stick.
  const settleParts = () => setDraft(null);

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const backup = parseBackup(await file.text());
      const summary: BackupSummary = await importDatabase(backup);
      setMessage(
        `${summary.sessions} session${summary.sessions > 1 ? 's' : ''} and ${summary.sets} set${summary.sets > 1 ? 's' : ''} restored.`,
      );
    } catch (thrown) {
      setError(
        thrown instanceof BackupFormatError
          ? thrown.message
          : 'Restore failed: the file holds invalid data. Nothing was changed.',
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
        <h1 className="text-[0.9375rem] font-semibold text-ink">Settings</h1>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <section className="flex gap-3 rounded-panel bg-raised px-4 py-3.5">
          <ShieldCheck size={20} weight="duotone" className="mt-0.5 shrink-0 text-muted" />
          <p className="text-sm text-muted">
            Your data stays on your phone. No account, no server, nothing is sent anywhere.
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

        <section className="rounded-panel bg-raised px-4 py-3.5">
          <div className="flex items-center gap-2">
            <Scales size={18} weight="bold" className="shrink-0 text-ink" />
            <h2 className="text-[0.9375rem] font-semibold text-ink">Units</h2>
          </div>
          {/* Display only: loads are always stored in kilograms, so switching
              never rewrites a single row. */}
          <p className="mt-1.5 text-sm text-muted">
            Display only. Your sets are stored in kilograms either way.
          </p>

          <div className="mt-3 flex gap-1.5">
            {WEIGHT_UNITS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setUnit(option)}
                aria-pressed={unit === option}
                className={`h-14 flex-1 rounded-control border-2 text-[0.9375rem] font-semibold transition-transform active:scale-[0.98] ${
                  unit === option
                    ? 'border-ink bg-raised text-ink'
                    : 'border-transparent bg-surface text-muted'
                }`}
              >
                {option === 'kg' ? 'Kilograms (kg)' : 'Pounds (lb)'}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-panel bg-raised px-4 py-3.5">
          <div className="flex items-center gap-2">
            <Timer size={18} weight="bold" className="shrink-0 text-ink" />
            <h2 className="text-[0.9375rem] font-semibold text-ink">Rest timer</h2>
          </div>
          <p className="mt-1.5 text-sm text-muted">
            Starts on its own each time you save a set. You can always add time, or skip it.
          </p>

          <div className="mt-3 flex gap-1.5">
            {REST_DURATIONS_SEC.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setCustomOpen(false);
                  setDraft(null);
                  rest.setDurationSec(option);
                }}
                aria-pressed={rest.durationSec === option}
                className={`h-14 flex-1 rounded-control border-2 font-mono text-[0.9375rem] font-semibold tabular-nums transition-transform active:scale-[0.98] ${
                  rest.durationSec === option
                    ? 'border-ink bg-raised text-ink'
                    : 'border-transparent bg-surface text-muted'
                }`}
              >
                {formatDuration(option)}
              </button>
            ))}
          </div>

          {/* Four buttons cannot cover every rest anyone trains on: a heavy
              triple wants five minutes, a superset wants forty seconds. The
              presets stay the one-tap path, and the exact number is one tap
              further rather than absent. */}
          {showCustom ? (
            <div
              className={`mt-1.5 rounded-control border-2 px-3 py-3 ${
                isPreset ? 'border-line' : 'border-ink'
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  enterKeyHint="done"
                  autoComplete="off"
                  aria-label="Rest, minutes"
                  value={parts.minutes}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => editParts({ minutes: event.target.value })}
                  onBlur={settleParts}
                  className="h-14 min-w-0 flex-1 rounded-control border-2 border-line bg-surface text-center font-mono text-xl font-semibold text-ink tabular-nums outline-none focus:border-ink"
                />
                <span className="shrink-0 text-sm text-muted">min</span>

                <input
                  type="text"
                  inputMode="numeric"
                  enterKeyHint="done"
                  autoComplete="off"
                  aria-label="Rest, seconds"
                  value={parts.seconds}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => editParts({ seconds: event.target.value })}
                  onBlur={settleParts}
                  className="h-14 min-w-0 flex-1 rounded-control border-2 border-line bg-surface text-center font-mono text-xl font-semibold text-ink tabular-nums outline-none focus:border-ink"
                />
                <span className="shrink-0 text-sm text-muted">s</span>
              </div>

              {/* Said plainly, because both ends are enforced silently: an entry
                  outside them is pulled back into range the moment you leave
                  the field. */}
              {/* In the units of the two fields above, not as a duration:
                  `formatDuration` reads the ceiling as "1:00:00", which says
                  nothing useful next to a box labelled min. */}
              <p className="mt-2 text-xs text-muted">
                Any time from {MIN_REST_SEC} s to {MAX_REST_SEC / 60} min.
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCustomOpen(true)}
              className="mt-1.5 h-14 w-full rounded-control border-2 border-transparent bg-surface text-[0.9375rem] font-semibold text-muted transition-transform active:scale-[0.98]"
            >
              Custom time
            </button>
          )}
        </section>

        {!install.installed ? (
          <section className="rounded-panel bg-raised px-4 py-3.5">
            <div className="flex items-center gap-2">
              <DeviceMobile size={18} weight="bold" className="shrink-0 text-ink" />
              <h2 className="text-[0.9375rem] font-semibold text-ink">Install the app</h2>
            </div>
            <p className="mt-1.5 text-sm text-muted">
              On your home screen the app opens full screen, and its data is far better protected
              from automatic clearing.
            </p>

            {install.canPrompt ? (
              <button
                type="button"
                onClick={install.promptInstall}
                className="mt-3 h-14 w-full rounded-control bg-accent text-[0.9375rem] font-semibold text-accent-ink transition-transform active:scale-[0.98]"
              >
                Add to home screen
              </button>
            ) : (
              <p className="mt-2.5 text-sm text-muted">
                On iPhone: the Share button, then “Add to Home Screen”. On Android: the browser
                menu, then “Install app”.
              </p>
            )}
          </section>
        ) : null}

        <section className="rounded-panel bg-raised px-4 py-3.5">
          <div className="flex items-center gap-2">
            <HardDrives size={18} weight="bold" className="shrink-0 text-ink" />
            <h2 className="text-[0.9375rem] font-semibold text-ink">Storage</h2>
          </div>

          {storage.supported === false ? (
            <p className="mt-1.5 text-sm text-muted">
              This browser does not report storage state.
            </p>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-muted">
                {/* Also the neutral first render, before the browser is asked. */}
                {storage.persisted === null
                  ? 'Checking…'
                  : storage.persisted
                    ? 'Durable storage granted: your data will not be cleared if the device runs short of space.'
                    : 'Storage is not durable: the browser may clear your data if it runs short of space.'}
                {storage.usageBytes !== null ? ` ${formatBytes(storage.usageBytes)} used.` : ''}
              </p>

              {storage.persisted === false ? (
                <button
                  type="button"
                  onClick={storage.requestPersist}
                  className="mt-3 h-14 w-full rounded-control bg-ink text-[0.9375rem] font-semibold text-surface transition-transform active:scale-[0.98]"
                >
                  Request durable storage
                </button>
              ) : null}
            </>
          )}
        </section>

        <section className="rounded-panel bg-raised px-4 py-3.5">
          <div className="flex items-center gap-2">
            <DownloadSimple size={18} weight="bold" className="shrink-0 text-ink" />
            <h2 className="text-[0.9375rem] font-semibold text-ink">Backup</h2>
          </div>
          <p className="mt-1.5 text-sm text-muted">
            A file you keep. It is the only protection that survives clearing the browser or
            changing phone.
          </p>

          {/* Stated even when it was never done: "never" is the answer that
              matters most, and an empty line would read as reassurance. */}
          <p className="mt-2 font-mono text-xs text-muted tabular-nums">
            Last backup:{' '}
            {backup.lastBackupAt === null
              ? 'never'
              : DATE_FORMAT.format(backup.lastBackupAt)}
          </p>

          <button
            type="button"
            onClick={backup.exportNow}
            disabled={busy || backup.running}
            className="mt-3 h-14 w-full rounded-control bg-accent text-[0.9375rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {backup.running ? 'One moment…' : 'Export my data'}
          </button>

          {backup.error ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {backup.error}
            </p>
          ) : backup.message ? (
            <p className="mt-2 text-sm text-ink">{backup.message}</p>
          ) : null}
        </section>

        <section className="rounded-panel bg-raised px-4 py-3.5">
          <div className="flex items-center gap-2">
            <UploadSimple size={18} weight="bold" className="shrink-0 text-ink" />
            <h2 className="text-[0.9375rem] font-semibold text-ink">Restore</h2>
          </div>
          <p className="mt-1.5 text-sm text-muted">
            Replaces <strong className="font-semibold text-ink">all</strong> of your current data
            with the file’s. If the file is invalid, nothing is changed.
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
                Cancel
              </button>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
                className="h-14 flex-1 rounded-control bg-ink text-[0.9375rem] font-semibold text-surface transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                Choose file
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="mt-3 h-14 w-full rounded-control border-2 border-line text-[0.9375rem] font-semibold text-ink transition-transform active:scale-[0.98] disabled:opacity-50"
            >
              Restore a backup
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
