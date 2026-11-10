import { prisma } from '../core/db.ts';
import { audit } from '../core/audit.ts';
import { logger } from '../core/logger.ts';
import { ValidationError } from '../core/errors.ts';
import { assertNotStopped, getControls } from '../security/controls.ts';
import * as email from '../integrations/email.ts';

/**
 * Inbound inquiry handling (Phase 19).
 *
 * This is the "answer product questions using verified product information" leg
 * of the lifecycle. A visitor submits the public contact form; TAREQ stores the
 * question and drafts an answer built ONLY from the product's own verified
 * fields (deliverables, price, requirements, limitations). No answer is invented
 * and no commitment is made.
 *
 * A reply is transmitted only when:
 *  - the person submitted the form themselves (explicit consent — this is not
 *    unsolicited outreach), and
 *  - the owner has granted `outreachAllowed` (permission to send email to
 *    people), and
 *  - email is configured.
 * Otherwise the answer is stored for the owner to review and send.
 */

export interface CreateInquiryInput {
  email: string;
  name?: string | null;
  message: string;
  productSlug?: string | null;
  ip?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createInquiry(input: CreateInquiryInput): Promise<{ id: string }> {
  const emailAddr = input.email.trim().toLowerCase();
  const message = input.message.trim();
  if (!EMAIL_RE.test(emailAddr)) throw new ValidationError('a valid email address is required');
  if (message.length < 5) throw new ValidationError('please include a short question');
  if (message.length > 4000) throw new ValidationError('message is too long');

  const row = await prisma.inquiry.create({
    data: {
      email: emailAddr,
      name: input.name?.trim().slice(0, 200) || null,
      message,
      productSlug: input.productSlug?.trim() || null,
      ip: input.ip ?? null,
    },
  });
  await audit({ actorType: 'system', action: 'inquiry.received', target: row.id, metadata: { productSlug: row.productSlug } });
  return { id: row.id };
}

function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

function baseUrl(): string {
  const explicit = process.env.TAREQ_PUBLIC_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (domain) return `https://${domain.replace(/\/+$/, '')}`;
  return '';
}

/** Build an honest answer from the product's verified fields. */
async function composeAnswer(inquiry: { productSlug: string | null; message: string; name: string | null }): Promise<string> {
  const hello = inquiry.name ? `Hello ${inquiry.name},` : 'Hello,';
  const product = inquiry.productSlug
    ? await prisma.product.findFirst({ where: { slug: inquiry.productSlug, status: 'PUBLISHED' } })
    : null;

  if (!product) {
    return [
      hello,
      '',
      'Thank you for your message. A member of the team will reply with the specifics of your request.',
      '',
      'In the meantime, you can see our published services here:',
      baseUrl() ? `${baseUrl()}/shop` : '/shop',
      '',
      '— TAREQ AI',
    ].join('\n');
  }

  const deliverables = asStringList(product.deliverables);
  const requirements = asStringList(product.requirements);
  const limitations = asStringList(product.limitations);
  const price = `$${Number(product.priceUsd).toLocaleString('en-US')}`;
  const buyUrl = baseUrl() ? `${baseUrl()}/buy/${product.slug}` : `/buy/${product.slug}`;

  const lines = [hello, '', `Thanks for asking about ${product.name}.`];
  if (deliverables.length) {
    lines.push('', 'What you receive:');
    for (const d of deliverables) lines.push(`- ${d}`);
  }
  lines.push('', `Price: ${price} ${product.currency}, one-time.`);
  if (requirements.length) {
    lines.push('', 'What we need from you to start:');
    for (const r of requirements) lines.push(`- ${r}`);
  }
  if (limitations.length) {
    lines.push('', 'What this service does not do:');
    for (const l of limitations) lines.push(`- ${l}`);
  }
  lines.push('', `You can purchase securely here: ${buyUrl}`, '', 'If you would rather not hear from us again, reply "stop" and we will not contact you.', '', '— TAREQ AI');
  return lines.join('\n');
}

/**
 * Answer an inquiry and, when permitted, send the reply. Idempotent: an already
 * answered inquiry is not re-answered or re-sent.
 */
export async function answerInquiry(id: string): Promise<{ answered: boolean; sent: boolean; reason?: string }> {
  const inquiry = await prisma.inquiry.findUnique({ where: { id } });
  if (!inquiry) throw new ValidationError('inquiry not found');
  await assertNotStopped();
  if (inquiry.status === 'CLOSED' || inquiry.replySentAt) {
    return { answered: Boolean(inquiry.answer), sent: false, reason: 'already handled' };
  }

  // Persist the answer before attempting delivery. If delivery is disabled or
  // fails, a later retry reuses this exact answer instead of losing the reply.
  let answer = inquiry.answer;
  if (!answer) {
    if (inquiry.status !== 'NEW') return { answered: false, sent: false, reason: 'no stored answer to retry' };
    answer = await composeAnswer(inquiry);
    await prisma.inquiry.update({
      where: { id },
      data: { status: 'ANSWERED', answer, answeredAt: new Date() },
    });
    await audit({ actorType: 'agent', action: 'inquiry.answered', target: id });
  }

  // Transmit only with explicit owner permission to email people. The person
  // submitted the form, so this is a requested reply, not outreach.
  const controls = await getControls().catch(() => null);
  if (!controls?.outreachAllowed) return { answered: true, sent: false, reason: 'reply stored; email permission not granted' };
  if (!email.status().configured) return { answered: true, sent: false, reason: 'reply stored; email not configured' };

  // This function is called both by the worker and directly by public POST
  // /contact. Enforce the global stop at the actual external side-effect edge.
  await assertNotStopped();

  // A short lease prevents parallel workers from sending the same reply. A
  // crashed process releases itself after ten minutes; failed sends release
  // immediately. The timestamp is also the lease token for safe cleanup.
  const lease = new Date();
  const claimed = await prisma.inquiry.updateMany({
    where: {
      id,
      replySentAt: null,
      OR: [{ replyClaimedAt: null }, { replyClaimedAt: { lt: new Date(lease.getTime() - 10 * 60_000) } }],
    },
    data: { replyClaimedAt: lease },
  });
  if (claimed.count === 0) return { answered: true, sent: false, reason: 'reply is already sent or being delivered' };

  const outcome = await email.send({ to: inquiry.email, subject: 'Your question about our research service', text: answer });
  if (outcome.sent) {
    await prisma.inquiry.updateMany({
      where: { id, replyClaimedAt: lease, replySentAt: null },
      data: { replySentAt: new Date(), replyClaimedAt: null },
    });
    await audit({ actorType: 'system', action: 'inquiry.reply_sent', target: id, severity: 'warn' });
    return { answered: true, sent: true };
  }
  await prisma.inquiry.updateMany({ where: { id, replyClaimedAt: lease }, data: { replyClaimedAt: null } });
  logger.warn('inquiry reply send failed', { id, reason: outcome.reason });
  return { answered: true, sent: false, reason: outcome.reason ?? 'send failed' };
}

export async function listInquiries() {
  return prisma.inquiry.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
}
