# price-collector

A scheduled job that reads publicly listed prices from Turkish fashion and
cosmetics retailers, records what changed, and notifies people who asked to be
told when something they were watching gets cheaper.

It runs every 90 minutes on GitHub Actions.

## Why this repository is public

Purely economics. The job consumes roughly 3,100 Actions minutes a month, and
GitHub bills private repositories past 2,000 while public ones on standard
runners are free. Nothing here is open source in spirit — it is a working
service that happens to cost less in the open.

Two consequences worth stating plainly, so nobody has to rediscover them:

- **The retailers can read this too.** Every endpoint, header and pacing
  decision the collector makes is visible here, which makes it easier to
  block than it was while the code was private. That is a real operational
  risk, accepted deliberately.
- **Obscurity is not a control, and none is attempted.** The repository name
  is plain. Public repositories are broadcast through the GitHub Events API
  within minutes of creation and scanned continuously by bots; a clever name
  would have changed nothing except our ability to find our own code.

## Secrets

**No credential is in this repository, in any commit, at any point in its
history.** Everything is supplied at run time through GitHub Actions Secrets
and reaches the process only as environment variables — see `.env.example` for
the shape of each one, with no values.

The workflow is deliberately narrow, because a public repository means anyone
can open a pull request:

- It triggers on `schedule` and `workflow_dispatch` **only**. There is no
  `pull_request_target` and no `workflow_run` — those are the two triggers that
  hand secrets to code a stranger controls.
- Secrets are not available to workflows run from forks.
- `GITHUB_TOKEN` is read-only (`permissions: contents: read`).

If you are adding a workflow here, keep all three true.

## Running it

```bash
npm ci
cp .env.example .env      # fill in what you have
npm run collect
```

Without `DATABASE_URL` the collector uses an embedded database, so a local run
is safe and touches nothing shared.

## Where the code comes from

This repository is assembled from a private monorepo and is not edited
directly — changes made here are overwritten on the next sync. It carries the
collector's runtime only: the brand adapters, the shared formatting and
classification helpers they depend on, and the workflow. Tests, the API, the
web app and the mobile app stay private.
