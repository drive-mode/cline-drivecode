# DEV-02

Brownfield Cline extension. Add an ADR/pre-planning plugin to
`cline-drivecode`. It must be installed project-locally by `hh-template`. The
template source cannot currently be resolved. Existing Cline plugin discovery
uses package manifests and workspace `.cline/plugins`; the repository rejects
remote runtime plugin install as a managed-session trust path. No production
user data is in scope for the initial milestone.

