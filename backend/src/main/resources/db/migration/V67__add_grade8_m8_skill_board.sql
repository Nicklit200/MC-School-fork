-- Separate Grade 8 / M8 skills board. Does not modify Grade 6 curriculum or pupil mastery.
INSERT INTO skill_boards(id, data) VALUES ('grade-8-m8', $seed$
{
  "schemaVersion": 1,
  "title": "Математика — навыки 8 класса (M8)",
  "grade": 8,
  "source": "Годовой M8-трекер Виталины + актуальная карта навыков/ошибок Группы 2. Основные M8-компетенции отделены от повторительной базы и дополнительных школьных тем.",
  "nodes": [
    {
      "id": "m8-root",
      "kind": "root",
      "title": "Математика — 8 класс (M8)",
      "de": "Mathematik · Klasse 8 · M8",
      "description": "Отдельная карта Виталины и других учеников 8 класса. Основная структура — годовой M8-трекер; повторительные и текущие школьные темы помечены отдельно.",
      "example": "",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "orange",
      "x": 1120,
      "y": 0,
      "archived": false
    },
    {
      "id": "m8-topic-review",
      "title": "База и повторение",
      "de": "Grundlagen & Wiederholung",
      "color": "orange",
      "x": 0,
      "y": 260,
      "source": "Актуальные домашние, транскрипции и карта ошибок Группы 2 за август–октябрь 2026. Это базовые/повторительные навыки, а не отдельный официальный Lernbereich M8.",
      "kind": "topic",
      "description": "Раздел программы/текущей школьной работы. Откройте дочерние навыки.",
      "example": "",
      "archived": false
    },
    {
      "id": "m8-topic-1",
      "title": "Треугольники и четырёхугольники",
      "de": "Dreiecke und Vierecke",
      "color": "blue",
      "x": 320,
      "y": 260,
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "kind": "topic",
      "description": "Раздел программы/текущей школьной работы. Откройте дочерние навыки.",
      "example": "",
      "archived": false
    },
    {
      "id": "m8-topic-2",
      "title": "Пространственная геометрия",
      "de": "Raumgeometrie",
      "color": "teal",
      "x": 640,
      "y": 260,
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "kind": "topic",
      "description": "Раздел программы/текущей школьной работы. Откройте дочерние навыки.",
      "example": "",
      "archived": false
    },
    {
      "id": "m8-topic-3",
      "title": "Термы и уравнения",
      "de": "Terme und Gleichungen",
      "color": "violet",
      "x": 960,
      "y": 260,
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "kind": "topic",
      "description": "Раздел программы/текущей школьной работы. Откройте дочерние навыки.",
      "example": "",
      "archived": false
    },
    {
      "id": "m8-topic-4",
      "title": "Дробные выражения и уравнения",
      "de": "Bruchterme und Bruchgleichungen",
      "color": "green",
      "x": 1280,
      "y": 260,
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "kind": "topic",
      "description": "Раздел программы/текущей школьной работы. Откройте дочерние навыки.",
      "example": "",
      "archived": false
    },
    {
      "id": "m8-topic-5",
      "title": "Функции",
      "de": "Funktionen",
      "color": "blue",
      "x": 1600,
      "y": 260,
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "kind": "topic",
      "description": "Раздел программы/текущей школьной работы. Откройте дочерние навыки.",
      "example": "",
      "archived": false
    },
    {
      "id": "m8-topic-6",
      "title": "Данные и вероятность",
      "de": "Daten und Zufall",
      "color": "teal",
      "x": 1920,
      "y": 260,
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "kind": "topic",
      "description": "Раздел программы/текущей школьной работы. Откройте дочерние навыки.",
      "example": "",
      "archived": false
    },
    {
      "id": "m8-topic-coord",
      "title": "Координатные методы",
      "de": "Koordinaten & Vektoren",
      "color": "violet",
      "x": 2240,
      "y": 260,
      "source": "Группа_2_карта_навыков_и_ошибок_25-09-2026.xlsx · актуальные школьные темы Виталины; добавлено отдельно от основной структуры M8.",
      "kind": "topic",
      "description": "Раздел программы/текущей школьной работы. Откройте дочерние навыки.",
      "example": "",
      "archived": false
    },
    {
      "id": "m8-r-1",
      "kind": "skill",
      "title": "Отрицательные числа и сравнение",
      "de": "Negative Zahlen vergleichen",
      "description": "Сравнивает отрицательные числа и выполняет базовые действия со знаками.",
      "example": "Сравни: −0,37 и −0,40.",
      "source": "Актуальные домашние, транскрипции и карта ошибок Группы 2 за август–октябрь 2026. Это базовые/повторительные навыки, а не отдельный официальный Lernbereich M8.",
      "color": "orange",
      "x": -130,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-r-2",
      "kind": "skill",
      "title": "Обыкновенные дроби: действия",
      "de": "Bruchrechnung",
      "description": "Складывает, вычитает, умножает и сокращает обыкновенные дроби.",
      "example": "7/9 − 2/3.",
      "source": "Актуальные домашние, транскрипции и карта ошибок Группы 2 за август–октябрь 2026. Это базовые/повторительные навыки, а не отдельный официальный Lernbereich M8.",
      "color": "orange",
      "x": 130,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-r-3",
      "kind": "skill",
      "title": "Десятичные дроби: действия",
      "de": "Dezimalzahlen rechnen",
      "description": "Выполняет четыре действия с десятичными дробями и контролирует положение запятой.",
      "example": "6,3 : 0,9.",
      "source": "Актуальные домашние, транскрипции и карта ошибок Группы 2 за август–октябрь 2026. Это базовые/повторительные навыки, а не отдельный официальный Lernbereich M8.",
      "color": "orange",
      "x": -130,
      "y": 710,
      "archived": false
    },
    {
      "id": "m8-r-4",
      "kind": "skill",
      "title": "Процент и коэффициент",
      "de": "Prozent ↔ Faktor",
      "description": "Переводит процент в десятичную запись и коэффициент повышения/снижения.",
      "example": "14% Rabatt → Faktor ?",
      "source": "Актуальные домашние, транскрипции и карта ошибок Группы 2 за август–октябрь 2026. Это базовые/повторительные навыки, а не отдельный официальный Lernbereich M8.",
      "color": "orange",
      "x": 130,
      "y": 710,
      "archived": false
    },
    {
      "id": "m8-r-5",
      "kind": "skill",
      "title": "Прямые процентные задачи",
      "de": "Prozentwert, Rabatt, Erhöhung",
      "description": "Находит новый результат при известном исходном значении и процентном изменении.",
      "example": "540 € werden um 7,5% erhöht.",
      "source": "Актуальные домашние, транскрипции и карта ошибок Группы 2 за август–октябрь 2026. Это базовые/повторительные навыки, а не отдельный официальный Lernbereich M8.",
      "color": "orange",
      "x": -130,
      "y": 900,
      "archived": false
    },
    {
      "id": "m8-r-6",
      "kind": "skill",
      "title": "Обратные процентные задачи",
      "de": "Rückwärts-Prozentrechnung",
      "description": "Находит исходное значение по конечному значению после Rabatt/Erhöhung и правильно выбирает деление на коэффициент.",
      "example": "Nach 25% Rabatt kostet ein Pullover 135 €. Ursprünglicher Preis?",
      "source": "Актуальные домашние, транскрипции и карта ошибок Группы 2 за август–октябрь 2026. Это базовые/повторительные навыки, а не отдельный официальный Lernbereich M8.",
      "color": "orange",
      "x": 130,
      "y": 900,
      "archived": false
    },
    {
      "id": "m8-r-7",
      "kind": "skill",
      "title": "Проценты и проценты по вкладу",
      "de": "Zinsen & Endkapital",
      "description": "Вычисляет Jahreszinsen и Endkapital без лишних операций.",
      "example": "1500 € zu 2,4% für ein Jahr.",
      "source": "Актуальные домашние, транскрипции и карта ошибок Группы 2 за август–октябрь 2026. Это базовые/повторительные навыки, а не отдельный официальный Lernbereich M8.",
      "color": "orange",
      "x": -130,
      "y": 1090,
      "archived": false
    },
    {
      "id": "m8-r-8",
      "kind": "skill",
      "title": "Пропорциональность и Dreisatz",
      "de": "Dreisatz & Proportionalität",
      "description": "Решает прямые пропорциональные задачи через единицу или коэффициент.",
      "example": "45 km in 3 h. Wie weit in 5 h?",
      "source": "Актуальные домашние, транскрипции и карта ошибок Группы 2 за август–октябрь 2026. Это базовые/повторительные навыки, а не отдельный официальный Lernbereich M8.",
      "color": "orange",
      "x": 130,
      "y": 1090,
      "archived": false
    },
    {
      "id": "m8-r-9",
      "kind": "skill",
      "title": "Простые линейные уравнения",
      "de": "Einfache lineare Gleichungen",
      "description": "Решает линейные уравнения с одной переменной, включая простые скобки.",
      "example": "2(4x−3)+5=31.",
      "source": "Актуальные домашние, транскрипции и карта ошибок Группы 2 за август–октябрь 2026. Это базовые/повторительные навыки, а не отдельный официальный Lernbereich M8.",
      "color": "orange",
      "x": -130,
      "y": 1280,
      "archived": false
    },
    {
      "id": "m8-r-10",
      "kind": "skill",
      "title": "Термы и подстановка",
      "de": "Terme & Einsetzen",
      "description": "Составляет простые термы и подставляет заданные значения с учётом умножения и степеней.",
      "example": "Für x=−3 berechne 2x+1 und x²+4.",
      "source": "Актуальные домашние, транскрипции и карта ошибок Группы 2 за август–октябрь 2026. Это базовые/повторительные навыки, а не отдельный официальный Lernbereich M8.",
      "color": "orange",
      "x": 130,
      "y": 1280,
      "archived": false
    },
    {
      "id": "m8-1-1",
      "kind": "skill",
      "title": "Условия существования треугольника",
      "de": "Existenz von Dreiecken",
      "description": "Обосновывает, может ли существовать треугольник по отношениям сторон и углов.",
      "example": "Могут ли стороны 3 cm, 4 cm, 8 cm образовать треугольник?",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "blue",
      "x": 190,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-1-2",
      "kind": "skill",
      "title": "Построение треугольников",
      "de": "Dreieckskonstruktionen",
      "description": "Описывает и выполняет построения треугольников циркулем и транспортиром.",
      "example": "Построй треугольник по двум сторонам и углу.",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "blue",
      "x": 450,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-1-3",
      "kind": "skill",
      "title": "Признаки равенства треугольников",
      "de": "Kongruenzsätze",
      "description": "Применяет признаки конгруэнтности для проверки равенства треугольников.",
      "example": "Определи подходящий Kongruenzsatz.",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "blue",
      "x": 190,
      "y": 710,
      "archived": false
    },
    {
      "id": "m8-1-4",
      "kind": "skill",
      "title": "Свойства четырёхугольников",
      "de": "Eigenschaften von Vierecken",
      "description": "Различает трапецию, дельтоид, параллелограмм, ромб, прямоугольник и квадрат по свойствам.",
      "example": "Какие признаки отличают ромб от прямоугольника?",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "blue",
      "x": 450,
      "y": 710,
      "archived": false
    },
    {
      "id": "m8-1-5",
      "kind": "skill",
      "title": "Построение четырёхугольников",
      "de": "Vierecke konstruieren",
      "description": "Строит четырёхугольники и использует их свойства при решении задач.",
      "example": "Построй параллелограмм по заданным данным.",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "blue",
      "x": 190,
      "y": 900,
      "archived": false
    },
    {
      "id": "m8-2-1",
      "kind": "skill",
      "title": "Косые изображения призм и пирамид",
      "de": "Schrägbilder von Prismen und Pyramiden",
      "description": "Строит Schrägbild призмы/пирамиды с учётом Verzerrungswinkel и -maßstab.",
      "example": "Построй Schrägbild прямоугольной призмы.",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "teal",
      "x": 510,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-2-2",
      "kind": "skill",
      "title": "Истинные размеры из Schrägbild",
      "de": "Wahre Größe aus Schrägbildern",
      "description": "Восстанавливает плоские фигуры в истинном размере и определяет длины/углы.",
      "example": "Определи истинную длину отрезка по Schrägbild.",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "teal",
      "x": 770,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-3-1",
      "kind": "skill",
      "title": "Преобразование сложных термов",
      "de": "Komplexe Terme umformen",
      "description": "Упрощает термы с несколькими переменными и степенями; раскрывает, перемножает и факторизует суммы, включая binomische Formeln.",
      "example": "Vereinfache: 3x(x+2)−2x².",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "violet",
      "x": 830,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-3-2",
      "kind": "skill",
      "title": "Экстремумы квадратных термов",
      "de": "Extremwerte quadratischer Terme",
      "description": "Находит экстремальные значения ax²+bx+c и применяет их в задачах.",
      "example": "Определи минимальное значение заданного квадратного терма.",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "violet",
      "x": 1090,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-3-3",
      "kind": "skill",
      "title": "Сложные линейные уравнения",
      "de": "Lineare Gleichungen",
      "description": "Решает линейные уравнения с переменными в обеих частях, произведениями сумм и применяет их в текстовых задачах.",
      "example": "Löse: 3(x+2)−4 = 2(x−1)+9.",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "violet",
      "x": 830,
      "y": 710,
      "archived": false
    },
    {
      "id": "m8-4-1",
      "kind": "skill",
      "title": "Дробные выражения и область определения",
      "de": "Bruchterme & Definitionsmenge",
      "description": "Распознаёт переменную в знаменателе и объясняет необходимость Definitionsmenge.",
      "example": "Для 3/(x−2) укажи запрещённое значение.",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "green",
      "x": 1150,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-4-2",
      "kind": "skill",
      "title": "Дробные и пропорциональные уравнения",
      "de": "Bruch- und Verhältnisgleichungen",
      "description": "Определяет Definitionsmenge и решает простые Bruchgleichungen/Verhältnisgleichungen.",
      "example": "Löse: x/4 = 6/8.",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "green",
      "x": 1410,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-5-1",
      "kind": "skill",
      "title": "Понятие функции",
      "de": "Funktionale Zusammenhänge",
      "description": "Распознаёт функциональные зависимости и отличает их от неоднозначных соответствий.",
      "example": "Является ли данное соответствие функцией?",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "blue",
      "x": 1470,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-5-2",
      "kind": "skill",
      "title": "Представления функции",
      "de": "Term, Graph, Wertetabelle",
      "description": "Переходит между формулой, графиком, таблицей и описанием; вычисляет значения/нули, использует Definitions- и Wertemenge.",
      "example": "По y=2x−4 составь таблицу и найди Nullstelle.",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "blue",
      "x": 1730,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-5-3",
      "kind": "skill",
      "title": "Урспрунгсгерaде и коэффициент m",
      "de": "Ursprungsgerade y=mx",
      "description": "Распознаёт y=mx и объясняет смысл коэффициента m.",
      "example": "Что означает m в y=−2x?",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "blue",
      "x": 1470,
      "y": 710,
      "archived": false
    },
    {
      "id": "m8-5-4",
      "kind": "skill",
      "title": "Линейная функция по графику",
      "de": "Lineare Funktionen & Steigungsdreieck",
      "description": "Строит линейные функции через Steigungsdreieck и определяет уравнение по графику.",
      "example": "По графику найди m и составь Funktionsgleichung.",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "blue",
      "x": 1730,
      "y": 710,
      "archived": false
    },
    {
      "id": "m8-5-5",
      "kind": "skill",
      "title": "Перпендикулярные прямые",
      "de": "Orthogonale Geraden",
      "description": "Использует m₁·m₂=−1 для нахождения наклона перпендикулярной прямой.",
      "example": "m₁=2. Найди m₂ для ортогональной прямой.",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "blue",
      "x": 1470,
      "y": 900,
      "archived": false
    },
    {
      "id": "m8-6-1",
      "kind": "skill",
      "title": "Исходы и события",
      "de": "Ergebnis & Ereignis",
      "description": "Представляет исходы случайного эксперимента через Baumdiagramm/Vierfeldertafel и корректно использует Begriff Ergebnis/Ereignis.",
      "example": "Построй Baumdiagramm для двух бросков монеты.",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "teal",
      "x": 1790,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-6-2",
      "kind": "skill",
      "title": "Абсолютная и относительная частота",
      "de": "Absolute & relative Häufigkeit",
      "description": "Вычисляет абсолютные/относительные частоты событий и оценивает шансы выигрыша.",
      "example": "20 выигрышей из 80 игр: relative Häufigkeit?",
      "source": "Группа_2_M8_годовой_трекер_Виталина.xlsx · ориентир LehrplanPLUS Bayern, Mathematik M8. Проценты 85% из старого трекера не используются как доказательство освоения.",
      "color": "teal",
      "x": 2050,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-c-1",
      "kind": "skill",
      "title": "Точка и вектор-столбец",
      "de": "Punkt vs. Spaltenvektor",
      "description": "Различает координаты точки и компоненты вектора и корректно записывает их.",
      "example": "A(2|−1) и v=(3;4): объясни разницу.",
      "source": "Группа_2_карта_навыков_и_ошибок_25-09-2026.xlsx · актуальные школьные темы Виталины; добавлено отдельно от основной структуры M8.",
      "color": "violet",
      "x": 2110,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-c-2",
      "kind": "skill",
      "title": "Вектор AB = B − A",
      "de": "Verbindungsvektor AB",
      "description": "Находит направленный вектор между двумя точками и различает AB и BA.",
      "example": "A(2|1), B(−1|5): найди AB и BA.",
      "source": "Группа_2_карта_навыков_и_ошибок_25-09-2026.xlsx · актуальные школьные темы Виталины; добавлено отдельно от основной структуры M8.",
      "color": "violet",
      "x": 2370,
      "y": 520,
      "archived": false
    },
    {
      "id": "m8-c-3",
      "kind": "skill",
      "title": "Площадь треугольника через детерминант",
      "de": "Dreiecksfläche mit Determinante",
      "description": "Находит два вектора, вычисляет determinant и площадь 1/2·|det|.",
      "example": "Найди площадь треугольника по координатам трёх вершин.",
      "source": "Группа_2_карта_навыков_и_ошибок_25-09-2026.xlsx · актуальные школьные темы Виталины; добавлено отдельно от основной структуры M8.",
      "color": "violet",
      "x": 2110,
      "y": 710,
      "archived": false
    }
  ],
  "edges": [
    {
      "id": "m8-edge-1",
      "source": "m8-root",
      "target": "m8-topic-review",
      "kind": "contains"
    },
    {
      "id": "m8-edge-2",
      "source": "m8-root",
      "target": "m8-topic-1",
      "kind": "contains"
    },
    {
      "id": "m8-edge-3",
      "source": "m8-root",
      "target": "m8-topic-2",
      "kind": "contains"
    },
    {
      "id": "m8-edge-4",
      "source": "m8-root",
      "target": "m8-topic-3",
      "kind": "contains"
    },
    {
      "id": "m8-edge-5",
      "source": "m8-root",
      "target": "m8-topic-4",
      "kind": "contains"
    },
    {
      "id": "m8-edge-6",
      "source": "m8-root",
      "target": "m8-topic-5",
      "kind": "contains"
    },
    {
      "id": "m8-edge-7",
      "source": "m8-root",
      "target": "m8-topic-6",
      "kind": "contains"
    },
    {
      "id": "m8-edge-8",
      "source": "m8-root",
      "target": "m8-topic-coord",
      "kind": "contains"
    },
    {
      "id": "m8-edge-9",
      "source": "m8-topic-review",
      "target": "m8-r-1",
      "kind": "contains"
    },
    {
      "id": "m8-edge-10",
      "source": "m8-topic-review",
      "target": "m8-r-2",
      "kind": "contains"
    },
    {
      "id": "m8-edge-11",
      "source": "m8-topic-review",
      "target": "m8-r-3",
      "kind": "contains"
    },
    {
      "id": "m8-edge-12",
      "source": "m8-topic-review",
      "target": "m8-r-4",
      "kind": "contains"
    },
    {
      "id": "m8-edge-13",
      "source": "m8-topic-review",
      "target": "m8-r-5",
      "kind": "contains"
    },
    {
      "id": "m8-edge-14",
      "source": "m8-topic-review",
      "target": "m8-r-6",
      "kind": "contains"
    },
    {
      "id": "m8-edge-15",
      "source": "m8-topic-review",
      "target": "m8-r-7",
      "kind": "contains"
    },
    {
      "id": "m8-edge-16",
      "source": "m8-topic-review",
      "target": "m8-r-8",
      "kind": "contains"
    },
    {
      "id": "m8-edge-17",
      "source": "m8-topic-review",
      "target": "m8-r-9",
      "kind": "contains"
    },
    {
      "id": "m8-edge-18",
      "source": "m8-topic-review",
      "target": "m8-r-10",
      "kind": "contains"
    },
    {
      "id": "m8-edge-19",
      "source": "m8-topic-1",
      "target": "m8-1-1",
      "kind": "contains"
    },
    {
      "id": "m8-edge-20",
      "source": "m8-topic-1",
      "target": "m8-1-2",
      "kind": "contains"
    },
    {
      "id": "m8-edge-21",
      "source": "m8-topic-1",
      "target": "m8-1-3",
      "kind": "contains"
    },
    {
      "id": "m8-edge-22",
      "source": "m8-topic-1",
      "target": "m8-1-4",
      "kind": "contains"
    },
    {
      "id": "m8-edge-23",
      "source": "m8-topic-1",
      "target": "m8-1-5",
      "kind": "contains"
    },
    {
      "id": "m8-edge-24",
      "source": "m8-topic-2",
      "target": "m8-2-1",
      "kind": "contains"
    },
    {
      "id": "m8-edge-25",
      "source": "m8-topic-2",
      "target": "m8-2-2",
      "kind": "contains"
    },
    {
      "id": "m8-edge-26",
      "source": "m8-topic-3",
      "target": "m8-3-1",
      "kind": "contains"
    },
    {
      "id": "m8-edge-27",
      "source": "m8-topic-3",
      "target": "m8-3-2",
      "kind": "contains"
    },
    {
      "id": "m8-edge-28",
      "source": "m8-topic-3",
      "target": "m8-3-3",
      "kind": "contains"
    },
    {
      "id": "m8-edge-29",
      "source": "m8-topic-4",
      "target": "m8-4-1",
      "kind": "contains"
    },
    {
      "id": "m8-edge-30",
      "source": "m8-topic-4",
      "target": "m8-4-2",
      "kind": "contains"
    },
    {
      "id": "m8-edge-31",
      "source": "m8-topic-5",
      "target": "m8-5-1",
      "kind": "contains"
    },
    {
      "id": "m8-edge-32",
      "source": "m8-topic-5",
      "target": "m8-5-2",
      "kind": "contains"
    },
    {
      "id": "m8-edge-33",
      "source": "m8-topic-5",
      "target": "m8-5-3",
      "kind": "contains"
    },
    {
      "id": "m8-edge-34",
      "source": "m8-topic-5",
      "target": "m8-5-4",
      "kind": "contains"
    },
    {
      "id": "m8-edge-35",
      "source": "m8-topic-5",
      "target": "m8-5-5",
      "kind": "contains"
    },
    {
      "id": "m8-edge-36",
      "source": "m8-topic-6",
      "target": "m8-6-1",
      "kind": "contains"
    },
    {
      "id": "m8-edge-37",
      "source": "m8-topic-6",
      "target": "m8-6-2",
      "kind": "contains"
    },
    {
      "id": "m8-edge-38",
      "source": "m8-topic-coord",
      "target": "m8-c-1",
      "kind": "contains"
    },
    {
      "id": "m8-edge-39",
      "source": "m8-topic-coord",
      "target": "m8-c-2",
      "kind": "contains"
    },
    {
      "id": "m8-edge-40",
      "source": "m8-topic-coord",
      "target": "m8-c-3",
      "kind": "contains"
    },
    {
      "id": "m8-edge-41",
      "source": "m8-r-1",
      "target": "m8-r-10",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-42",
      "source": "m8-r-2",
      "target": "m8-r-3",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-43",
      "source": "m8-r-4",
      "target": "m8-r-5",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-44",
      "source": "m8-r-5",
      "target": "m8-r-6",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-45",
      "source": "m8-r-4",
      "target": "m8-r-7",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-46",
      "source": "m8-r-8",
      "target": "m8-r-5",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-47",
      "source": "m8-r-9",
      "target": "m8-3-3",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-48",
      "source": "m8-r-10",
      "target": "m8-3-1",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-49",
      "source": "m8-r-2",
      "target": "m8-4-1",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-50",
      "source": "m8-r-2",
      "target": "m8-4-2",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-51",
      "source": "m8-1-1",
      "target": "m8-1-2",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-52",
      "source": "m8-1-2",
      "target": "m8-1-3",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-53",
      "source": "m8-1-4",
      "target": "m8-1-5",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-54",
      "source": "m8-3-1",
      "target": "m8-3-2",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-55",
      "source": "m8-3-1",
      "target": "m8-3-3",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-56",
      "source": "m8-4-1",
      "target": "m8-4-2",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-57",
      "source": "m8-5-1",
      "target": "m8-5-2",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-58",
      "source": "m8-5-2",
      "target": "m8-5-3",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-59",
      "source": "m8-5-3",
      "target": "m8-5-4",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-60",
      "source": "m8-5-4",
      "target": "m8-5-5",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-61",
      "source": "m8-6-1",
      "target": "m8-6-2",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-62",
      "source": "m8-3-3",
      "target": "m8-5-2",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-63",
      "source": "m8-r-8",
      "target": "m8-4-2",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-64",
      "source": "m8-c-1",
      "target": "m8-c-2",
      "kind": "prerequisite"
    },
    {
      "id": "m8-edge-65",
      "source": "m8-c-2",
      "target": "m8-c-3",
      "kind": "prerequisite"
    }
  ]
}
$seed$::jsonb);

INSERT INTO skill_board_revisions(board_id, revision, data, updated_at)
SELECT id, revision, data, updated_at FROM skill_boards WHERE id='grade-8-m8';
