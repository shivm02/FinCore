import { z } from 'zod';

export const transferSchema = z.object({
  sourceWalletId: z.string().uuid('Select a valid source wallet'),
  destWalletId: z.string().uuid('Select a valid beneficiary wallet'),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/, 'Enter a valid decimal amount (up to 4 decimals)')
    .refine((v) => Number(v) > 0, 'Amount must be greater than zero'),
  description: z.string().min(3, 'Enter a short memo').max(140),
  applyFee: z.boolean().default(true),
});

export const disputeSchema = z.object({
  transactionId: z.string().uuid('Valid transaction ID required'),
  reasonCode: z.enum(['UNAUTHORIZED', 'DUPLICATE_CHARGE', 'AMOUNT_MISMATCH', 'SETTLEMENT_FAILED']),
  description: z.string().min(10, 'Provide at least 10 characters describing the issue').max(500),
});

export type TransferFormValues = z.infer<typeof transferSchema>;
export type DisputeFormValues = z.infer<typeof disputeSchema>;
