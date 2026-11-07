/** Typed error hierarchy so callers can react to failure classes explicitly. */

export class TareqError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, opts: { retryable?: boolean; details?: Record<string, unknown> } = {}) {
    super(message);
    this.name = 'TareqError';
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details;
  }
}

/** The action needs an explicit owner decision before it may proceed. */
export class ApprovalRequiredError extends TareqError {
  constructor(action: string, reason: string) {
    super('APPROVAL_REQUIRED', `Owner approval required for "${action}": ${reason}`, { retryable: false });
    this.name = 'ApprovalRequiredError';
  }
}

/** The action exceeded a hard limit (budget, rate, attempts). */
export class LimitExceededError extends TareqError {
  constructor(limit: string, detail: string) {
    super('LIMIT_EXCEEDED', `${limit} exceeded: ${detail}`, { retryable: false });
    this.name = 'LimitExceededError';
  }
}

/** A provider (model API) failed; usually retryable. */
export class ProviderError extends TareqError {
  constructor(provider: string, message: string, retryable = true) {
    super('PROVIDER_ERROR', `[${provider}] ${message}`, { retryable });
    this.name = 'ProviderError';
  }
}

/** Validation failure on untrusted input. */
export class ValidationError extends TareqError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, { retryable: false, details });
    this.name = 'ValidationError';
  }
}

/** Authorization failure — caller is not permitted. */
export class ForbiddenError extends TareqError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, { retryable: false });
    this.name = 'ForbiddenError';
  }
}
