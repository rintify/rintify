# Profile aggregation credentials

The scheduled workflow requires two independent repository Actions secrets:

| Secret | Purpose |
| --- | --- |
| `PROFILE_STATS_READ_TOKEN` | Dedicated fine-grained PAT with Contents, Issues, Pull requests and Metadata **read-only** permissions. No write, workflow, organization or account permissions are required. |
| `PROFILE_CACHE_KEY` | Independently generated cryptographically random 32-byte key, encoded as 64 hexadecimal characters. Never derive it from an API token. |

Do not reuse a CLI token. The old `PROFILE_STATS_TOKEN` secret is no longer used and should be removed. Never paste credentials into an issue, README, commit, workflow log or chat.

Choose the token resource owner and repository access deliberately. The current setup targets repositories owned by `rintify`, including private repositories, plus readable public repositories elsewhere. Fine-grained PATs have a single resource owner: private repositories owned by other organizations need separately authorized credentials or a GitHub App design. Do not silently assume they are included. Rotate the token before its configured expiration; failed authentication preserves the last published README.

Only `main` can run aggregation or publication. Aggregation has a read-only `GITHUB_TOKEN` and does not persist checkout credentials. A separate publisher receives only the aggregate README and has write access only to this profile repository. Third-party actions are pinned to full commit SHAs.

The `profile-aggregates-v2-` cache contains AES-256-GCM authenticated ciphertext only. Its plaintext contains repository IDs, commit SHAs and language change totals, but no source, filenames or directory structure. Treat Actions caches as publicly retrievable, even though their contents are encrypted here. The encryption key remains in Actions Secrets. Corrupt or mismatched caches stop the run instead of triggering repeated full API scans; delete obsolete caches and retry to rebuild them.

Changing the API token does not require changing the independent cache key. If credentials are suspected compromised, revoke the affected credential, replace it, and delete affected caches. Pre-v2 caches used API-token-derived keys and are never restored by this workflow; remove them if any exist. Losing the cache key requires rebuilding the cache. No workflow falls back to the former broad token or plaintext caching.
