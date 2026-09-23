# Vectora third-party provenance review

Review date: 2026-09-19

This is a technical provenance and notice-completeness review, not a legal opinion, patent clearance, or warranty of non-infringement. Distribution decisions and acceptance of the qualifications below should be reviewed by counsel or another authorized legal decision-maker.

## Scope and method

The review covered the locked npm dependency graph, production main/lazy/worker bundles, emitted assets and fonts, source imports, package license files, known code embedded inside bundled dependencies, and the supplemental evidence in `legal/upstream/sources.json`.

The review used these controls:

1. `package-lock.json` is the dependency identity baseline. Its reviewed SHA-256 is `6dd9944afe242f31a6a622728e3a2276abf18d8e77b19d33cb7ae5bb6dbaecec`.
2. `npm run audit:licenses` checks installed package identity against the lock, rejects undeclared source imports and unknown declared licenses, inventories actual bundle inputs, rejects MPL-2.0 runtime inputs, verifies local supplemental notice hashes, and checks generated artifacts for drift.
3. `npm run audit:provenance` retrieves every supplemental upstream source over HTTPS, verifies full-source hashes, and confirms that declared extracts occur verbatim in their pinned sources.
4. The normal production build verifies the lockfile fingerprint in `LEGAL_ATTRIBUTIONS.md` and emits that complete document into the distribution.

## Review result

The technical inventory is reproducible and the collected notice texts are internally consistent with the reviewed lock and bundle inputs. The online provenance audit verified all 12 supplemental upstream entries on 2026-09-19. GitHub-hosted evidence is tag- or commit-pinned where available. Canonical Apache and Unicode sources are content-hash pinned. Simon Tatham's canonical origin is recorded alongside a content-hash-pinned immutable Debian source snapshot containing the notice verbatim.

No declared GPL or AGPL dependency and no mandatory paid commercial license was identified in the reviewed runtime inputs. This statement is limited to the reviewed evidence and is not a legal conclusion about every possible source-code lineage.

The proposed MIT/Apache/BSD/ISC-only policy is **not satisfied**. Reviewed inputs also include:

- Boost Software License 1.0 for Clipper2 and a Geometric Tools-derived method;
- SIL Open Font License 1.1 for bundled Inter, JetBrains Mono, and Lora font files;
- Unlicense and 0BSD components;
- a custom permissive LTC-shading license that requires the cited paper reference to be retained; and
- MPL-2.0 packages in build tooling. The audit did not find those MPL implementations in the emitted runtime graph.

These licenses are not described here as incompatible with commercial distribution. They are exceptions to the stated allow-list and require an explicit policy decision.

## Distribution controls

- Ship `LEGAL_ATTRIBUTIONS.md` intact with every production distribution.
- Preserve the LTC paper citation, OFL license and Reserved Font Name information, Apache notices, Unicode/Apple mapping notices, and all embedded-component notices.
- Re-run both audits after any dependency, lockfile, font, asset, source-import, or bundler change.
- Do not treat npm package metadata as controlling for font binaries; the embedded font metadata and corresponding font license govern the reviewed files.
- Do not represent this inventory as granting a license to Vectora's own source code.

## Open provenance qualifications

1. Three's `Triangle.closestPointToPoint` comment credits a method from *Real-Time Collision Detection* and refers to an “accompanying license”. That separate grant was not located. Three distributes the implementation under its MIT license, but the upstream reference remains a qualification for legal review.
2. The merge-sort implementation referenced by Clipper2 includes an Angus Johnson public-domain notice and says it was adapted from Rama Hoetzlein. The complete upstream authorship chain was not independently established.
3. Several embedded implementations identify an upstream project but not an exact vendored revision: the Microsoft generator helper, robust predicates, Apple/Unicode mapping data, gl-matrix, Paper.js, Geometric Tools, and LTC shading. The enclosing package version is reproducible; supplemental notice versions must not be presented as proof of the embedded revision.
4. The Lora repository notice is content- and commit-pinned, and the shipped font reports OFL-1.1 with Reserved Font Name “Lora”. The audit does not establish that the repository commit is the exact source revision used to build the historical packaged font binary.
5. The canonical Unicode license is not hosted at an immutable version URL. Its retrieved bytes are hash-pinned and the audit fails if they change. Simon Tatham's canonical source is also mutable and intermittently unavailable, so the manifest records it as the origin while verifying an immutable Debian snapshot of the same notice.
6. The review did not perform a comprehensive code-similarity search, copyright-title investigation, export-control review, trademark clearance, or patent analysis.

## Decision required

Before public or commercial distribution, an authorized reviewer should explicitly accept the non-allow-list licenses and the open qualifications above, or remove/replace the affected functionality and regenerate the inventory. The technical audit alone cannot make that decision.
