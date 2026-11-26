import './globals.css';
import React from 'react';
import Link from 'next/link';

export const metadata = {
  title: 'FinCore — Simulated Digital Wallet & Ledger Platform',
  description: 'Educational FinTech assessment platform using synthetic balances only.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <div
          role="banner"
          aria-label="Simulation mode notice"
          className="bg-amber-100 border-b border-amber-300 text-amber-950 px-4 py-2 text-center text-xs font-semibold tracking-wide"
        >
          SIMULATION ENVIRONMENT — ALL BALANCES, TRANSFERS &amp; PAYMENT EVENTS ARE SYNTHETIC. NO REAL FUNDS ARE USED.
        </div>
        <header className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="font-bold text-lg tracking-tight">FinCore <span className="text-xs font-normal text-amber-300 ml-2">SIMULATED</span></div>
          <nav aria-label="Primary navigation" className="flex gap-6 text-sm">
            <Link href="/" className="hover:text-amber-300 focus:outline-none focus:underline">Customer Dashboard</Link>
            <Link href="/operations" className="hover:text-amber-300 focus:outline-none focus:underline">Operations &amp; Risk</Link>
          </nav>
        </header>
        <main className="max-w-6xl mx-auto p-6">{children}</main>
      </body>
    </html>
  );
}
