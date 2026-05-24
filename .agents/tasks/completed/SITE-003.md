# SITE-003 Tasks

## TC-01: CNAME contains docs.robota.io

- [ ] Verify apps/docs/public/CNAME contains docs.robota.io (already done)

## TC-02: vercel.json redirect uses $1 capture group

- [ ] Fix /compare/(.\*) destination to https://www.robota.io/compare/$1
- [ ] Fix /showcase/(.\*) destination to https://www.robota.io/showcase/$1
- [ ] Fix /enterprise/(.\*) destination to https://www.robota.io/enterprise/$1

## TC-03: pnpm --filter robota-docs build passes

- [ ] Run build and verify exit code 0
