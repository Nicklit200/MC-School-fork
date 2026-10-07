-- Align the Grade 8 Realschule (II/III) track with the official LehrplanPLUS source
-- supplied for Mark. Other school tracks stay intact; only REALSCHULE visibility and
-- source-grounded descriptions are adjusted, with missing official competencies added.

WITH cfg AS (
    SELECT
        $src$LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Fachlehrplan: https://www.lehrplanplus.bayern.de/fachlehrplan/realschule/8/mathematik/wpfg2-3#66100$src$::text AS source_text,
        $patch$
        {
          "mc8-1-1": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 3: Terme und Gleichungen.",
            "description": "Упрощает более сложные термы с несколькими переменными и более высокими степенями, собирая подобные слагаемые."
          },
          "mc8-1-2": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 3: Terme und Gleichungen.",
            "description": "Складывает, вычитает и перемножает суммарные термы, корректно раскрывая скобки."
          },
          "mc8-1-3": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 3: Terme und Gleichungen.",
            "description": "Факторизует суммарные термы и выносит общий множитель."
          },
          "mc8-1-4": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 3: Terme und Gleichungen.",
            "description": "Применяет биномиальные формулы при умножении и факторизации суммарных термов."
          },
          "mc8-2-1": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 3: Terme und Gleichungen.",
            "description": "Решает линейные уравнения, в которых слева и справа встречаются термы с переменными, включая произведения сумм и биномиальные формулы."
          },
          "mc8-2-2": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 3: Terme und Gleichungen."
          },
          "mc8-2-3": {
            "schoolTypes": ["GYMNASIUM", "WIRTSCHAFTSSCHULE"]
          },
          "mc8-2-4": {
            "schoolTypes": ["GYMNASIUM"]
          },
          "mc8-2-5": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 3: Terme und Gleichungen.",
            "description": "Составляет и решает линейные уравнения по текстовым и прикладным задачам и проверяет смысл результата."
          },
          "mc8-3-1": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 5: Funktionen.",
            "description": "Распознаёт функциональные зависимости как однозначные соответствия и отличает их от неоднозначных Zuordnungen."
          },
          "mc8-3-2": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 5: Funktionen.",
            "description": "Переходит между Funktionsgleichung/Term, Graph, Wertetabelle и словесным описанием; вычисляет Funktionswerte и Nullstellen и использует Definitions- и Wertemenge."
          },
          "mc8-3-3": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 5: Funktionen.",
            "description": "Понимает линейные функции; в частности распознаёт y = mx как Ursprungsgerade и объясняет значение параметра m."
          },
          "mc8-3-4": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 5: Funktionen.",
            "description": "Строит графики линейных функций, в том числе с помощью Steigungsdreieck."
          },
          "mc8-3-5": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 5: Funktionen.",
            "description": "Определяет Funktionsgleichung линейной функции по заданному графику."
          },
          "mc8-3-6": {
            "schoolTypes": ["GYMNASIUM", "WIRTSCHAFTSSCHULE"]
          },
          "mc8-3-7": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 5: Funktionen.",
            "description": "Находит Nullstellen линейных функций и связывает их с графиком."
          },
          "mc8-3-8": {
            "title": "Перпендикулярные прямые",
            "de": "Orthogonale Geraden",
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 5: Funktionen.",
            "description": "Определяет наклон перпендикулярной прямой, используя связь m1 · m2 = -1."
          },
          "mc8-3-9": {
            "schoolTypes": ["GYMNASIUM", "MITTELSCHULE", "WIRTSCHAFTSSCHULE"]
          },
          "mc8-3-10": {
            "schoolTypes": ["GYMNASIUM", "MITTELSCHULE", "WIRTSCHAFTSSCHULE"]
          },
          "mc8-5-1": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 4: Bruchterme und Bruchgleichungen.",
            "description": "Распознаёт переменную в знаменателе как Bruchterm, объясняет необходимость Definitionsmenge и определяет запрещённые значения."
          },
          "mc8-5-2": {
            "schoolTypes": ["GYMNASIUM"]
          },
          "mc8-5-3": {
            "schoolTypes": ["GYMNASIUM"]
          },
          "mc8-5-4": {
            "schoolTypes": ["GYMNASIUM"]
          },
          "mc8-5-5": {
            "schoolTypes": ["GYMNASIUM"]
          },
          "mc8-7-1": {
            "title": "Условия существования треугольника",
            "de": "Existenz von Dreiecken",
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 1: Dreiecke und Vierecke.",
            "description": "Обосновывает существование треугольника по отношениям между длинами сторон и между длинами сторон и величинами углов."
          },
          "mc8-7-2": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 1: Dreiecke und Vierecke.",
            "description": "Использует Kongruenzsätze, чтобы проверять треугольники на конгруэнтность."
          },
          "mc8-7-3": {
            "title": "Свойства четырёхугольников",
            "de": "Eigenschaften von Vierecken",
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 1: Dreiecke und Vierecke.",
            "description": "Различает Trapez, Drachenviereck, Parallelogramm, Raute, Rechteck и Quadrat по характерным свойствам."
          },
          "mc8-7-4": {
            "schoolTypes": []
          },
          "mc8-8-1": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 2: Raumgeometrie.",
            "description": "Строит Schrägbilder призм и пирамид, учитывая Verzerrungswinkel, Verzerrungsmaßstab и положение Schrägbildachse."
          },
          "mc8-8-2": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 2: Raumgeometrie.",
            "description": "Восстанавливает плоские фигуры из Schrägbild в истинном размере и определяет длины отрезков и величины углов."
          },
          "mc8-8-5": {
            "schoolTypes": []
          },
          "mc8-8-6": {
            "schoolTypes": []
          },
          "mc8-8-7": {
            "schoolTypes": []
          },
          "mc8-9-1": {
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 6: Daten und Zufall.",
            "description": "Корректно использует понятия Ergebnis и Ereignis при описании Zufallsexperimente."
          },
          "mc8-9-2": {
            "title": "Baumdiagramm и Vierfeldertafel",
            "de": "Baumdiagramm und Vierfeldertafel",
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 6: Daten und Zufall.",
            "description": "Представляет возможные результаты Zufallsexperimente с помощью Baumdiagramm и Vierfeldertafel."
          },
          "mc8-9-4": {
            "title": "Абсолютная и относительная частота",
            "de": "Absolute und relative Häufigkeit",
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 6: Daten und Zufall.",
            "description": "Определяет абсолютные и относительные Häufigkeiten событий и использует их, например, для оценки Gewinnchancen."
          }
        }
        $patch$::jsonb AS patches,
        $nodes$
        [
          {
            "id": "mc8-rs-1-2",
            "kind": "skill",
            "title": "Построение треугольников",
            "de": "Dreieckskonstruktionen",
            "description": "Описывает и выполняет построения треугольников циркулем и Geodreieck, а также с помощью динамической геометрии.",
            "example": "Konstruiere ein Dreieck aus den gegebenen Seiten- und Winkelangaben und beschreibe die Schritte.",
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 1: Dreiecke und Vierecke.",
            "color": "blue",
            "x": 2285,
            "y": 610,
            "archived": false,
            "core": false,
            "schoolTypes": ["REALSCHULE"]
          },
          {
            "id": "mc8-rs-1-5",
            "kind": "skill",
            "title": "Построение четырёхугольников",
            "de": "Vierecke konstruieren",
            "description": "Строит Trapez, Drachenviereck, Parallelogramm, Raute, Rechteck и Quadrat и использует их свойства при решении геометрических задач.",
            "example": "Konstruiere ein Parallelogramm aus vorgegebenen Daten und begründe die verwendeten Eigenschaften.",
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 1: Dreiecke und Vierecke.",
            "color": "blue",
            "x": 2285,
            "y": 790,
            "archived": false,
            "core": false,
            "schoolTypes": ["REALSCHULE"]
          },
          {
            "id": "mc8-rs-3-2",
            "kind": "skill",
            "title": "Экстремальные значения квадратных термов",
            "de": "Extremwerte quadratischer Terme",
            "description": "Вычислительно определяет Extremwerte квадратных термов вида ax² + bx + c и решает задачи на экстремум, например с площадями.",
            "example": "Bestimme das Maximum oder Minimum eines quadratischen Terms und deute es in einer Flächenaufgabe.",
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 3: Terme und Gleichungen.",
            "color": "orange",
            "x": 0,
            "y": 1240,
            "archived": false,
            "core": false,
            "schoolTypes": ["REALSCHULE"]
          },
          {
            "id": "mc8-rs-4-2",
            "kind": "skill",
            "title": "Простые дробные уравнения",
            "de": "Einfache Bruchgleichungen / Verhältnisgleichungen",
            "description": "Определяет Definitionsmenge и решает простые Bruchgleichungen (Verhältnisgleichungen), проверяя допустимость решения.",
            "example": "Bestimme zuerst die Definitionsmenge und löse anschließend eine einfache Verhältnisgleichung.",
            "source": "LehrplanPLUS Bayern, Realschule 8 Mathematik (II/III), Lernbereich 4: Bruchterme und Bruchgleichungen.",
            "color": "green",
            "x": 1440,
            "y": 1060,
            "archived": false,
            "core": false,
            "schoolTypes": ["REALSCHULE"]
          }
        ]
        $nodes$::jsonb AS new_nodes,
        $edges$
        [
          {"id": "mc8-rs-edge-1", "source": "mc8-t7", "target": "mc8-rs-1-2", "kind": "contains"},
          {"id": "mc8-rs-edge-2", "source": "mc8-t7", "target": "mc8-rs-1-5", "kind": "contains"},
          {"id": "mc8-rs-edge-3", "source": "mc8-t1", "target": "mc8-rs-3-2", "kind": "contains"},
          {"id": "mc8-rs-edge-4", "source": "mc8-t5", "target": "mc8-rs-4-2", "kind": "contains"},
          {"id": "mc8-rs-pr-1", "source": "mc8-7-1", "target": "mc8-rs-1-2", "kind": "prerequisite"},
          {"id": "mc8-rs-pr-2", "source": "mc8-rs-1-2", "target": "mc8-7-2", "kind": "prerequisite"},
          {"id": "mc8-rs-pr-3", "source": "mc8-7-3", "target": "mc8-rs-1-5", "kind": "prerequisite"},
          {"id": "mc8-rs-pr-4", "source": "mc8-1-1", "target": "mc8-rs-3-2", "kind": "prerequisite"},
          {"id": "mc8-rs-pr-5", "source": "mc8-5-1", "target": "mc8-rs-4-2", "kind": "prerequisite"}
        ]
        $edges$::jsonb AS new_edges
),
next_data AS (
    SELECT
        sb.id,
        jsonb_set(
            jsonb_set(
                jsonb_set(
                    sb.data,
                    '{source}',
                    to_jsonb(
                        (sb.data->>'source') ||
                        ' Realschule 8 (II/III) track aligned to official LehrplanPLUS: ' ||
                        cfg.source_text
                    )
                ),
                '{nodes}',
                (
                    SELECT jsonb_agg(
                        CASE
                            WHEN cfg.patches ? (e.node->>'id')
                                THEN e.node || (cfg.patches -> (e.node->>'id'))
                            ELSE e.node
                        END
                        ORDER BY e.ord
                    )
                    FROM jsonb_array_elements(sb.data->'nodes') WITH ORDINALITY AS e(node, ord)
                ) || cfg.new_nodes
            ),
            '{edges}',
            (sb.data->'edges') || cfg.new_edges
        ) AS data
    FROM skill_boards sb
    CROSS JOIN cfg
    WHERE sb.id = 'grade-8-m8'
)
UPDATE skill_boards sb
SET data = nd.data,
    revision = sb.revision + 1,
    updated_at = now(),
    updated_by = NULL
FROM next_data nd
WHERE sb.id = nd.id;

INSERT INTO skill_board_revisions(board_id, revision, data, updated_at, updated_by)
SELECT id, revision, data, updated_at, updated_by
FROM skill_boards
WHERE id = 'grade-8-m8'
ON CONFLICT (board_id, revision) DO NOTHING;
