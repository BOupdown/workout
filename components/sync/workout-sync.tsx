'use client';

import { useEffect } from 'react';
import { startWorkoutSync } from '@/lib/supabase/sync';

/** Starts cloud sync only after AuthGate has established the account owner. */
export function WorkoutSync({ userId, children }: { userId: string; children: React.ReactNode }) {
  useEffect(() => startWorkoutSync(userId), [userId]);
  return <>{children}</>;
}
