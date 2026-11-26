'use client';

import React, { useState } from 'react';
import { transferSchema } from '@/lib/schemas';

interface WalletView {
  id: string;
  label: string;
  currency: string;
  balance: string;
  heldBalance: string;
  availableBalance: string;
  isSimulated: boolean;
}

const DEMO_WALLETS: WalletView[] = [
  {
    id: '33333333-3333-4333-8333-333333333311',
    label: 'Primary USD Wallet',
    currency: 'USD',
    balance: '2500.0000',
    heldBalance: '0.0000',
    availableBalance: '2500.0000',
    isSimulated: true,
  },
];

export default function CustomerDashboardPage() {
  const [amount, setAmount] = useState('125.00');
  const [destWalletId, setDestWalletId] = useState('33333333-3333-4333-8333-333333333312');
  const [description, setDescription] = useState('Monthly rent split');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  function handleValidateTransfer(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    const parsed = transferSchema.safeParse({
      sourceWalletId: DEMO_WALLETS[0].id,
      destWalletId,
      amount,
      description,
      applyFee: true,
    });
    if (!parsed.success) {
      setErrorMsg(parsed.error.issues[0]?.message || 'Invalid transfer input');
      return;
    }
    setStatusMsg(`Ready to submit idempotent transfer of USD ${parsed.data.amount} (backend enforces balance & double-entry ledger).`);
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="wallets-heading">
        <h1 id="wallets-heading" className="text-2xl font-bold mb-4">Customer Wallets (Simulated Balances)</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {DEMO_WALLETS.map((w) => (
            <div key={w.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-800">{w.label}</h2>
                <span className="rounded-full bg-amber-100 text-amber-900 px-2.5 py-0.5 text-xs font-medium">
                  SIMULATED FUNDS
                </span>
              </div>
              <p className="mt-3 text-3xl font-mono font-bold text-slate-900">{w.currency} {w.availableBalance}</p>
              <p className="text-xs text-slate-500 mt-1">Total: {w.balance} | On Hold: {w.heldBalance}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="transfer-heading" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 id="transfer-heading" className="text-lg font-semibold mb-4">Initiate Simulated Transfer</h2>
        <form onSubmit={handleValidateTransfer} className="space-y-4 max-w-lg" noValidate>
          <div>
            <label htmlFor="destWallet" className="block text-sm font-medium text-slate-700">Beneficiary Wallet ID</label>
            <input
              id="destWallet"
              value={destWalletId}
              onChange={(e) => setDestWalletId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-slate-700">Amount (USD, Simulated)</label>
            <input
              id="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label htmlFor="memo" className="block text-sm font-medium text-slate-700">Description</label>
            <input
              id="memo"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          {errorMsg && <p role="alert" className="text-sm text-red-700 bg-red-50 p-2 rounded">{errorMsg}</p>}
          {statusMsg && <p role="status" className="text-sm text-emerald-800 bg-emerald-50 p-2 rounded">{statusMsg}</p>}
          <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Confirm &amp; Send Transfer
          </button>
        </form>
      </section>
    </div>
  );
}
