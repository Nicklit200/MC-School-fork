# Skills board chat editing

MCP 1.16.0 adds get_skill_board and edit_skill_board at the existing authenticated /api/v1/mcp endpoint. The website, graph model and database schema are unchanged. There are no pupil mastery updates or lesson automation in this change.

Both tools require a current OAuth school user. ADMIN can read/write; TEACHER can read; students, archived users, unauthenticated callers and import-API-key-only callers cannot access the catalog through these actions. Existing MCP actions are unchanged.

Read the board fresh; use its returned revision and stable IDs. edit_skill_board accepts an operationsJson JSON array of add_node, update_node, set_parent, add_edge and remove_edge operations. update_node with archived=true/false archives/restores without deleting history. Edits preserve unspecified properties, unrelated nodes and edges, and board metadata. Validate the entire batch before one revision-checked SkillBoardService.save, which also writes an audit snapshot. On revision conflict, read and reconcile before resubmitting. A no-op does not add a revision. Errors return MCP isError=true and saved=false.

The response contains the updated board and revision; read back to verify. Reload an open website board only after saving/exporting any local draft. Existing website conflict protection still applies to unsaved drafts.

After deployment, the ChatGPT connection must discover and permit the two new tools. A deployed REST/MCP endpoint alone does not prove the tools are available in the current chat. Use the connection's Refresh/update flow and verify an authenticated get_skill_board call before claiming end-to-end readiness.

Tests cover roles, archive/root safety, edits preserving unrelated data, graph cycles, duplicate parents, atomic validation, revision rejection, no-op behavior, and the actual controller JSON-RPC tool listing and calls. Existing skill-board database tests also run in an isolated local PostgreSQL service. No production secrets or student data are used by verification.
