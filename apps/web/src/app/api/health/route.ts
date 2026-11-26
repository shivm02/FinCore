cdimport { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'fincore-web', simulationMode: true });
}
