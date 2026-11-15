import { classifyError, toUserMessage } from '@/services/user-error'
import { strings } from '@/strings'

/**
 * Where an add-source failure is shown: beside the field it concerns, so the
 * user sees what to fix. Failures that concern no single field stay with the
 * form's action.
 */

export type SourceField = 'url' | 'username' | 'password' | 'file'

/** A failure that already knows which field it concerns. */
export class FieldProblem extends Error {
  constructor(
    readonly field: SourceField,
    message: string
  ) {
    super(message)
    this.name = 'FieldProblem'
  }
}

export interface PlacedError {
  field: SourceField | null
  message: string
}

/**
 * Places a failure: the server or list address for anything that means the
 * address did not answer as expected, the password for a refused sign-in.
 */
export function placeError(
  error: unknown,
  fallback: string,
  { address, password = false }: { address: SourceField; password?: boolean }
): PlacedError {
  if (error instanceof FieldProblem) return { field: error.field, message: error.message }
  switch (classifyError(error)) {
    case 'auth':
      return password
        ? { field: 'password', message: strings.sources.validation.credentialsRefused }
        : { field: address, message: toUserMessage(error, fallback) }
    case 'network':
    case 'timeout':
    case 'certificate':
    case 'http':
    case 'bad-response':
    case 'too-large':
      return { field: address, message: toUserMessage(error, fallback) }
    default:
      return { field: null, message: toUserMessage(error, fallback) }
  }
}
