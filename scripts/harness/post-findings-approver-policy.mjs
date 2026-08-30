const POST_FINDINGS_MAINTAINER_LOGINS = new Set(['woojubb']);

export function isPostFindingsMaintainer(identity) {
  const { login, association } = identity ?? {};
  return (
    typeof login === 'string' &&
    association === 'OWNER' &&
    POST_FINDINGS_MAINTAINER_LOGINS.has(login.toLowerCase())
  );
}
