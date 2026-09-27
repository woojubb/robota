// waits for the turn to complete: watches for a "complete" frame after ctx.t0
const start = Date.now();
while (Date.now() - start < 170000) {
  await page.waitForTimeout(1000);
  if (ctx.frames.some(f => f.t > ctx.t0 && /"type":"(complete|error|interrupted|aborted)"/.test(f.d))) break;
}
const done = ctx.frames.find(f => f.t > ctx.t0 && /"type":"(complete|error|interrupted|aborted)"/.test(f.d));
return { elapsedS: done ? (done.t - ctx.t0) / 1000 : null, doneType: done ? /"type":"([a-z_]+)"/.exec(done.d)[1] : 'timeout' };
