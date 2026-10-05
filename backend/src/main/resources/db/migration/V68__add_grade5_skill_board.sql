-- Grade 5 curriculum board: shared Mindcrafti core plus school-specific extensions.
-- Sources: LehrplanPLUS Bayern, Mathematik 5 (Gymnasium, Realschule, Mittelschule), reviewed 2026-10-05.
INSERT INTO skill_boards(id, data) VALUES ('grade-5', $seed$
{
  "schemaVersion": 1,
  "title": "Математика — навыки к концу 5 класса",
  "grade": 5,
  "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
  "nodes": [
    {
      "id": "grade5",
      "kind": "root",
      "title": "Математика — 5 класс",
      "de": "Mathematik · Klasse 5",
      "description": "Общее математическое ядро 5 класса и расширения по школьным траекториям. Сначала закрываем CORE, затем углубляемся по типу школы.",
      "example": "",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "orange",
      "x": 850,
      "y": 0,
      "archived": false,
      "core": null,
      "schoolTypes": null
    },
    {
      "id": "g5-topic-1",
      "kind": "topic",
      "title": "Числа и вычисления",
      "de": "Natürliche Zahlen & Rechnen",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "orange",
      "x": 0,
      "y": 260,
      "archived": false,
      "core": null,
      "schoolTypes": null
    },
    {
      "id": "g5-topic-2",
      "kind": "topic",
      "title": "Целые числа",
      "de": "Ganze Zahlen",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "teal",
      "x": 340,
      "y": 260,
      "archived": false,
      "core": null,
      "schoolTypes": null
    },
    {
      "id": "g5-topic-3",
      "kind": "topic",
      "title": "Выражения, уравнения и комбинаторика",
      "de": "Terme, Gleichungen & Kombinatorik",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "violet",
      "x": 680,
      "y": 260,
      "archived": false,
      "core": null,
      "schoolTypes": null
    },
    {
      "id": "g5-topic-4",
      "kind": "topic",
      "title": "Основы геометрии",
      "de": "Geometrische Grundlagen",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "blue",
      "x": 1020,
      "y": 260,
      "archived": false,
      "core": null,
      "schoolTypes": null
    },
    {
      "id": "g5-topic-5",
      "kind": "topic",
      "title": "Величины, периметр и площадь",
      "de": "Größen, Umfang & Flächeninhalt",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "green",
      "x": 1360,
      "y": 260,
      "archived": false,
      "core": null,
      "schoolTypes": null
    },
    {
      "id": "g5-topic-6",
      "kind": "topic",
      "title": "Данные и диаграммы",
      "de": "Daten & Diagramme",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "teal",
      "x": 1700,
      "y": 260,
      "archived": false,
      "core": null,
      "schoolTypes": null
    },
    {
      "id": "g5-1-1",
      "kind": "skill",
      "title": "Разряды и большие числа",
      "de": "Stellenwert & große Zahlen",
      "description": "Читает, записывает и раскладывает большие натуральные числа по разрядам.",
      "example": "Запиши 4 070 305 в виде суммы разрядных слагаемых.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "orange",
      "x": -160,
      "y": 520,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-1-2",
      "kind": "skill",
      "title": "Сравнение и числовая прямая",
      "de": "Ordnen & Zahlenstrahl",
      "description": "Сравнивает натуральные числа и отмечает их на числовой прямой с подходящим масштабом.",
      "example": "Расположи 125 000, 98 500 и 130 200 по возрастанию.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "orange",
      "x": 160,
      "y": 520,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-1-3",
      "kind": "skill",
      "title": "Округление и прикидка",
      "de": "Runden & Überschlagen",
      "description": "Округляет натуральные числа и оценивает разумность результата.",
      "example": "Округли 487 621 до десятков тысяч и оцени 198·51.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "orange",
      "x": -160,
      "y": 720,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-1-4",
      "kind": "skill",
      "title": "Сложение и вычитание",
      "de": "Addition & Subtraktion",
      "description": "Уверенно выполняет устные и письменные сложение и вычитание натуральных чисел.",
      "example": "705 304 − 287 956.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "orange",
      "x": 160,
      "y": 720,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-1-5",
      "kind": "skill",
      "title": "Умножение и деление",
      "de": "Multiplikation & Division",
      "description": "Уверенно выполняет умножение и деление натуральных чисел и проверяет ответ обратным действием.",
      "example": "4 368 : 24.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "orange",
      "x": -160,
      "y": 920,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-1-6",
      "kind": "skill",
      "title": "Порядок действий и законы",
      "de": "Rechenregeln & Rechengesetze",
      "description": "Применяет скобки, правило Punkt vor Strich и удобные законы вычислений.",
      "example": "48 − 3·(7+5).",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "orange",
      "x": 160,
      "y": 920,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-1-7",
      "kind": "skill",
      "title": "Степени и степени десяти",
      "de": "Potenzen & Zehnerpotenzen",
      "description": "Понимает степень как повторное умножение и использует степени десяти для больших чисел.",
      "example": "Вычисли 2⁵ и запиши 1 000 000 как степень 10.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "orange",
      "x": -160,
      "y": 1120,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE"
      ]
    },
    {
      "id": "g5-1-8",
      "kind": "skill",
      "title": "Делимость и простые множители",
      "de": "Teilbarkeit & Primfaktorzerlegung",
      "description": "Использует признаки делимости, разложение на простые множители; для соответствующих школьных траекторий находит ggT и kgV.",
      "example": "Разложи 84 на простые множители; найди ggT(18,24).",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "orange",
      "x": 160,
      "y": 1120,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE"
      ]
    },
    {
      "id": "g5-1-9",
      "kind": "skill",
      "title": "Другие системы счисления",
      "de": "Andere Zahlensysteme",
      "description": "Сравнивает десятичную запись с римской или двоичной и переводит простые примеры.",
      "example": "Запиши 29 римскими цифрами.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "orange",
      "x": -160,
      "y": 1320,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE"
      ]
    },
    {
      "id": "g5-2-1",
      "kind": "skill",
      "title": "Отрицательные числа в ситуациях",
      "de": "Negative Zahlen im Alltag",
      "description": "Связывает отрицательные числа с температурой, высотой, долгом и другими реальными ситуациями.",
      "example": "Что означает −7 °C и −20 m относительно уровня моря?",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "teal",
      "x": 180,
      "y": 520,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-2-2",
      "kind": "skill",
      "title": "Сравнение целых чисел",
      "de": "Ganze Zahlen ordnen",
      "description": "Читает и сравнивает положительные и отрицательные целые числа на числовой прямой.",
      "example": "Упорядочи −9, −2, 0, 4.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "teal",
      "x": 500,
      "y": 520,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-2-3",
      "kind": "skill",
      "title": "Модуль и противоположное число",
      "de": "Betrag & Gegenzahl",
      "description": "Находит модуль и противоположное число и использует эти понятия при сравнении.",
      "example": "Найди |−8| и Gegenzahl к −8.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "teal",
      "x": 180,
      "y": 720,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE"
      ]
    },
    {
      "id": "g5-2-4",
      "kind": "skill",
      "title": "Сложение и вычитание целых",
      "de": "Ganze Zahlen addieren & subtrahieren",
      "description": "Выполняет сложение и вычитание целых чисел, различая знак числа и знак действия.",
      "example": "−12 + 7; 5 − (−3).",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "teal",
      "x": 500,
      "y": 720,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE"
      ]
    },
    {
      "id": "g5-2-5",
      "kind": "skill",
      "title": "Умножение и деление целых",
      "de": "Ganze Zahlen multiplizieren & dividieren",
      "description": "Применяет правила знаков при умножении и делении целых чисел.",
      "example": "(−6)·(−4); 28:(−7).",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "teal",
      "x": 180,
      "y": 920,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE"
      ]
    },
    {
      "id": "g5-2-6",
      "kind": "skill",
      "title": "Смешанные действия с целыми",
      "de": "Rechnen mit ganzen Zahlen",
      "description": "Решает выражения с несколькими действиями и скобками в множестве целых чисел.",
      "example": "−3·(5−9)−7.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "teal",
      "x": 500,
      "y": 920,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE"
      ]
    },
    {
      "id": "g5-3-1",
      "kind": "skill",
      "title": "Числовые выражения и структура",
      "de": "Zahlterme & Termstruktur",
      "description": "Читает структуру выражения, использует математические термины и вычисляет значение по правилам.",
      "example": "Назови последнюю операцию в 48−3·(7+5).",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "violet",
      "x": 520,
      "y": 520,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-3-2",
      "kind": "skill",
      "title": "Простые уравнения",
      "de": "Einfache Gleichungen",
      "description": "Находит неизвестное систематическим подбором или обратным действием.",
      "example": "x+17=45; 6·x=42.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "violet",
      "x": 840,
      "y": 520,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-3-3",
      "kind": "skill",
      "title": "Формулы периметра и площади",
      "de": "Formeln verwenden",
      "description": "Подставляет известные величины в простые формулы и находит неизвестную величину обратным действием.",
      "example": "U=2a+2b, a=7 cm, b=4 cm.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "violet",
      "x": 520,
      "y": 720,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-3-4",
      "kind": "skill",
      "title": "Задачи на количество вариантов",
      "de": "Zählprinzip & Baumdiagramm",
      "description": "Систематически перечисляет варианты, применяет правило произведения и простое дерево вариантов.",
      "example": "3 футболки и 2 пары брюк: сколько комплектов?",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "violet",
      "x": 840,
      "y": 720,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE"
      ]
    },
    {
      "id": "g5-3-5",
      "kind": "skill",
      "title": "Перевод условия в вычисления",
      "de": "Sachaufgaben modellieren",
      "description": "Выделяет данные и вопрос, выбирает действия и проверяет, соответствует ли ответ условию.",
      "example": "В коробке 24 пачки по 18 карандашей. Сколько карандашей всего?",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "violet",
      "x": 520,
      "y": 920,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-4-1",
      "kind": "skill",
      "title": "Точка, отрезок, луч и прямая",
      "de": "Punkt, Strecke, Strahl & Gerade",
      "description": "Различает основные геометрические объекты, использует обозначения и аккуратно строит их.",
      "example": "Построй Strecke AB длиной 6 cm и Gerade g через A.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "blue",
      "x": 860,
      "y": 520,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-4-2",
      "kind": "skill",
      "title": "Параллельность, перпендикуляр и расстояние",
      "de": "Parallel, senkrecht & Abstand",
      "description": "Распознаёт и строит параллельные и перпендикулярные прямые, понимает расстояние.",
      "example": "Проведи через P прямую, перпендикулярную g.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "blue",
      "x": 1180,
      "y": 520,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-4-3",
      "kind": "skill",
      "title": "Координатная система",
      "de": "Koordinatensystem",
      "description": "Читает и отмечает точки в координатной системе и строит по координатам простые фигуры.",
      "example": "Отметь A(2|4), B(6|4), C(6|1).",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "blue",
      "x": 860,
      "y": 720,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-4-4",
      "kind": "skill",
      "title": "Углы: измерение и построение",
      "de": "Winkel messen & zeichnen",
      "description": "Измеряет и строит углы и использует основные названия видов углов там, где это входит в школьную траекторию.",
      "example": "Построй угол 125° и назови его вид.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "blue",
      "x": 1180,
      "y": 720,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-4-5",
      "kind": "skill",
      "title": "Треугольники и четырёхугольники",
      "de": "Dreiecke & Vierecke",
      "description": "Распознаёт и описывает основные треугольники и четырёхугольники по их свойствам.",
      "example": "Чем квадрат отличается от общего прямоугольника?",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "blue",
      "x": 860,
      "y": 920,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-4-6",
      "kind": "skill",
      "title": "Окружность: радиус и диаметр",
      "de": "Kreis, Radius & Durchmesser",
      "description": "Строит окружность циркулем и связывает радиус с диаметром.",
      "example": "Построй окружность r=3 cm и укажи d.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "blue",
      "x": 1180,
      "y": 920,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE"
      ]
    },
    {
      "id": "g5-4-7",
      "kind": "skill",
      "title": "Пространственные тела и развёртки",
      "de": "Körper & Netze",
      "description": "Распознаёт куб, параллелепипед, призму, пирамиду, цилиндр, конус и шар; работает с простыми развёртками.",
      "example": "Какие грани имеет куб? Нарисуй его развёртку.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "blue",
      "x": 860,
      "y": 1120,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-4-8",
      "kind": "skill",
      "title": "Масштаб",
      "de": "Maßstab",
      "description": "Связывает длину на плане с реальной длиной и решает простые задачи на масштаб.",
      "example": "На плане 1:100 отрезок 4 cm. Сколько это в реальности?",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "blue",
      "x": 1180,
      "y": 1120,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE"
      ]
    },
    {
      "id": "g5-5-1",
      "kind": "skill",
      "title": "Основные величины и единицы",
      "de": "Größen & Einheiten",
      "description": "Уверенно работает с деньгами, длиной, массой и временем; выбирает подходящую единицу.",
      "example": "Какая единица разумнее для массы яблока: g или t?",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "green",
      "x": 1200,
      "y": 520,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-5-2",
      "kind": "skill",
      "title": "Перевод единиц",
      "de": "Einheiten umrechnen",
      "description": "Переводит величины в соседние и составные единицы.",
      "example": "3,5 m = ? cm; 2 h 15 min = ? min.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "green",
      "x": 1520,
      "y": 520,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-5-3",
      "kind": "skill",
      "title": "Вычисления с величинами",
      "de": "Mit Größen rechnen",
      "description": "Складывает, вычитает, умножает и делит величины в практических задачах.",
      "example": "4 билета по 7,50 €: сколько всего?",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "green",
      "x": 1200,
      "y": 720,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-5-4",
      "kind": "skill",
      "title": "Литры и миллилитры",
      "de": "Hohlmaße",
      "description": "Переводит и применяет l и ml в бытовых задачах.",
      "example": "1,75 l = ? ml.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "green",
      "x": 1520,
      "y": 720,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-5-5",
      "kind": "skill",
      "title": "Оценка и правдоподобие",
      "de": "Schätzen & Plausibilität",
      "description": "Оценивает величины по реальным ориентирам и проверяет правдоподобие результата.",
      "example": "Реалистична ли длина класса 70 m?",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "green",
      "x": 1200,
      "y": 920,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-5-6",
      "kind": "skill",
      "title": "Schlussrechnung / простой Dreisatz",
      "de": "Schlussrechnung & Dreisatz",
      "description": "Решает простые пропорциональные бытовые задачи через единицу или структурированный Dreisatz.",
      "example": "3 билета стоят 12 €. Сколько стоят 5?",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "green",
      "x": 1520,
      "y": 920,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "GYMNASIUM",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-5-7",
      "kind": "skill",
      "title": "Периметр",
      "de": "Umfang",
      "description": "Вычисляет периметр прямоугольника, квадрата и простых многоугольников и решает обратные задачи.",
      "example": "Прямоугольник 8 cm × 5 cm: найди U.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "green",
      "x": 1200,
      "y": 1120,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-5-8",
      "kind": "skill",
      "title": "Понятие площади и единицы",
      "de": "Flächeninhalt & Flächeneinheiten",
      "description": "Сравнивает площади, понимает единичный квадрат и переводит основные единицы площади.",
      "example": "Как связаны 1 m² и 10 000 cm²?",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "green",
      "x": 1520,
      "y": 1120,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-5-9",
      "kind": "skill",
      "title": "Площадь прямоугольника и квадрата",
      "de": "Fläche von Rechteck & Quadrat",
      "description": "Применяет A=a·b и A=a², находит неизвестную сторону в простых случаях.",
      "example": "A=48 cm², a=8 cm. Найди b.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "green",
      "x": 1200,
      "y": 1320,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-5-10",
      "kind": "skill",
      "title": "Составные фигуры",
      "de": "Zusammengesetzte Flächen",
      "description": "Разбивает простую составную фигуру на прямоугольники и находит её периметр или площадь.",
      "example": "Найди площадь Г-образной фигуры, разбив её на два прямоугольника.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "green",
      "x": 1520,
      "y": 1320,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-6-1",
      "kind": "skill",
      "title": "Сбор и упорядочивание данных",
      "de": "Daten erfassen",
      "description": "Собирает данные, использует счётные и штриховые списки и аккуратно организует результаты.",
      "example": "Составь Strichliste по результатам опроса 20 учеников.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "teal",
      "x": 1540,
      "y": 520,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-6-2",
      "kind": "skill",
      "title": "Таблицы и диаграммы",
      "de": "Tabellen & Diagramme",
      "description": "Переводит данные между таблицей, текстом и простой диаграммой.",
      "example": "Построй столбчатую диаграмму по таблице.",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "teal",
      "x": 1860,
      "y": 520,
      "archived": false,
      "core": true,
      "schoolTypes": [
        "GYMNASIUM",
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    },
    {
      "id": "g5-6-3",
      "kind": "skill",
      "title": "Чтение и критическая проверка диаграмм",
      "de": "Diagramme auswerten",
      "description": "Отвечает на вопросы по данным и замечает очевидно искажённые или неверно построенные диаграммы.",
      "example": "Почему диаграмма может вводить в заблуждение, если ось начинается с 95?",
      "source": "LehrplanPLUS Bayern · Mathematik 5 · Gymnasium, Realschule und Mittelschule · сверено 05.10.2026. CORE — общее фундаментальное ядро Mindcrafti; школьные расширения отмечены тегами. Не единый учебник.",
      "color": "teal",
      "x": 1540,
      "y": 720,
      "archived": false,
      "core": false,
      "schoolTypes": [
        "REALSCHULE",
        "MITTELSCHULE"
      ]
    }
  ],
  "edges": [
    {
      "id": "g5-edge-1",
      "source": "grade5",
      "target": "g5-topic-1",
      "kind": "contains"
    },
    {
      "id": "g5-edge-2",
      "source": "grade5",
      "target": "g5-topic-2",
      "kind": "contains"
    },
    {
      "id": "g5-edge-3",
      "source": "grade5",
      "target": "g5-topic-3",
      "kind": "contains"
    },
    {
      "id": "g5-edge-4",
      "source": "grade5",
      "target": "g5-topic-4",
      "kind": "contains"
    },
    {
      "id": "g5-edge-5",
      "source": "grade5",
      "target": "g5-topic-5",
      "kind": "contains"
    },
    {
      "id": "g5-edge-6",
      "source": "grade5",
      "target": "g5-topic-6",
      "kind": "contains"
    },
    {
      "id": "g5-edge-7",
      "source": "g5-topic-1",
      "target": "g5-1-1",
      "kind": "contains"
    },
    {
      "id": "g5-edge-8",
      "source": "g5-topic-1",
      "target": "g5-1-2",
      "kind": "contains"
    },
    {
      "id": "g5-edge-9",
      "source": "g5-topic-1",
      "target": "g5-1-3",
      "kind": "contains"
    },
    {
      "id": "g5-edge-10",
      "source": "g5-topic-1",
      "target": "g5-1-4",
      "kind": "contains"
    },
    {
      "id": "g5-edge-11",
      "source": "g5-topic-1",
      "target": "g5-1-5",
      "kind": "contains"
    },
    {
      "id": "g5-edge-12",
      "source": "g5-topic-1",
      "target": "g5-1-6",
      "kind": "contains"
    },
    {
      "id": "g5-edge-13",
      "source": "g5-topic-1",
      "target": "g5-1-7",
      "kind": "contains"
    },
    {
      "id": "g5-edge-14",
      "source": "g5-topic-1",
      "target": "g5-1-8",
      "kind": "contains"
    },
    {
      "id": "g5-edge-15",
      "source": "g5-topic-1",
      "target": "g5-1-9",
      "kind": "contains"
    },
    {
      "id": "g5-edge-16",
      "source": "g5-topic-2",
      "target": "g5-2-1",
      "kind": "contains"
    },
    {
      "id": "g5-edge-17",
      "source": "g5-topic-2",
      "target": "g5-2-2",
      "kind": "contains"
    },
    {
      "id": "g5-edge-18",
      "source": "g5-topic-2",
      "target": "g5-2-3",
      "kind": "contains"
    },
    {
      "id": "g5-edge-19",
      "source": "g5-topic-2",
      "target": "g5-2-4",
      "kind": "contains"
    },
    {
      "id": "g5-edge-20",
      "source": "g5-topic-2",
      "target": "g5-2-5",
      "kind": "contains"
    },
    {
      "id": "g5-edge-21",
      "source": "g5-topic-2",
      "target": "g5-2-6",
      "kind": "contains"
    },
    {
      "id": "g5-edge-22",
      "source": "g5-topic-3",
      "target": "g5-3-1",
      "kind": "contains"
    },
    {
      "id": "g5-edge-23",
      "source": "g5-topic-3",
      "target": "g5-3-2",
      "kind": "contains"
    },
    {
      "id": "g5-edge-24",
      "source": "g5-topic-3",
      "target": "g5-3-3",
      "kind": "contains"
    },
    {
      "id": "g5-edge-25",
      "source": "g5-topic-3",
      "target": "g5-3-4",
      "kind": "contains"
    },
    {
      "id": "g5-edge-26",
      "source": "g5-topic-3",
      "target": "g5-3-5",
      "kind": "contains"
    },
    {
      "id": "g5-edge-27",
      "source": "g5-topic-4",
      "target": "g5-4-1",
      "kind": "contains"
    },
    {
      "id": "g5-edge-28",
      "source": "g5-topic-4",
      "target": "g5-4-2",
      "kind": "contains"
    },
    {
      "id": "g5-edge-29",
      "source": "g5-topic-4",
      "target": "g5-4-3",
      "kind": "contains"
    },
    {
      "id": "g5-edge-30",
      "source": "g5-topic-4",
      "target": "g5-4-4",
      "kind": "contains"
    },
    {
      "id": "g5-edge-31",
      "source": "g5-topic-4",
      "target": "g5-4-5",
      "kind": "contains"
    },
    {
      "id": "g5-edge-32",
      "source": "g5-topic-4",
      "target": "g5-4-6",
      "kind": "contains"
    },
    {
      "id": "g5-edge-33",
      "source": "g5-topic-4",
      "target": "g5-4-7",
      "kind": "contains"
    },
    {
      "id": "g5-edge-34",
      "source": "g5-topic-4",
      "target": "g5-4-8",
      "kind": "contains"
    },
    {
      "id": "g5-edge-35",
      "source": "g5-topic-5",
      "target": "g5-5-1",
      "kind": "contains"
    },
    {
      "id": "g5-edge-36",
      "source": "g5-topic-5",
      "target": "g5-5-2",
      "kind": "contains"
    },
    {
      "id": "g5-edge-37",
      "source": "g5-topic-5",
      "target": "g5-5-3",
      "kind": "contains"
    },
    {
      "id": "g5-edge-38",
      "source": "g5-topic-5",
      "target": "g5-5-4",
      "kind": "contains"
    },
    {
      "id": "g5-edge-39",
      "source": "g5-topic-5",
      "target": "g5-5-5",
      "kind": "contains"
    },
    {
      "id": "g5-edge-40",
      "source": "g5-topic-5",
      "target": "g5-5-6",
      "kind": "contains"
    },
    {
      "id": "g5-edge-41",
      "source": "g5-topic-5",
      "target": "g5-5-7",
      "kind": "contains"
    },
    {
      "id": "g5-edge-42",
      "source": "g5-topic-5",
      "target": "g5-5-8",
      "kind": "contains"
    },
    {
      "id": "g5-edge-43",
      "source": "g5-topic-5",
      "target": "g5-5-9",
      "kind": "contains"
    },
    {
      "id": "g5-edge-44",
      "source": "g5-topic-5",
      "target": "g5-5-10",
      "kind": "contains"
    },
    {
      "id": "g5-edge-45",
      "source": "g5-topic-6",
      "target": "g5-6-1",
      "kind": "contains"
    },
    {
      "id": "g5-edge-46",
      "source": "g5-topic-6",
      "target": "g5-6-2",
      "kind": "contains"
    },
    {
      "id": "g5-edge-47",
      "source": "g5-topic-6",
      "target": "g5-6-3",
      "kind": "contains"
    },
    {
      "id": "g5-edge-48",
      "source": "g5-1-1",
      "target": "g5-1-2",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-49",
      "source": "g5-1-2",
      "target": "g5-1-3",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-50",
      "source": "g5-1-4",
      "target": "g5-1-6",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-51",
      "source": "g5-1-5",
      "target": "g5-1-6",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-52",
      "source": "g5-1-5",
      "target": "g5-1-8",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-53",
      "source": "g5-2-1",
      "target": "g5-2-2",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-54",
      "source": "g5-2-2",
      "target": "g5-2-3",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-55",
      "source": "g5-2-2",
      "target": "g5-2-4",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-56",
      "source": "g5-2-4",
      "target": "g5-2-5",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-57",
      "source": "g5-2-5",
      "target": "g5-2-6",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-58",
      "source": "g5-1-6",
      "target": "g5-3-1",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-59",
      "source": "g5-3-1",
      "target": "g5-3-2",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-60",
      "source": "g5-4-1",
      "target": "g5-4-2",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-61",
      "source": "g5-4-1",
      "target": "g5-4-3",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-62",
      "source": "g5-5-1",
      "target": "g5-5-2",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-63",
      "source": "g5-5-2",
      "target": "g5-5-3",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-64",
      "source": "g5-5-2",
      "target": "g5-5-7",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-65",
      "source": "g5-5-7",
      "target": "g5-3-3",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-66",
      "source": "g5-5-8",
      "target": "g5-5-9",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-67",
      "source": "g5-5-9",
      "target": "g5-5-10",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-68",
      "source": "g5-6-1",
      "target": "g5-6-2",
      "kind": "prerequisite"
    },
    {
      "id": "g5-edge-69",
      "source": "g5-6-2",
      "target": "g5-6-3",
      "kind": "prerequisite"
    }
  ]
}
$seed$::jsonb);

INSERT INTO skill_board_revisions(board_id, revision, data, updated_at)
SELECT id, revision, data, updated_at FROM skill_boards WHERE id='grade-5';
