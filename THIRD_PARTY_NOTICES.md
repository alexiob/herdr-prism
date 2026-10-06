# Third-party notices

Herdr Prism's TypeScript and Rust application code is original and is
licensed under the project [MIT license](LICENSE). Released JavaScript has no
runtime npm dependencies. Node.js, Herdr and Git are separately installed by
the user and are not redistributed in the release directory.

## Native helper

The native helper links Rust standard-library components. Each packaged
native artifact includes `bin/<platform>-<arch>/rust-licenses/` containing the
actual build toolchain's `COPYRIGHT-library.html` and its referenced license
texts. Those upstream notices and terms apply to the corresponding components.
Keep this directory with the helper when redistributing it. The packaging
step requires the matching Rust documentation component during development;
installation never obtains a compiler or license documents from the network.

## Development tools

TypeScript is licensed under Apache-2.0. `@types/node` is licensed under MIT;
its development transitive dependency `undici-types` is MIT. They are installed
through the development lockfile and are not copied into release packages.
Their notices remain in their installed development packages.

## Design precedents

Herdr's official documentation/schema and the projects `flowy11/agent-panel`,
`edxeth/herdr-pi-tree`, and `hhdebb/herdr-radar` informed the architecture and
behavioral fixture scenarios. No application code from these projects was
copied. In particular, no code from the unlicensed inspected agent-panel
revision is included. Links, inspected revisions and licenses observed during
design are recorded in `docs/design/herdr-prism.md` in the source tree.
