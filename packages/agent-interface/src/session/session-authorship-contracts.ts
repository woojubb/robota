/**
 * Whose a record a store that seals read is. `verified`: the owner's unlocked process wrote these
 * exact bytes — they carry an authorship tag that verifies, this store wrote them for a session it
 * vouches for, or the owner adopted them. `unverified`: anything else, which includes everything
 * written while the keys were locked, by an older build, by a subagent, from plaintext, rebuilt from
 * a log, or by another program.
 */
export type TSessionAuthorship = 'verified' | 'unverified';
