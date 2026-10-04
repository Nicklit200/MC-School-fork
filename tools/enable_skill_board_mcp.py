"""One-time, exact-anchor MCP integration. Does not alter authentication or existing tools."""
from pathlib import Path

path = Path('backend/src/main/java/com/mcschool/flashcard/lessons/MindcraftiMcpController.java')
s = path.read_text()
if 'SkillBoardMcpService.TOOL_NAMES.contains(name)' in s:
    print('Skills MCP is already integrated')
else:
    def replace_once(old, new):
        global s
        if s.count(old) != 1:
            raise SystemExit('Refusing ambiguous controller patch: ' + old[:100])
        s = s.replace(old, new, 1)
    replace_once('import com.mcschool.flashcard.auth.AuthenticatedUser;', 'import com.mcschool.flashcard.skills.SkillBoardMcpService;\nimport org.springframework.beans.factory.annotation.Autowired;\nimport com.mcschool.flashcard.auth.AuthenticatedUser;')
    replace_once('private static final String SERVER_VERSION = "1.15.0";', 'private static final String SERVER_VERSION = "1.16.0";')
    replace_once('    @GetMapping\n', '''    private SkillBoardMcpService skillBoardMcpService;

    @Autowired
    public void setSkillBoardMcpService(SkillBoardMcpService service) {
        this.skillBoardMcpService = service;
    }

    @GetMapping
''')
    replace_once('        if (!authenticated) return tools;', '        if (!authenticated) return tools;\n        tools.addAll(SkillBoardMcpService.definitions());')
    replace_once('        if (!auth.authenticated()) throw new IllegalArgumentException("This Mindcrafti tool requires authentication");', '''        if (!auth.authenticated()) throw new IllegalArgumentException("This Mindcrafti tool requires authentication");
        if (SkillBoardMcpService.TOOL_NAMES.contains(name))
            return skillBoardMcpService.call(name, arguments, auth.user());''')
    guidance = 'For the curriculum skills board, always read get_skill_board fresh before answering from it or using edit_skill_board. Edit only explicitly requested items, using the exact returned revision. Preserve unrelated content and read back after saving. A stale revision means reconcile, not blind retry. This catalog does not contain pupil mastery. '
    replace_once('"Mindcrafti school tools include lessons,', '"' + guidance + 'Mindcrafti school tools include lessons,')
    replace_once('"Mindcrafti lesson, school-prompt, Brand Guide,', '"' + guidance + 'Mindcrafti lesson, school-prompt, Brand Guide,')
    path.write_text(s)
    print('Integrated get_skill_board and edit_skill_board; existing constructor and tools preserved')
