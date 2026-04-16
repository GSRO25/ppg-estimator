import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function requireRole(requiredRole: 'admin' | 'estimator') {
  const session = await auth();
  if (!session?.user?.email) {
    return { authorized: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const [user] = await query<{ id: number; role: string }>(
    'SELECT id, role FROM users WHERE email = $1',
    [session.user.email]
  );

  if (!user) {
    return { authorized: false, response: NextResponse.json({ error: 'User not found' }, { status: 403 }) };
  }

  if (requiredRole === 'admin' && user.role !== 'admin') {
    return { authorized: false, response: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) };
  }

  return { authorized: true, user };
}
