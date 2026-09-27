const n0 = ctx.promptMark ?? 0;
for (let i = 0; i < 150; i++) {
  await page.waitForTimeout(1000);
  const nf = ctx.frames.slice(n0);
  const pr = nf.find(f => /permission_request|"type":"ask/.test(f.d));
  if (pr) { ctx.promptMark = ctx.frames.length; await page.waitForTimeout(700); return { prompt: pr.d.slice(0, 700) }; }
  const done = nf.find(f => /"type":"(complete|error)"/.test(f.d));
  if (done) { ctx.promptMark = ctx.frames.length; return { done: done.d.slice(0, 200) }; }
}
return 'timeout';
