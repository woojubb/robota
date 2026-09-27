const cmds = CMDS;
const results = [];
for (const c of cmds) {
  const box = page.getByLabel('message');
  // close any menu
  await box.fill('');
  const mark = ctx.frames.length;
  const sentMark = ctx.sent.length;
  await box.fill(c);
  await page.keyboard.press('Escape'); // close slash menu so Enter submits the literal text
  await box.focus();
  await box.press('Enter');
  await page.waitForTimeout(3500);
  const fr = ctx.frames.slice(mark).map(f => f.d).filter(d => !/execution_workspace_event|"type":"context"|"type":"sessions"|"type":"commands"/.test(d));
  const asks = fr.filter(d => /ask_request/.test(d)).map(d => d.slice(0, 600));
  const results_ = fr.filter(d => /command_result|ui_intent|"type":"error"|not available/.test(d)).map(d => d.slice(0, 700));
  const other = fr.filter(d => !/ask_request|command_result|ui_intent|"type":"error"/.test(d)).map(d => d.slice(0, 160)).slice(0, 6);
  const shot = c.replace(/[^a-z0-9]+/gi, '_');
  await page.screenshot({ path: `${process.env.EVIDENCE ?? '/private/tmp/claude-501/-Users-jungyoun-Documents-dev-woojubb-robota-5/6fbad5fc-64cb-4621-8e62-92858510d96a/scratchpad/evidence'}/cmd${shot}.png` });
  let cancelled = false;
  for (let k = 0; k < 3 && (await page.getByRole('button', { name: 'Cancel' }).count()); k++) {
    await page.getByRole('button', { name: 'Cancel' }).last().click();
    await page.waitForTimeout(700);
    cancelled = true;
  }
  const sent = ctx.sent.slice(sentMark).map(s => s.d.slice(0, 160));
  results.push({ c, sent, asks, results: results_, other, cancelled });
}
return results;
