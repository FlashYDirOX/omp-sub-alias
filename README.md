# omp-sub-alias

Subscription provider aliases for Oh My Pi / OMP.

`omp-sub-alias` is an independent community extension. It is not an official
Oh My Pi project.

The first supported source provider is OMP's built-in `openai-codex`. An alias
such as `openai-codex-pro` is registered as a real OMP provider with its own
OAuth provider id, so OMP stores, refreshes, resolves, and removes its
credentials independently from `openai-codex`.

## Why this exists

One OMP process can keep several ChatGPT/Codex subscription accounts available
without named profiles, credential snapshots, rotation, a proxy, or an external
account switcher:

```text
/login openai-codex
/login openai-codex-pro

/model openai-codex/<model>
/model openai-codex-pro/<model>
```

The provider namespace is the isolation boundary:

```text
openai-codex      -> credential namespace A
openai-codex-pro  -> credential namespace B
openai-codex-work -> credential namespace C
```

## How it works

The extension owns aliases and OAuth wiring. **OMP owns model loading.**

Each alias registers only:

- `baseUrl`/`api` for the Codex responses protocol;
- the `openai-codex` OAuth login, refresh, and key resolution;
- a `fetchDynamicModels` callback.

No model list, catalog, or per-model seed is registered or bundled. When OMP
refreshes runtime providers it calls `fetchDynamicModels`, which uses the host's
own Codex discovery (`@oh-my-pi/pi-catalog/discovery/codex`) and model builder
(`@oh-my-pi/pi-catalog/build`). The resulting rows are cached by OMP in its
SQLite model cache and resolved exactly like built-in provider rows.

Consequences:

- The alias roster is whatever OMP can discover for that alias credential.
  The extension cannot invent models, copy another provider's rows, or override
  host metadata.
- Context/output metadata, cache policy, pricing rules, and provider quirks are
  the host catalog's.
- `@oh-my-pi/*` imports are resolved from the running OMP host; the shipped
  `dist/index.js` contains no catalog data.

## Requirements

- OMP with the extension provider API, host-remapped `@oh-my-pi/pi-catalog`
  modules, and runtime provider discovery.
- Tested pair: OMP `18.22.2` with `@oh-my-pi/pi-catalog` `18.22.2`.
- Unlisted host versions are not blocked. The extension checks the APIs it uses
  at load and reports a normal extension-load error when one is missing.

## Installation

### GitHub

```bash
omp install github:FlashYDirOX/omp-sub-alias
```

Pin a ref:

```bash
omp install github:FlashYDirOX/omp-sub-alias#REF
```

A full GitHub URL is also accepted. The package manifest points OMP at the
committed `dist/index.js`; GitHub installs do not need a build lifecycle hook.

### Local development

Synchronize the development dependency graph with the active OMP host, build,
then link the checkout:

```bash
bun run sync-host
bun run build
omp plugin link /absolute/path/to/omp-sub-alias
```

## Usage

```bash
omp
/login openai-codex
/login openai-codex-pro
/model openai-codex-pro/gpt-6.2-sol
```

`/model` lists whatever the host discovered for that alias. Model ids are the
host's ids; display names keep the alias label (for example,
`GPT-6.2 Sol (Codex Pro)`) so accounts remain distinguishable.

### Device-code companions

Every alias also registers `<alias-id>-device`, for example
`openai-codex-pro-device`. It uses the same OAuth implementation through the
device-code flow and stores credentials under the main alias id. It is a login
entry point only and registers no models:

```bash
/login openai-codex-pro-device
```

## Configuration

Aliases are read at extension load from, in order:

1. `~/.omp/agent/omp-sub-alias.json`
2. `<cwd>/.omp/omp-sub-alias.json`

Later definitions with the same provider id win.

```json
{
  "aliases": [
    { "provider": "openai-codex", "slug": "pro", "label": "Codex Pro" },
    { "provider": "openai-codex", "slug": "work" }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `provider` | yes | Source provider; currently only `openai-codex` |
| `slug` | yes | Lowercase `[a-z0-9-]` suffix; provider id becomes `openai-codex-<slug>` |
| `label` | no | Display label; defaults to the slug |

Slugs `device` and `*-device` are reserved for login companions.

## Model loading, cache, and the first launch

OMP resolves a session's model before it starts. At that point it reads the
runtime provider's **cached** models (offline) and starts online discovery in
the background.

- With a warm cache the alias roster is available immediately.
- A first launch after upgrading or after adding an alias may still see a
  stale or empty alias cache. If `modelRoles.default` names a newly discovered
  model, OMP can print
  `Warning: Default model <provider>/<model> not found` once and fall back.
- OMP refetches a runtime provider at most once per discovery-cache TTL. To
  force the alias roster immediately (for example right after upgrading from
  0.1.x), run:

```bash
omp models refresh
omp models openai-codex-pro
```

  `omp models refresh` performs online discovery now and writes the cache; the
  second command shows the refreshed roster. Waiting for the TTL works too:
  the first launch after expiry still reads the old cache, its background
  discovery writes the new roster, and the following launch resolves it.

Discovery failures are raised by the extension, so OMP reports its
`model discovery failed` warning and retries on its normal schedule. The
extension does not fabricate a fallback roster.

## Security

- OAuth tokens and refresh state are owned and persisted by OMP under the alias
  provider ids.
- Device companions persist under the main alias id, never under the companion
  id.
- The extension never reads credential files directly, never logs tokens, and
  ships no secrets or model catalog data.
- Removing an alias credential in OMP does not affect the stock
  `openai-codex` credential, and vice versa.

## Migration: 0.1.x to 0.2.0

`0.2.0` removes the extension-side model seed.

- The extension no longer bundles `@oh-my-pi/pi-catalog` and no longer registers
  static models. The host discovers and builds every alias model row.
- Existing alias configuration and stored credentials keep working.
- Model metadata now follows the host catalog. Local
  `openai-codex-pro.modelOverrides` entries in `models.yml` are redundant and
  can be deleted.
- Expect at most one stale-cache warning on the first launch after upgrading;
  warm the cache as described above.
- Hosts that cannot remap `@oh-my-pi/pi-catalog` for extensions are not
  supported by this release.

## Tested host

| OMP host | Bundled host catalog | Status |
| --- | --- | --- |
| 18.22.2 | 18.22.2 | verified: alias OAuth, discovery, and model resolution |

This table records what was verified, not an allow-list.

## Development and verification

```bash
bun run sync-host   # align dev dependencies with the active OMP host
bun run typecheck
bun test
bun run build       # regenerates dist/index.js
bun run smoke-host  # skips without a usable host/plugin install
bun run verify      # typecheck + test + build + smoke + pack dry-run
```

`dist/index.js` is committed for GitHub installs. CI rebuilds it and fails if
the committed file differs. The runtime bundle must keep the host packages
external; the build fails if catalog sources are bundled.

## License

MIT. See [LICENSE](LICENSE).
