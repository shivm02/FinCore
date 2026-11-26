import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CustomerDashboardPage from '../src/app/page';

describe('CustomerDashboardPage (Assessment 01)', () => {
  it('clearly labels simulated balances', () => {
    render(<CustomerDashboardPage />);
    expect(screen.getByText(/SIMULATED FUNDS/i)).toBeInTheDocument();
  });

  it('rejects negative or non-numeric transfer amounts with safe inline validation', () => {
    render(<CustomerDashboardPage />);
    const amountInput = screen.getByLabelText(/Amount/i);
    fireEvent.change(amountInput, { target: { value: '-50.00' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirm & Send Transfer/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
