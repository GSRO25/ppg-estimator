import { query } from '@/lib/db';

export async function logAudit(
  userId: number | null,
  action: string,
  entityType: string,
  entityId?: number | null,
  details?: Record<string, unknown>,
  ipAddress?: string,
) {
  await query(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, action, entityType, entityId || null, details ? JSON.stringify(details) : null, ipAddress || null]
  );
}
