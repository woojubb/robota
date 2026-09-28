// #3282 §3: a child that dies before readiness with a real reason on stderr — stands in for
// `ensureConfig` throwing (e.g. "No provider configuration found.") before it ever reaches the
// readiness handshake, and for any other early crash. No handshake message is ever sent, so the
// launcher's generic exit/disconnect path is what has to report this, not the structured one.
process.stderr.write('No provider configuration found. Configure a provider before starting a session.\n');
process.exitCode = 1;
