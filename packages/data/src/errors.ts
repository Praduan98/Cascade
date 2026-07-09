// API error taxonomy. These mirror the HTTP statuses a real backend would
// return, so UI error handling written against them survives the swap from
// MockApi to a future HttpApi unchanged.

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code = 'api_error', status = 500) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/** 403 — the actor's role does not permit this action (e.g. a viewer writing). */
export class ForbiddenError extends ApiError {
  constructor(message = 'You do not have permission to do that') {
    super(message, 'forbidden', 403)
    this.name = 'ForbiddenError'
  }
}

/** 404 — the requested entity does not exist (or is out of tenant scope). */
export class NotFoundError extends ApiError {
  constructor(message = 'Not found') {
    super(message, 'not_found', 404)
    this.name = 'NotFoundError'
  }
}

/** 422 — input failed validation. `fields` optionally maps field → message. */
export class ValidationError extends ApiError {
  readonly fields?: Record<string, string>

  constructor(message = 'Validation failed', fields?: Record<string, string>) {
    super(message, 'validation', 422)
    this.name = 'ValidationError'
    this.fields = fields
  }
}

/**
 * 409 — last-write-wins conflict: the caller's `expectedUpdatedAt` was stale.
 * `currentValue` carries the value the caller should reconcile against.
 */
export class ConflictError extends ApiError {
  readonly currentValue: unknown

  constructor(message = 'The value changed since you loaded it', currentValue?: unknown) {
    super(message, 'conflict', 409)
    this.name = 'ConflictError'
    this.currentValue = currentValue
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}
