/**
 * Skills Manager settings surface, node half. The empty apply exists so the
 * plugin appears in the host cordis.yml / Loader; the browser half owns the
 * section and all of its interactions through exports["./client"], discovered
 * from the package.json dsh.client declaration. All skill state is owned by
 * the skill-manager service host-side; this package registers no namespace of
 * its own.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
