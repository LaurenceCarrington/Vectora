## Embedded components and font license corrections

These entries supplement npm metadata. “Embedded” means code already inside a published dependency, not a separate npm import. Where an exact vendored version is not identified by upstream, the enclosing package version is the reproducible identifier; a supplemental notice version does not establish the source revision of that code.

| Component | Bundled version / enclosing package | Terms and evidence |
| --- | --- | --- |
| Splaytree | **3.1.2**, inside polygon-clipping 0.15.7 UMD | MIT; explicit version banner. Separately locked 3.2.3 is not the version of this embedded copy. Both notices are retained. |
| Microsoft generator helper | Embedded in polygon-clipping 0.15.7 UMD; helper version unspecified | Apache-2.0 per embedded header; distinct from separately locked tslib 2.8.1 (0BSD). Copyright (c) Microsoft Corporation. All rights reserved. |
| Robust predicates | Embedded in polygon-clipping 0.15.7 UMD; embedded version unspecified | Upstream robust-predicates Unlicense; locked package 3.0.3 is inventoried separately and does not establish the embedded revision. |
| Clipper2 | clipper2-ts 2.0.1-18 | Boost Software License 1.0. Copyright Angus Johnson 2010–2025; Minkowski file header: 2010–2024. |
| Shewchuk predicates | Clipper2 predicate helpers; upstream C reference dated May 18, 1996 | Jonathan Richard Shewchuk's predicate **code** is explicitly public domain at https://www.cs.cmu.edu/~quake/robust.html. This does not apply to the separately licensed Triangle product. |
| Merge-sort reference | Clipper2 Engine.ts / Engine.js | Angus Johnson's linked answer https://stackoverflow.com/a/46319131 has an explicit “Angus Johnson 2017 / License: Public Domain” code header. The enclosing Clipper2 code carries Boost. The post also mentions adaptation from Rama Hoetzlein; full upstream chain of authorship has not been independently established. |
| tiny-inflate | 1.0.3, embedded in opentype.js 2.0.0 | MIT, Copyright (c) 2015-present Devon Govett. Port of Joergen Ibsen's tinf; supplemental zlib notice included, without claiming Vectora authored either implementation. |
| Apple/Unicode character maps | Embedded in opentype.js 2.0.0 | GAELIC.TXT and INUIT.TXT mapping URLs appear in the bundle input; Unicode data permission notice and Apple disclaimer retained below. Exact historical map revision not identified by OpenType.js. |
| Earcut | 3.0.2, embedded in three 0.186.0 | ISC, Copyright (c) 2024 Mapbox. |
| Linked-list merge sort | Earcut within three 0.186.0 | Simon Tatham 2001 MIT permission notice, from the implementation referenced by Earcut. |
| gl-matrix | Matrix4 implementation reference in three 0.186.0; vendored revision unspecified | MIT; supplemental upstream v2.8.1 notice retained. |
| Paper.js | ShapePath methods in three 0.186.0; vendored revision unspecified | MIT; supplemental upstream v0.12.18 notice retained. Included conservatively for the bundled Three core input. |
| Geometric Tools | Ray.distanceSqToSegment in three 0.186.0; vendored revision unspecified | Boost; referenced upstream file version 3.0.1 (2018/10/05), David Eberly, copyright 1998–2018. |
| LTC shading | Shader chunks in three 0.186.0; vendored revision unspecified | Custom permissive BSD-style terms **with a paper-citation condition**, not plain BSD-3-Clause. Full grant below. Reference: Eric Heitz, Jonathan Dupuy, Stephen Hill and David Neubelt, *Real-Time Polygonal-Light Shading with Linearly Transformed Cosines*, ACM TOG 35(4), 2016; https://eheitzresearch.wordpress.com/415-2/. |
| Real-Time Collision Detection method | Triangle.closestPointToPoint in three 0.186.0 | Upstream comment credits Christer Ericson, Morgan Kaufmann, (c) 2005 Elsevier, chapter 5.1.5, “under the accompanying license”. Three is distributed as MIT; that separate accompanying grant was not available for verification in this audit. This remains an upstream provenance qualification. |
| Lora font | typeface-lora 1.1.13; font Version 3.000 | **OFL-1.1**, Reserved Font Name “Lora”; npm's MIT label is packaging metadata. |
| Roboto font | typeface-roboto 1.1.13; font Version 2.137; 2017 | **Apache-2.0**, Copyright 2011 Google Inc. All Rights Reserved. |
| Roboto Mono font | typeface-roboto-mono 1.1.13; font Version 3.000 | **Apache-2.0**, Copyright 2015 The Roboto Mono Project Authors (https://github.com/googlefonts/robotomono). The bundled historical font's license URL controls this inventory, not a newer font release's license. |
| Feather-derived icons | lucide-react 1.43.0 | ISC Lucide grant plus MIT Feather grant, Copyright (c) 2013-present Cole Bemis; the full installed dual notice follows. No paid-license requirement. |
| Generated browser helpers / CSS | Vite 8.2.2, Rolldown 1.2.7, Tailwind CSS 4.3.3 | MIT notices retained for emitted preload/runtime helpers and stylesheet output, despite the packages being development dependencies. |

### Apple character-mapping notice

The following is the standard header notice from the referenced GAELIC.TXT and INUIT.TXT files at https://www.unicode.org/Public/MAPPINGS/VENDORS/APPLE/ (the current Unicode permission text is retained below):

```text
Apple, the Apple logo, and Macintosh are trademarks of Apple
Computer, Inc., registered in the United States and other countries.
Unicode is a trademark of Unicode Inc. For the sake of brevity,
throughout this document, "Macintosh" can be used to refer to
Macintosh computers and "Unicode" can be used to refer to the
Unicode standard.

Apple Computer, Inc. ("Apple") makes no warranty or representation,
either express or implied, with respect to this document and the
included data, its quality, accuracy, or fitness for a particular
purpose. In no event will Apple be liable for direct, indirect,
special, incidental, or consequential damages resulting from any
defect or inaccuracy in this document or the included data.
```
