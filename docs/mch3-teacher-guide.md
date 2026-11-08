# Teacher handbook in MCH3

`get_teacher_guide` supplies versioned, read-only product documentation to authenticated active teachers and administrators. It does not retrieve student records, generate an AI answer, or mutate any school state. Anonymous callers, students, parents and legacy import API keys cannot discover or invoke it. Current account access is rechecked on every call.

Usage:

- `{}` returns the complete topic index.
- `{"query":"Как дать каждой ученице отдельное задание?"}` returns up to three relevant full articles and additional topic references.
- `{"topicId":"personal-materials"}` reads one full article.

Queries are limited to 300 characters. Search uses bounded lexical matching with Russian, German and English keywords; it is not semantic AI search and does not guarantee a match for every paraphrase. No match returns the index and `found=false`. The assistant should clarify or read an appropriate topic, not invent an answer. The initialization instructions tell the assistant to fetch help for platform questions and distinguish instructions from authorization to perform an action.

The canonical handbook is `backend/src/main/resources/mcp/teacher-guide.json`. Each article has a stable ID, title, summary, keywords, interface route, instructions, related topics and repository evidence paths. It ships atomically with the backend. The response identifies the version, review date and release checked. These are documentation provenance, not proof that a specific room is healthy or has a particular file.

Maintenance: when changing teacher-facing behavior, review the affected articles, verify button labels and access boundaries in code, update the review metadata and add query regressions. Do not document an unmerged feature as released. This edition describes production PR 162 plus the bundled automatic format selection and 2D/3D constructor; deploy the handbook atomically with that implementation. School policies on duration, pricing, consent and assessment must come from the owner, not be inferred from product functionality.

Verification includes topic coverage, real source paths, search examples in three languages, no-match behavior, bounded inputs and current OAuth access. The MCP website-functions CI runs the tests for both code and handbook-only changes. After an approved deployment, reconnect/refresh MCH3 if the client caches its tool catalog, then test index, topic lookup and realistic teacher questions. No production release is authorized merely by editing this handbook.
