export type Role = 'OWNER' | 'ADMIN' | 'STAFF'

export const ROLE_RANK: Record<Role, number> = {
  STAFF: 1,
  ADMIN: 2,
  OWNER: 3,
}

export function hasRole(actual: Role, minimum: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[minimum]
}

/** Where a user lands after signing in. STAFF has access to nothing else. */
export function landingPathFor(role: Role): string {
  return role === 'STAFF' ? '/admin/checkin' : '/admin'
}
