# Publishing to npm

The monorepo publishes three public packages:

* `@airspec/airmark-engine`
* `@airspec/airmark-svg`
* `@airspec/airmark-react`

## Initial publication

The npm organization `airspec` must exist and the publishing account must be an Owner or Developer in that organization.

From a clean `main` checkout:

```bash
npm ci
npm test
npm run goldens:check
npm pack --dry-run --workspace=@airspec/airmark-engine
npm pack --dry-run --workspace=@airspec/airmark-svg
npm pack --dry-run --workspace=@airspec/airmark-react

npm publish --workspace=@airspec/airmark-engine --access public
npm publish --workspace=@airspec/airmark-svg --access public
npm publish --workspace=@airspec/airmark-react --access public
```

The engine is published first because both adapters depend on its exact version. npm publishing requires account 2FA or an appropriately restricted granular token.

## Trusted publishing

After the first release creates each package on npm, configure a trusted publisher for each package in npm package settings:

```text
Provider:        GitHub Actions
Organization:    bzalk
Repository:      airmark-engine
Workflow:        publish.yml
Environment:     (none)
Allowed action:  npm publish
```

The workflow uses npm's short-lived OIDC credentials, publishes provenance automatically, and requires no long-lived npm token in GitHub.

## Subsequent releases

1. Update the root and all workspace versions together.
2. Update the adapter dependencies to the same engine version.
3. Run the complete test and pack checks.
4. Commit the release and create a GitHub release tagged `v<version>`.
5. The `Publish npm packages` workflow publishes engine, SVG, then React.

Published npm name/version pairs are immutable. Never reuse a version, and never create the GitHub release until its exact tarballs have been reviewed.
