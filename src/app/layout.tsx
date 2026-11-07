import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VoiceProxy AI',
  description:
    'AI voice proxy platform - real-time voice routing, cloning and transcription powered by OpenAI, Supabase and Stripe.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
