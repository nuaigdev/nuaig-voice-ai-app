import { ConsoleApp } from '@/components/ConsoleApp';
import { DEMO_CREDENTIALS, isDemoMode } from '@/lib/demo';

export default function Home() {
  return <ConsoleApp demoCredentials={isDemoMode() ? { ...DEMO_CREDENTIALS } : null} />;
}
