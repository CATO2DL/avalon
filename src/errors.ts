import type { ErrorCode } from './types.ts';

export class RuleError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) {
    super(code);
    this.name = 'RuleError';
    this.code = code;
  }
}
