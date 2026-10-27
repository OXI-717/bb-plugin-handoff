# Handoff to an independent BB server

This is a one-way, user-selected copy of saved conversation events and selected
project attachments. It requires the matching federation plugin with the fixed
`handoff*` RPC contract. The existing same-server handoff path stays separate.

Open Hand off, then **Hand off to an independent BB server**. Select a configured
server/project, a connected machine's ready environment, and a provider/model
reported by that remote environment. Review the source snapshot and choose which
attachments to copy. No attachment is selected by default. The final button copies
the snapshot and starts one remote session; opening the panel reads the saved snapshot and up to 14 stored attachments locally
to resolve their metadata and hashes. Nothing is sent remotely until confirmation.

The destination owns execution and permissions. No remote machine is enrolled in
primary BB. The transfer exports no credentials or native provider session and
creates no callback, parent/lifecycle link or reverse channel. Recorded history
can still contain private data: only transfer a source you intend to share.

## Limits and incomplete operations

- Primary BB → configured remote project only; no remote → primary import.
- Existing ready remote environments only. No checkout creation, working-tree
  patches, whole directory sync or arbitrary local filesystem reads.
- Saved events: at most 4 MiB and 10,000 events, fixed at preview time. A changed
  snapshot is rejected. Provider-hidden state is not recoverable.
- Up to 14 selected attachments, 4 MiB per file and 16 MiB total including the
  snapshot. Supported: text, Markdown, JSON/JSONL, PDF and raster images.
- Only stored project attachments referenced in typed user input positions can
  be selected. URLs, absolute host paths and arbitrary tool output are not read.
- Upload/create calls have no automatic retry. State persists in both plugins.
  An interrupted transfer can leave uploaded files or a created thread remotely.
  Use **Check transfer status** before manually starting another transfer.
- A returned thread ID confirms creation, not model completion or comprehension.
- Federation uses internal client transport hooks. The handoff RPC exception is
  a fixed method list; legacy machine-management RPCs remain unsupported remotely.

No additional agent tools or consumer permissions are enabled by this feature.
`allowWrites` on the selected connection is required; `allowAgentReads` is unchanged.
