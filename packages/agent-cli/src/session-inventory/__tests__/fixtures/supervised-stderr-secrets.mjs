// #3282 §3: a child that dies with an ANSI-colored line carrying two secrets before its readiness
// handshake — an exact value from ITS OWN env (what a real child could echo back verbatim, e.g. into
// a connection-error message) and a Bearer token it never got from this process's env (what a real
// child could see over the wire — a vendor's own error body). The reported stderr tail must show
// neither the escape codes nor either secret, while the surrounding benign text survives.
process.stderr.write(
  `\x1b[31mFATAL\x1b[0m: connection using key ${process.env.SUPERVISED_TEST_API_KEY} failed ` +
    'with header Authorization: Bearer sk-live-should-not-leak-1234567890\n',
);
process.exitCode = 1;
