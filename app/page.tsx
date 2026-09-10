import { AppShell } from '@/components/app-shell';
import { AuthGate } from '@/components/auth/auth-gate';

export default function Home() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}
