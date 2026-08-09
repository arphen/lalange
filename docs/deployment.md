# Release deployments

## Release flow

Every push to `main` runs lint, tests, and the production build in the `CI`
workflow. When those checks pass, the workflow:

1. Saves `dist` as a seven-day GitHub Actions artifact.
2. Deploys that artifact to the `arphen-staging` Cloudflare Pages project.
3. Exposes the release candidate at `https://test.arphen.xyz`, with
   `https://arphen-staging.pages.dev` available as a fallback.

Production is never deployed by the automatic workflow. To promote the tested
release, open **GitHub > Actions > Promote release**, select **Run workflow**,
leave the branch set to `main`, and select **Run workflow** again.

The promotion workflow finds the latest successful `CI` run for a push to
`main`, downloads its saved artifact, and deploys those exact files to the
`arphen` Pages project. It does not rebuild the application. Production
promotions are serialized so two releases cannot deploy at the same time.

If another `main` build finishes while a release is being tested, the staging
site and the candidate selected by the promotion button both advance to that
new build. Recheck the staging site before promoting.

## One-time setup

The `arphen-staging` Direct Upload project uses `main` as its production branch.
The custom domain `test.arphen.xyz` is associated with the project through a
proxied CNAME to `arphen-staging.pages.dev`. A newly attached hostname may
temporarily return a 522 response while Cloudflare initializes it.

The repository Actions secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` must remain available. The token needs permission to
deploy to both `arphen-staging` and `arphen`.

For a non-public test environment, put `test.arphen.xyz` behind a Cloudflare
Access application. If it remains public, add a Cloudflare response-header
rule for that hostname that sets `X-Robots-Tag: noindex, nofollow`; the same
build artifact is used in staging and production, so this must be an
environment-level rule rather than a file in `dist`.

## Releasing

1. Merge the release into `main` and wait for `CI` to finish successfully.
2. Test the release at `https://test.arphen.xyz` (or
   `https://arphen-staging.pages.dev` until the custom domain is active),
   including install and update behavior when service-worker changes are
   involved.
3. Run the `Promote release` workflow from `main`.
4. Confirm the commit SHA in the workflow summary, then smoke-test
   `https://arphen.xyz`.

To roll back, revert the unwanted change on `main`, let the revert pass through
staging, and promote that staged artifact through the same workflow.