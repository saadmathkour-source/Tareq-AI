import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { prisma } from '../core/db.ts';
import { ForbiddenError, ValidationError } from '../core/errors.ts';
import { audit } from '../core/audit.ts';

/**
 * Owner identity.
 *
 * Password hashing uses scrypt (no native deps). Session tokens are random and
 * stored only as a SHA-256 hash, so a database read cannot reconstruct a live
 * session. There is exactly one primary owner; the agent cannot create owners.
 */

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface OwnerIdentity {
  id: string;
  email: string;
  displayName: string | null;
  locale: string;
}

export async function login(
  email: string,
  password: string,
  meta: { userAgent?: string; ip?: string } = {},
): Promise<{ token: string; owner: OwnerIdentity }> {
  const owner = await prisma.owner.findUnique({ where: { email: email.toLowerCase().trim() } });
  // Uniform failure: never reveal whether the email exists.
  if (!owner || !verifyPassword(password, owner.passwordHash)) {
    await audit({ actorType: 'system', action: 'owner.login_failed', target: email, severity: 'warn' });
    throw new ForbiddenError('Invalid credentials');
  }
  const token = randomBytes(32).toString('base64url');
  await prisma.session.create({
    data: {
      ownerId: owner.id,
      tokenHash: hashToken(token),
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  await audit({ actorType: 'owner', actorId: owner.id, action: 'owner.login', severity: 'info' });
  return {
    token,
    owner: { id: owner.id, email: owner.email, displayName: owner.displayName, locale: owner.locale },
  };
}

/** Resolve a bearer token to the owner, enforcing expiry and revocation. */
export async function authenticate(token: string | undefined | null): Promise<OwnerIdentity> {
  if (!token) throw new ForbiddenError('Missing session token');
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { owner: true },
  });
  if (!session) throw new ForbiddenError('Invalid session');
  if (session.revokedAt) throw new ForbiddenError('Session revoked');
  if (session.expiresAt.getTime() < Date.now()) throw new ForbiddenError('Session expired');
  return {
    id: session.owner.id,
    email: session.owner.email,
    displayName: session.owner.displayName,
    locale: session.owner.locale,
  };
}

export async function logout(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Invalidate every live session (emergency stop / credential rotation). */
export async function revokeAllSessions(actorId: string): Promise<number> {
  const res = await prisma.session.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ actorType: 'owner', actorId, action: 'sessions.revoke_all', severity: 'critical', metadata: { count: res.count } });
  return res.count;
}

/** Create the single primary owner. Refuses if one already exists. */
export async function createPrimaryOwner(email: string, password: string, displayName?: string): Promise<OwnerIdentity> {
  if (password.length < 10) throw new ValidationError('Owner password must be at least 10 characters');
  const existing = await prisma.owner.count();
  if (existing > 0) throw new ValidationError('An owner already exists; refusing to create a second primary owner');
  const owner = await prisma.owner.create({
    data: {
      email: email.toLowerCase().trim(),
      passwordHash: hashPassword(password),
      displayName: displayName ?? null,
      isPrimary: true,
    },
  });
  await audit({ actorType: 'system', action: 'owner.created', target: owner.id, severity: 'warn' });
  return { id: owner.id, email: owner.email, displayName: owner.displayName, locale: owner.locale };
}
