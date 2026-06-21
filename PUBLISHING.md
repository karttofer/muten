# Publishing `@karttofer/muten`

`@karttofer/muten` is published to **GitHub Packages** (the npm registry hosted on GitHub), not the
public npm registry.

## One-time setup

Create a GitHub Personal Access Token (classic) with `write:packages` and `read:packages` — plus
`repo` while the repository is private. Add it to your **global** `~/.npmrc` (never commit a token):

```
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
```

The package name is scoped to your account (`@karttofer/…`) and `publishConfig.registry` already
points at `https://npm.pkg.github.com`, so no per-command flags are needed.

## Publish

```sh
npm publish
```

`prepare` builds `dist/` first, and `files` ships `dist` + `spec` + `README` + `LICENSE`. After it
succeeds the package shows up under **Packages** on the repo page. Bump `version` in `package.json`
before each release — a registry refuses to overwrite an existing version.

## Installing it (consumers)

GitHub Packages requires auth even to read. In the consuming project (or your `~/.npmrc`):

```
@karttofer:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT   # read:packages
```

```sh
npm install @karttofer/muten
```

An app created with `@karttofer/create-muten` already ships the registry line in its `.npmrc`; only
the token (in your `~/.npmrc`) is still required.
