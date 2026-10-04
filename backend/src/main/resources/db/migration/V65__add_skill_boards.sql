-- Additive curriculum catalog: no pupil records are modified.
CREATE TABLE skill_boards (
 id VARCHAR(64) PRIMARY KEY, data JSONB NOT NULL,
 revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by UUID
);
CREATE TABLE skill_board_revisions (
 board_id VARCHAR(64) NOT NULL REFERENCES skill_boards(id),
 revision BIGINT NOT NULL, data JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by UUID,
 PRIMARY KEY(board_id, revision)
);
INSERT INTO skill_boards(id, data) VALUES ('grade-6', $seed${
  "schemaVersion": 1,
  "title": "Математика — навыки к концу 6 класса",
  "grade": 6,
  "source": "Mathe.Logo 6 · Wirtschaftsschule Bayern · C.C.Buchner · 2021 · ISBN 978-3-7661-6237-3. Декомпозиция по присланному оглавлению; не единый стандарт всех школ.",
  "nodes": [
    {
      "id": "grade6",
      "kind": "root",
      "title": "Математика — 6 класс",
      "de": "Mathematik · Klasse 6",
      "description": "Редактируемый черновик программы. Werkrealschule ещё не сверена.",
      "example": "",
      "source": "Mathe.Logo 6 · Wirtschaftsschule Bayern · C.C.Buchner · 2021 · ISBN 978-3-7661-6237-3. Декомпозиция по присланному оглавлению; не единый стандарт всех школ.",
      "color": "orange",
      "x": 650,
      "y": 0,
      "archived": false
    },
    {
      "id": "topic-1",
      "kind": "topic",
      "title": "Натуральные числа",
      "de": "Natürliche Zahlen",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "Mathe.Logo 6 · Wirtschaftsschule Bayern · C.C.Buchner · 2021 · ISBN 978-3-7661-6237-3. Декомпозиция по присланному оглавлению; не единый стандарт всех школ. Глава 1.",
      "color": "orange",
      "x": 0,
      "y": 260,
      "archived": false
    },
    {
      "id": "skill-1-1",
      "kind": "skill",
      "title": "Разряды и сравнение",
      "de": "Stellenwert und Ordnen",
      "description": "Читает, записывает и сравнивает натуральные числа по разрядам.",
      "example": "Запиши число: 4 сотни тысяч + 7 сотен + 3 единицы.",
      "source": "Mathe.Logo 6, глава 1: Natürliche Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": -170,
      "y": 510,
      "archived": false
    },
    {
      "id": "skill-1-2",
      "kind": "skill",
      "title": "Округление и оценка",
      "de": "Runden und Überschlagen",
      "description": "Округляет до указанного разряда и оценивает разумность ответа.",
      "example": "Округли 48 761 до тысяч.",
      "source": "Mathe.Logo 6, глава 1: Natürliche Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 170,
      "y": 510,
      "archived": false
    },
    {
      "id": "skill-1-3",
      "kind": "skill",
      "title": "Сложение и вычитание",
      "de": "Addieren und Subtrahieren",
      "description": "Самостоятельно складывает и вычитает многозначные числа.",
      "example": "6 305 − 2 978.",
      "source": "Mathe.Logo 6, глава 1: Natürliche Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": -170,
      "y": 710,
      "archived": false
    },
    {
      "id": "skill-1-4",
      "kind": "skill",
      "title": "Умножение и деление",
      "de": "Multiplizieren und Dividieren",
      "description": "Выполняет умножение и деление натуральных чисел, проверяет обратным действием.",
      "example": "4 368 : 24.",
      "source": "Mathe.Logo 6, глава 1: Natürliche Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 170,
      "y": 710,
      "archived": false
    },
    {
      "id": "skill-1-5",
      "kind": "skill",
      "title": "Степени",
      "de": "Potenzen",
      "description": "Объясняет степень как повторное умножение и вычисляет простые степени.",
      "example": "Объясни разницу между 3² и 3 · 2.",
      "source": "Mathe.Logo 6, глава 1: Natürliche Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": -170,
      "y": 910,
      "archived": false
    },
    {
      "id": "skill-1-6",
      "kind": "skill",
      "title": "Систематический перебор",
      "de": "Kombinieren",
      "description": "Находит все варианты в простой задаче без пропусков и повторов.",
      "example": "3 футболки и 2 пары брюк: сколько комплектов?",
      "source": "Mathe.Logo 6, глава 1: Natürliche Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 170,
      "y": 910,
      "archived": false
    },
    {
      "id": "skill-1-7",
      "kind": "skill",
      "title": "Порядок действий",
      "de": "Rechengesetze",
      "description": "Соблюдает скобки и приоритет операций; использует удобные способы вычисления.",
      "example": "36 − 4 · (2 + 3).",
      "source": "Mathe.Logo 6, глава 1: Natürliche Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": -170,
      "y": 1110,
      "archived": false
    },
    {
      "id": "skill-1-8",
      "kind": "skill",
      "title": "Делители и кратные",
      "de": "Teilbarkeit",
      "description": "Находит делители и кратные; применяет признаки делимости.",
      "example": "Назови общие кратные 4 и 6; проверь делимость 345 на 3 и 5.",
      "source": "Mathe.Logo 6, глава 1: Natürliche Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 170,
      "y": 1110,
      "archived": false
    },
    {
      "id": "topic-2",
      "kind": "topic",
      "title": "Основы геометрии",
      "de": "Geometrische Grundbegriffe",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "Mathe.Logo 6 · Wirtschaftsschule Bayern · C.C.Buchner · 2021 · ISBN 978-3-7661-6237-3. Декомпозиция по присланному оглавлению; не единый стандарт всех школ. Глава 2.",
      "color": "blue",
      "x": 340,
      "y": 260,
      "archived": false
    },
    {
      "id": "skill-2-1",
      "kind": "skill",
      "title": "Длины и единицы",
      "de": "Längen",
      "description": "Переводит единицы длины и измеряет отрезки.",
      "example": "3,5 m = ? cm.",
      "source": "Mathe.Logo 6, глава 2: Geometrische Grundbegriffe. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": 170,
      "y": 510,
      "archived": false
    },
    {
      "id": "skill-2-2",
      "kind": "skill",
      "title": "Прямые и отрезки",
      "de": "Strecken und Geraden",
      "description": "Различает отрезок и прямую, обозначает точки и строит отрезки.",
      "example": "Построй отрезок AB длиной 5 cm.",
      "source": "Mathe.Logo 6, глава 2: Geometrische Grundbegriffe. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": 510,
      "y": 510,
      "archived": false
    },
    {
      "id": "skill-2-3",
      "kind": "skill",
      "title": "Параллельность и расстояние",
      "de": "Parallel, senkrecht, Abstand",
      "description": "Строит параллельные и перпендикулярные прямые; измеряет расстояние.",
      "example": "Построй перпендикуляр из точки к прямой.",
      "source": "Mathe.Logo 6, глава 2: Geometrische Grundbegriffe. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": 170,
      "y": 710,
      "archived": false
    },
    {
      "id": "skill-2-4",
      "kind": "skill",
      "title": "Масштаб",
      "de": "Maßstab",
      "description": "Связывает размер на плане с реальным размером.",
      "example": "На плане 1:100 стена имеет длину 4 cm. Какова реальная длина?",
      "source": "Mathe.Logo 6, глава 2: Geometrische Grundbegriffe. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": 510,
      "y": 710,
      "archived": false
    },
    {
      "id": "skill-2-5",
      "kind": "skill",
      "title": "Координаты",
      "de": "Koordinatensystem",
      "description": "Читает координаты и отмечает точки в изученной области плоскости.",
      "example": "Отметь A(2|3) и B(5|1).",
      "source": "Mathe.Logo 6, глава 2: Geometrische Grundbegriffe. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": 170,
      "y": 910,
      "archived": false
    },
    {
      "id": "skill-2-6",
      "kind": "skill",
      "title": "Виды углов",
      "de": "Winkel",
      "description": "Различает острый, прямой, тупой и развёрнутый углы.",
      "example": "Назови вид угла 125°.",
      "source": "Mathe.Logo 6, глава 2: Geometrische Grundbegriffe. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": 510,
      "y": 910,
      "archived": false
    },
    {
      "id": "skill-2-7",
      "kind": "skill",
      "title": "Измерение и построение углов",
      "de": "Winkel messen und zeichnen",
      "description": "Использует транспортир для измерения и построения углов.",
      "example": "Построй угол 65°.",
      "source": "Mathe.Logo 6, глава 2: Geometrische Grundbegriffe. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": 170,
      "y": 1110,
      "archived": false
    },
    {
      "id": "skill-2-8",
      "kind": "skill",
      "title": "Фигуры и окружность",
      "de": "Dreiecke, Vierecke, Kreise",
      "description": "Различает треугольники и четырёхугольники; находит радиус и диаметр, строит окружность.",
      "example": "Построй окружность радиуса 3 cm и укажи её диаметр.",
      "source": "Mathe.Logo 6, глава 2: Geometrische Grundbegriffe. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": 510,
      "y": 1110,
      "archived": false
    },
    {
      "id": "topic-3",
      "kind": "topic",
      "title": "Преобразования фигур",
      "de": "Geometrische Abbildungen",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "Mathe.Logo 6 · Wirtschaftsschule Bayern · C.C.Buchner · 2021 · ISBN 978-3-7661-6237-3. Декомпозиция по присланному оглавлению; не единый стандарт всех школ. Глава 3.",
      "color": "violet",
      "x": 680,
      "y": 260,
      "archived": false
    },
    {
      "id": "skill-3-1",
      "kind": "skill",
      "title": "Осевая симметрия",
      "de": "Achsensymmetrie",
      "description": "Находит ось симметрии и строит отражение фигуры.",
      "example": "Отрази треугольник относительно вертикальной прямой.",
      "source": "Mathe.Logo 6, глава 3: Geometrische Abbildungen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "violet",
      "x": 510,
      "y": 510,
      "archived": false
    },
    {
      "id": "skill-3-2",
      "kind": "skill",
      "title": "Центральная симметрия",
      "de": "Punktsymmetrie",
      "description": "Строит образ точки и фигуры относительно центра.",
      "example": "Построй точку A′, симметричную A относительно O.",
      "source": "Mathe.Logo 6, глава 3: Geometrische Abbildungen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "violet",
      "x": 850,
      "y": 510,
      "archived": false
    },
    {
      "id": "skill-3-3",
      "kind": "skill",
      "title": "Параллельный перенос",
      "de": "Verschiebung",
      "description": "Переносит все точки фигуры на одинаковое расстояние в заданном направлении.",
      "example": "Перенеси фигуру на 3 клетки вправо и 2 вверх.",
      "source": "Mathe.Logo 6, глава 3: Geometrische Abbildungen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "violet",
      "x": 510,
      "y": 710,
      "archived": false
    },
    {
      "id": "skill-3-4",
      "kind": "skill",
      "title": "Особые треугольники",
      "de": "Besondere Dreiecke",
      "description": "Определяет равнобедренный, равносторонний и прямоугольный треугольники по свойствам.",
      "example": "Какие стороны равны у равнобедренного треугольника?",
      "source": "Mathe.Logo 6, глава 3: Geometrische Abbildungen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "violet",
      "x": 850,
      "y": 710,
      "archived": false
    },
    {
      "id": "skill-3-5",
      "kind": "skill",
      "title": "Особые четырёхугольники",
      "de": "Besondere Vierecke",
      "description": "Классифицирует изученные четырёхугольники по сторонам, углам и симметриям.",
      "example": "Объясни, почему каждый квадрат является прямоугольником.",
      "source": "Mathe.Logo 6, глава 3: Geometrische Abbildungen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "violet",
      "x": 510,
      "y": 910,
      "archived": false
    },
    {
      "id": "topic-4",
      "kind": "topic",
      "title": "Целые числа",
      "de": "Ganze Zahlen",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "Mathe.Logo 6 · Wirtschaftsschule Bayern · C.C.Buchner · 2021 · ISBN 978-3-7661-6237-3. Декомпозиция по присланному оглавлению; не единый стандарт всех школ. Глава 4.",
      "color": "teal",
      "x": 1020,
      "y": 260,
      "archived": false
    },
    {
      "id": "skill-4-1",
      "kind": "skill",
      "title": "Отрицательные числа",
      "de": "Positive und negative Zahlen",
      "description": "Связывает отрицательные числа с температурой, высотой и числовой прямой.",
      "example": "Что означает температура −5 °C?",
      "source": "Mathe.Logo 6, глава 4: Ganze Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "teal",
      "x": 850,
      "y": 510,
      "archived": false
    },
    {
      "id": "skill-4-2",
      "kind": "skill",
      "title": "Модуль и противоположное число",
      "de": "Betrag und Gegenzahl",
      "description": "Находит противоположное число и расстояние числа до нуля.",
      "example": "Найди |−8| и число, противоположное −8.",
      "source": "Mathe.Logo 6, глава 4: Ganze Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "teal",
      "x": 1190,
      "y": 510,
      "archived": false
    },
    {
      "id": "skill-4-3",
      "kind": "skill",
      "title": "Сравнение целых",
      "de": "Ganze Zahlen ordnen",
      "description": "Сравнивает и упорядочивает целые числа, в том числе отрицательные.",
      "example": "Упорядочи −9, 3, −2, 0.",
      "source": "Mathe.Logo 6, глава 4: Ganze Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "teal",
      "x": 850,
      "y": 710,
      "archived": false
    },
    {
      "id": "skill-4-4",
      "kind": "skill",
      "title": "Сложение и вычитание целых",
      "de": "Ganze Zahlen addieren und subtrahieren",
      "description": "Объясняет и выполняет сложение и вычитание целых чисел.",
      "example": "−12 + 5; 4 − (−3).",
      "source": "Mathe.Logo 6, глава 4: Ganze Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "teal",
      "x": 1190,
      "y": 710,
      "archived": false
    },
    {
      "id": "skill-4-5",
      "kind": "skill",
      "title": "Умножение и деление целых",
      "de": "Ganze Zahlen multiplizieren und dividieren",
      "description": "Применяет правила знаков в умножении и делении.",
      "example": "(−6) · (−4); 28 : (−7).",
      "source": "Mathe.Logo 6, глава 4: Ganze Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "teal",
      "x": 850,
      "y": 910,
      "archived": false
    },
    {
      "id": "skill-4-6",
      "kind": "skill",
      "title": "Выражения со знаками",
      "de": "Rechengesetze mit ganzen Zahlen",
      "description": "Выполняет смешанные действия с целыми числами и скобками.",
      "example": "−3 · (5 − 9) − 7.",
      "source": "Mathe.Logo 6, глава 4: Ganze Zahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "teal",
      "x": 1190,
      "y": 910,
      "archived": false
    },
    {
      "id": "topic-5",
      "kind": "topic",
      "title": "Периметр и площадь",
      "de": "Umfang und Flächeninhalt",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "Mathe.Logo 6 · Wirtschaftsschule Bayern · C.C.Buchner · 2021 · ISBN 978-3-7661-6237-3. Декомпозиция по присланному оглавлению; не единый стандарт всех школ. Глава 5.",
      "color": "green",
      "x": 1360,
      "y": 260,
      "archived": false
    },
    {
      "id": "skill-5-1",
      "kind": "skill",
      "title": "Периметр",
      "de": "Umfang",
      "description": "Находит сумму длин всех сторон и отличает её от площади.",
      "example": "Найди периметр прямоугольника 7 m × 5 m.",
      "source": "Mathe.Logo 6, глава 5: Umfang und Flächeninhalt. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "green",
      "x": 1190,
      "y": 510,
      "archived": false
    },
    {
      "id": "skill-5-2",
      "kind": "skill",
      "title": "Смысл площади",
      "de": "Flächen vergleichen und messen",
      "description": "Сравнивает площади по единичным квадратам; объясняет квадратную единицу.",
      "example": "Нарисуй две разные фигуры площадью 12 клеток.",
      "source": "Mathe.Logo 6, глава 5: Umfang und Flächeninhalt. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "green",
      "x": 1530,
      "y": 510,
      "archived": false
    },
    {
      "id": "skill-5-3",
      "kind": "skill",
      "title": "Единицы площади",
      "de": "Flächeneinheiten",
      "description": "Переводит единицы площади, не путая их с единицами длины.",
      "example": "2 m² = ? cm².",
      "source": "Mathe.Logo 6, глава 5: Umfang und Flächeninhalt. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "green",
      "x": 1190,
      "y": 710,
      "archived": false
    },
    {
      "id": "skill-5-4",
      "kind": "skill",
      "title": "Площадь прямоугольника",
      "de": "Rechteck und Quadrat",
      "description": "Вычисляет площадь прямоугольника и квадрата, записывает единицы.",
      "example": "Сад 12 m × 4 m: сколько нужно газона и сколько ограждения?",
      "source": "Mathe.Logo 6, глава 5: Umfang und Flächeninhalt. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "green",
      "x": 1530,
      "y": 710,
      "archived": false
    },
    {
      "id": "topic-6",
      "kind": "topic",
      "title": "Геометрические тела",
      "de": "Raumgeometrie",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "Mathe.Logo 6 · Wirtschaftsschule Bayern · C.C.Buchner · 2021 · ISBN 978-3-7661-6237-3. Декомпозиция по присланному оглавлению; не единый стандарт всех школ. Глава 6.",
      "color": "blue",
      "x": 0,
      "y": 520,
      "archived": false
    },
    {
      "id": "skill-6-1",
      "kind": "skill",
      "title": "Тела и их элементы",
      "de": "Körper",
      "description": "Различает изученные тела; находит грани, рёбра и вершины.",
      "example": "Сколько граней, рёбер и вершин у куба?",
      "source": "Mathe.Logo 6, глава 6: Raumgeometrie. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": -170,
      "y": 770,
      "archived": false
    },
    {
      "id": "skill-6-2",
      "kind": "skill",
      "title": "Наглядный рисунок тела",
      "de": "Schrägbilder",
      "description": "Строит и читает наглядный рисунок куба и прямоугольного параллелепипеда.",
      "example": "Нарисуй прямоугольный параллелепипед, обозначь скрытые рёбра.",
      "source": "Mathe.Logo 6, глава 6: Raumgeometrie. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": 170,
      "y": 770,
      "archived": false
    },
    {
      "id": "skill-6-3",
      "kind": "skill",
      "title": "Смысл объёма",
      "de": "Volumen vergleichen und messen",
      "description": "Определяет объём через число единичных кубиков.",
      "example": "Каков объём тела из 24 кубиков по 1 cm³?",
      "source": "Mathe.Logo 6, глава 6: Raumgeometrie. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": -170,
      "y": 970,
      "archived": false
    },
    {
      "id": "skill-6-4",
      "kind": "skill",
      "title": "Единицы объёма",
      "de": "Volumeneinheiten",
      "description": "Переводит единицы объёма и связывает dm³ с литром.",
      "example": "2 dm³ = ? cm³ = ? l.",
      "source": "Mathe.Logo 6, глава 6: Raumgeometrie. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": 170,
      "y": 970,
      "archived": false
    },
    {
      "id": "skill-6-5",
      "kind": "skill",
      "title": "Объём параллелепипеда",
      "de": "Volumen von Quadern",
      "description": "Находит объём по трём измерениям, выбирает единицу.",
      "example": "Коробка 8 cm × 5 cm × 3 cm: найди объём.",
      "source": "Mathe.Logo 6, глава 6: Raumgeometrie. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": -170,
      "y": 1170,
      "archived": false
    },
    {
      "id": "skill-6-6",
      "kind": "skill",
      "title": "Развёртка и поверхность",
      "de": "Netze und Oberflächeninhalt",
      "description": "Распознаёт развёртки куба и параллелепипеда; суммирует площади граней.",
      "example": "Найди площадь поверхности куба с ребром 4 cm.",
      "source": "Mathe.Logo 6, глава 6: Raumgeometrie. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "blue",
      "x": 170,
      "y": 1170,
      "archived": false
    },
    {
      "id": "topic-7",
      "kind": "topic",
      "title": "Обыкновенные дроби",
      "de": "Brüche",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "Mathe.Logo 6 · Wirtschaftsschule Bayern · C.C.Buchner · 2021 · ISBN 978-3-7661-6237-3. Декомпозиция по присланному оглавлению; не единый стандарт всех школ. Глава 7.",
      "color": "orange",
      "x": 340,
      "y": 520,
      "archived": false
    },
    {
      "id": "skill-7-1",
      "kind": "skill",
      "title": "Доля и дробь",
      "de": "Bruchteile erkennen",
      "description": "Объясняет числитель и знаменатель, показывает дробь на рисунке.",
      "example": "Изобрази 3/4 круга и объясни числа 3 и 4.",
      "source": "Mathe.Logo 6, глава 7: Brüche. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 170,
      "y": 770,
      "archived": false
    },
    {
      "id": "skill-7-2",
      "kind": "skill",
      "title": "Дробь как число",
      "de": "Brüche darstellen",
      "description": "Отмечает дробь на прямой; связывает неправильную дробь и смешанное число.",
      "example": "Отметь 7/4 на прямой и запиши смешанным числом.",
      "source": "Mathe.Logo 6, глава 7: Brüche. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 510,
      "y": 770,
      "archived": false
    },
    {
      "id": "skill-7-3",
      "kind": "skill",
      "title": "Расширение дробей",
      "de": "Brüche erweitern",
      "description": "Умножает числитель и знаменатель на одно число, сохраняя значение дроби.",
      "example": "Представь 2/3 со знаменателем 12.",
      "source": "Mathe.Logo 6, глава 7: Brüche. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 170,
      "y": 970,
      "archived": false
    },
    {
      "id": "skill-7-4",
      "kind": "skill",
      "title": "Сокращение дробей",
      "de": "Brüche kürzen",
      "description": "Делит числитель и знаменатель на общий делитель и сокращает до конца.",
      "example": "Сократи 18/24.",
      "source": "Mathe.Logo 6, глава 7: Brüche. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 510,
      "y": 970,
      "archived": false
    },
    {
      "id": "skill-7-5",
      "kind": "skill",
      "title": "Сравнение дробей",
      "de": "Brüche ordnen",
      "description": "Сравнивает дроби с объяснением выбранного способа.",
      "example": "Сравни 3/4 и 5/6.",
      "source": "Mathe.Logo 6, глава 7: Brüche. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 170,
      "y": 1170,
      "archived": false
    },
    {
      "id": "skill-7-6",
      "kind": "skill",
      "title": "Одинаковые знаменатели",
      "de": "Gleichnamige Brüche addieren und subtrahieren",
      "description": "Складывает и вычитает дроби с одинаковыми знаменателями.",
      "example": "5/9 − 2/9.",
      "source": "Mathe.Logo 6, глава 7: Brüche. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 510,
      "y": 1170,
      "archived": false
    },
    {
      "id": "skill-7-7",
      "kind": "skill",
      "title": "Общий знаменатель",
      "de": "Gemeinsamer Nenner",
      "description": "Находит подходящий общий знаменатель и равные исходным дроби.",
      "example": "Приведи 1/4 и 1/6 к общему знаменателю.",
      "source": "Mathe.Logo 6, глава 7: Brüche. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 170,
      "y": 1370,
      "archived": false
    },
    {
      "id": "skill-7-8",
      "kind": "skill",
      "title": "Разные знаменатели",
      "de": "Ungleichnamige Brüche addieren und subtrahieren",
      "description": "Складывает и вычитает разноимённые дроби, сокращает результат.",
      "example": "2/3 + 1/6.",
      "source": "Mathe.Logo 6, глава 7: Brüche. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 510,
      "y": 1370,
      "archived": false
    },
    {
      "id": "skill-7-9",
      "kind": "skill",
      "title": "Умножение дробей",
      "de": "Brüche multiplizieren",
      "description": "Находит произведение дробей и дробь от величины.",
      "example": "3/5 · 10; 2/3 · 3/4.",
      "source": "Mathe.Logo 6, глава 7: Brüche. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 170,
      "y": 1570,
      "archived": false
    },
    {
      "id": "skill-7-10",
      "kind": "skill",
      "title": "Деление дробей и смешанные действия",
      "de": "Brüche dividieren; Rechenregeln",
      "description": "Использует обратную дробь при делении; соблюдает порядок действий.",
      "example": "3/4 : 1/2; (1/2 + 1/3) · 6.",
      "source": "Mathe.Logo 6, глава 7: Brüche. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "orange",
      "x": 510,
      "y": 1570,
      "archived": false
    },
    {
      "id": "topic-8",
      "kind": "topic",
      "title": "Десятичные дроби",
      "de": "Dezimalzahlen",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "Mathe.Logo 6 · Wirtschaftsschule Bayern · C.C.Buchner · 2021 · ISBN 978-3-7661-6237-3. Декомпозиция по присланному оглавлению; не единый стандарт всех школ. Глава 8.",
      "color": "teal",
      "x": 680,
      "y": 520,
      "archived": false
    },
    {
      "id": "skill-8-1",
      "kind": "skill",
      "title": "Разряды и связь с дробями",
      "de": "Dezimalzahlen darstellen",
      "description": "Читает десятичные дроби и переводит простые конечные дроби.",
      "example": "Запиши 3/4 десятичной дробью.",
      "source": "Mathe.Logo 6, глава 8: Dezimalzahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "teal",
      "x": 510,
      "y": 770,
      "archived": false
    },
    {
      "id": "skill-8-2",
      "kind": "skill",
      "title": "Сравнение и округление",
      "de": "Runden und Ordnen",
      "description": "Сравнивает десятичные дроби и округляет до заданного разряда.",
      "example": "Сравни 0,8 и 0,75; округли 3,476 до сотых.",
      "source": "Mathe.Logo 6, глава 8: Dezimalzahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "teal",
      "x": 850,
      "y": 770,
      "archived": false
    },
    {
      "id": "skill-8-3",
      "kind": "skill",
      "title": "Сложение и вычитание",
      "de": "Dezimalzahlen addieren und subtrahieren",
      "description": "Выполняет сложение и вычитание, соблюдая разряды.",
      "example": "12,4 − 3,78.",
      "source": "Mathe.Logo 6, глава 8: Dezimalzahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "teal",
      "x": 510,
      "y": 970,
      "archived": false
    },
    {
      "id": "skill-8-4",
      "kind": "skill",
      "title": "Умножение",
      "de": "Dezimalzahlen multiplizieren",
      "description": "Умножает десятичные дроби и проверяет положение запятой оценкой.",
      "example": "2,4 · 0,3.",
      "source": "Mathe.Logo 6, глава 8: Dezimalzahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "teal",
      "x": 850,
      "y": 970,
      "archived": false
    },
    {
      "id": "skill-8-5",
      "kind": "skill",
      "title": "Деление",
      "de": "Dezimalzahlen dividieren",
      "description": "Делит десятичные дроби на натуральные и десятичные числа.",
      "example": "7,2 : 3; 4,8 : 0,6.",
      "source": "Mathe.Logo 6, глава 8: Dezimalzahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "teal",
      "x": 510,
      "y": 1170,
      "archived": false
    },
    {
      "id": "skill-8-6",
      "kind": "skill",
      "title": "Смешанные действия",
      "de": "Rechenregeln",
      "description": "Решает выражения и практические задачи с десятичными дробями.",
      "example": "3 товара по 2,35 €: сколько сдачи с 10 €?",
      "source": "Mathe.Logo 6, глава 8: Dezimalzahlen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "teal",
      "x": 850,
      "y": 1170,
      "archived": false
    },
    {
      "id": "topic-9",
      "kind": "topic",
      "title": "Пропорциональные величины",
      "de": "Proportionale Größen",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "Mathe.Logo 6 · Wirtschaftsschule Bayern · C.C.Buchner · 2021 · ISBN 978-3-7661-6237-3. Декомпозиция по присланному оглавлению; не единый стандарт всех школ. Глава 9.",
      "color": "violet",
      "x": 1020,
      "y": 520,
      "archived": false
    },
    {
      "id": "skill-9-1",
      "kind": "skill",
      "title": "Зависимости и таблицы",
      "de": "Zusammenhänge erkennen",
      "description": "Читает таблицы величин и описывает закономерность.",
      "example": "Опиши, как стоимость зависит от числа одинаковых тетрадей.",
      "source": "Mathe.Logo 6, глава 9: Proportionale Größen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "violet",
      "x": 850,
      "y": 770,
      "archived": false
    },
    {
      "id": "skill-9-2",
      "kind": "skill",
      "title": "Прямая пропорциональность",
      "de": "Direkte Proportionalität",
      "description": "Распознаёт прямую пропорциональность и решает задачи через единицу.",
      "example": "4 тетради стоят 6 €. Сколько стоят 10?",
      "source": "Mathe.Logo 6, глава 9: Proportionale Größen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "violet",
      "x": 1190,
      "y": 770,
      "archived": false
    },
    {
      "id": "skill-9-3",
      "kind": "skill",
      "title": "Обратная пропорциональность",
      "de": "Indirekte Proportionalität",
      "description": "Распознаёт обратную пропорциональность при явно заданных постоянных условиях.",
      "example": "При равной производительности 3 насоса работают 8 часов. Сколько работают 6?",
      "source": "Mathe.Logo 6, глава 9: Proportionale Größen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "violet",
      "x": 850,
      "y": 970,
      "archived": false
    },
    {
      "id": "skill-9-4",
      "kind": "skill",
      "title": "Выбор модели",
      "de": "Proportional oder nicht?",
      "description": "Отличает прямую, обратную и непропорциональную зависимости.",
      "example": "Такси: 4 € посадка + 2 €/km. Пропорциональна ли цена расстоянию?",
      "source": "Mathe.Logo 6, глава 9: Proportionale Größen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "violet",
      "x": 1190,
      "y": 970,
      "archived": false
    },
    {
      "id": "topic-10",
      "kind": "topic",
      "title": "Выражения и уравнения",
      "de": "Terme und Gleichungen",
      "description": "Раздел программы. Откройте дочерние навыки.",
      "example": "",
      "source": "Mathe.Logo 6 · Wirtschaftsschule Bayern · C.C.Buchner · 2021 · ISBN 978-3-7661-6237-3. Декомпозиция по присланному оглавлению; не единый стандарт всех школ. Глава 10.",
      "color": "green",
      "x": 1360,
      "y": 520,
      "archived": false
    },
    {
      "id": "skill-10-1",
      "kind": "skill",
      "title": "Числовые выражения",
      "de": "Zahlterme",
      "description": "Переводит словесное описание в выражение и вычисляет значение.",
      "example": "Из 40 вычти произведение 3 и 7.",
      "source": "Mathe.Logo 6, глава 10: Terme und Gleichungen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "green",
      "x": 1190,
      "y": 770,
      "archived": false
    },
    {
      "id": "skill-10-2",
      "kind": "skill",
      "title": "Переменная и подстановка",
      "de": "Terme mit Variablen",
      "description": "Объясняет переменную и вычисляет значение выражения при подстановке.",
      "example": "Вычисли 3a + 2 при a = 4.",
      "source": "Mathe.Logo 6, глава 10: Terme und Gleichungen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "green",
      "x": 1530,
      "y": 770,
      "archived": false
    },
    {
      "id": "skill-10-3",
      "kind": "skill",
      "title": "Простые уравнения",
      "de": "Einfache Gleichungen",
      "description": "Находит неизвестное обратными действиями и проверяет подстановкой.",
      "example": "Реши 3x + 4 = 19 и выполни проверку.",
      "source": "Mathe.Logo 6, глава 10: Terme und Gleichungen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "green",
      "x": 1190,
      "y": 970,
      "archived": false
    },
    {
      "id": "skill-10-4",
      "kind": "skill",
      "title": "Уравнение из условия",
      "de": "Terme und Gleichungen in Sachaufgaben",
      "description": "Выделяет неизвестное, составляет простое уравнение и интерпретирует ответ.",
      "example": "Три одинаковых блокнота и ручка за 2 € стоят 14 €. Сколько стоит блокнот?",
      "source": "Mathe.Logo 6, глава 10: Terme und Gleichungen. Методическая декомпозиция, требуется подтверждение программы конкретной школы.",
      "color": "green",
      "x": 1530,
      "y": 970,
      "archived": false
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "grade6",
      "target": "topic-1",
      "kind": "contains"
    },
    {
      "id": "edge-2",
      "source": "topic-1",
      "target": "skill-1-1",
      "kind": "contains"
    },
    {
      "id": "edge-3",
      "source": "topic-1",
      "target": "skill-1-2",
      "kind": "contains"
    },
    {
      "id": "edge-4",
      "source": "topic-1",
      "target": "skill-1-3",
      "kind": "contains"
    },
    {
      "id": "edge-5",
      "source": "topic-1",
      "target": "skill-1-4",
      "kind": "contains"
    },
    {
      "id": "edge-6",
      "source": "topic-1",
      "target": "skill-1-5",
      "kind": "contains"
    },
    {
      "id": "edge-7",
      "source": "topic-1",
      "target": "skill-1-6",
      "kind": "contains"
    },
    {
      "id": "edge-8",
      "source": "topic-1",
      "target": "skill-1-7",
      "kind": "contains"
    },
    {
      "id": "edge-9",
      "source": "topic-1",
      "target": "skill-1-8",
      "kind": "contains"
    },
    {
      "id": "edge-10",
      "source": "grade6",
      "target": "topic-2",
      "kind": "contains"
    },
    {
      "id": "edge-11",
      "source": "topic-2",
      "target": "skill-2-1",
      "kind": "contains"
    },
    {
      "id": "edge-12",
      "source": "topic-2",
      "target": "skill-2-2",
      "kind": "contains"
    },
    {
      "id": "edge-13",
      "source": "topic-2",
      "target": "skill-2-3",
      "kind": "contains"
    },
    {
      "id": "edge-14",
      "source": "topic-2",
      "target": "skill-2-4",
      "kind": "contains"
    },
    {
      "id": "edge-15",
      "source": "topic-2",
      "target": "skill-2-5",
      "kind": "contains"
    },
    {
      "id": "edge-16",
      "source": "topic-2",
      "target": "skill-2-6",
      "kind": "contains"
    },
    {
      "id": "edge-17",
      "source": "topic-2",
      "target": "skill-2-7",
      "kind": "contains"
    },
    {
      "id": "edge-18",
      "source": "topic-2",
      "target": "skill-2-8",
      "kind": "contains"
    },
    {
      "id": "edge-19",
      "source": "grade6",
      "target": "topic-3",
      "kind": "contains"
    },
    {
      "id": "edge-20",
      "source": "topic-3",
      "target": "skill-3-1",
      "kind": "contains"
    },
    {
      "id": "edge-21",
      "source": "topic-3",
      "target": "skill-3-2",
      "kind": "contains"
    },
    {
      "id": "edge-22",
      "source": "topic-3",
      "target": "skill-3-3",
      "kind": "contains"
    },
    {
      "id": "edge-23",
      "source": "topic-3",
      "target": "skill-3-4",
      "kind": "contains"
    },
    {
      "id": "edge-24",
      "source": "topic-3",
      "target": "skill-3-5",
      "kind": "contains"
    },
    {
      "id": "edge-25",
      "source": "grade6",
      "target": "topic-4",
      "kind": "contains"
    },
    {
      "id": "edge-26",
      "source": "topic-4",
      "target": "skill-4-1",
      "kind": "contains"
    },
    {
      "id": "edge-27",
      "source": "topic-4",
      "target": "skill-4-2",
      "kind": "contains"
    },
    {
      "id": "edge-28",
      "source": "topic-4",
      "target": "skill-4-3",
      "kind": "contains"
    },
    {
      "id": "edge-29",
      "source": "topic-4",
      "target": "skill-4-4",
      "kind": "contains"
    },
    {
      "id": "edge-30",
      "source": "topic-4",
      "target": "skill-4-5",
      "kind": "contains"
    },
    {
      "id": "edge-31",
      "source": "topic-4",
      "target": "skill-4-6",
      "kind": "contains"
    },
    {
      "id": "edge-32",
      "source": "grade6",
      "target": "topic-5",
      "kind": "contains"
    },
    {
      "id": "edge-33",
      "source": "topic-5",
      "target": "skill-5-1",
      "kind": "contains"
    },
    {
      "id": "edge-34",
      "source": "topic-5",
      "target": "skill-5-2",
      "kind": "contains"
    },
    {
      "id": "edge-35",
      "source": "topic-5",
      "target": "skill-5-3",
      "kind": "contains"
    },
    {
      "id": "edge-36",
      "source": "topic-5",
      "target": "skill-5-4",
      "kind": "contains"
    },
    {
      "id": "edge-37",
      "source": "grade6",
      "target": "topic-6",
      "kind": "contains"
    },
    {
      "id": "edge-38",
      "source": "topic-6",
      "target": "skill-6-1",
      "kind": "contains"
    },
    {
      "id": "edge-39",
      "source": "topic-6",
      "target": "skill-6-2",
      "kind": "contains"
    },
    {
      "id": "edge-40",
      "source": "topic-6",
      "target": "skill-6-3",
      "kind": "contains"
    },
    {
      "id": "edge-41",
      "source": "topic-6",
      "target": "skill-6-4",
      "kind": "contains"
    },
    {
      "id": "edge-42",
      "source": "topic-6",
      "target": "skill-6-5",
      "kind": "contains"
    },
    {
      "id": "edge-43",
      "source": "topic-6",
      "target": "skill-6-6",
      "kind": "contains"
    },
    {
      "id": "edge-44",
      "source": "grade6",
      "target": "topic-7",
      "kind": "contains"
    },
    {
      "id": "edge-45",
      "source": "topic-7",
      "target": "skill-7-1",
      "kind": "contains"
    },
    {
      "id": "edge-46",
      "source": "topic-7",
      "target": "skill-7-2",
      "kind": "contains"
    },
    {
      "id": "edge-47",
      "source": "topic-7",
      "target": "skill-7-3",
      "kind": "contains"
    },
    {
      "id": "edge-48",
      "source": "topic-7",
      "target": "skill-7-4",
      "kind": "contains"
    },
    {
      "id": "edge-49",
      "source": "topic-7",
      "target": "skill-7-5",
      "kind": "contains"
    },
    {
      "id": "edge-50",
      "source": "topic-7",
      "target": "skill-7-6",
      "kind": "contains"
    },
    {
      "id": "edge-51",
      "source": "topic-7",
      "target": "skill-7-7",
      "kind": "contains"
    },
    {
      "id": "edge-52",
      "source": "topic-7",
      "target": "skill-7-8",
      "kind": "contains"
    },
    {
      "id": "edge-53",
      "source": "topic-7",
      "target": "skill-7-9",
      "kind": "contains"
    },
    {
      "id": "edge-54",
      "source": "topic-7",
      "target": "skill-7-10",
      "kind": "contains"
    },
    {
      "id": "edge-55",
      "source": "grade6",
      "target": "topic-8",
      "kind": "contains"
    },
    {
      "id": "edge-56",
      "source": "topic-8",
      "target": "skill-8-1",
      "kind": "contains"
    },
    {
      "id": "edge-57",
      "source": "topic-8",
      "target": "skill-8-2",
      "kind": "contains"
    },
    {
      "id": "edge-58",
      "source": "topic-8",
      "target": "skill-8-3",
      "kind": "contains"
    },
    {
      "id": "edge-59",
      "source": "topic-8",
      "target": "skill-8-4",
      "kind": "contains"
    },
    {
      "id": "edge-60",
      "source": "topic-8",
      "target": "skill-8-5",
      "kind": "contains"
    },
    {
      "id": "edge-61",
      "source": "topic-8",
      "target": "skill-8-6",
      "kind": "contains"
    },
    {
      "id": "edge-62",
      "source": "grade6",
      "target": "topic-9",
      "kind": "contains"
    },
    {
      "id": "edge-63",
      "source": "topic-9",
      "target": "skill-9-1",
      "kind": "contains"
    },
    {
      "id": "edge-64",
      "source": "topic-9",
      "target": "skill-9-2",
      "kind": "contains"
    },
    {
      "id": "edge-65",
      "source": "topic-9",
      "target": "skill-9-3",
      "kind": "contains"
    },
    {
      "id": "edge-66",
      "source": "topic-9",
      "target": "skill-9-4",
      "kind": "contains"
    },
    {
      "id": "edge-67",
      "source": "grade6",
      "target": "topic-10",
      "kind": "contains"
    },
    {
      "id": "edge-68",
      "source": "topic-10",
      "target": "skill-10-1",
      "kind": "contains"
    },
    {
      "id": "edge-69",
      "source": "topic-10",
      "target": "skill-10-2",
      "kind": "contains"
    },
    {
      "id": "edge-70",
      "source": "topic-10",
      "target": "skill-10-3",
      "kind": "contains"
    },
    {
      "id": "edge-71",
      "source": "topic-10",
      "target": "skill-10-4",
      "kind": "contains"
    },
    {
      "id": "edge-72",
      "source": "skill-1-4",
      "target": "skill-1-8",
      "kind": "prerequisite"
    },
    {
      "id": "edge-73",
      "source": "skill-1-8",
      "target": "skill-7-4",
      "kind": "prerequisite"
    },
    {
      "id": "edge-74",
      "source": "skill-7-1",
      "target": "skill-7-2",
      "kind": "prerequisite"
    },
    {
      "id": "edge-75",
      "source": "skill-7-1",
      "target": "skill-7-3",
      "kind": "prerequisite"
    },
    {
      "id": "edge-76",
      "source": "skill-7-1",
      "target": "skill-7-4",
      "kind": "prerequisite"
    },
    {
      "id": "edge-77",
      "source": "skill-7-1",
      "target": "skill-7-6",
      "kind": "prerequisite"
    },
    {
      "id": "edge-78",
      "source": "skill-7-3",
      "target": "skill-7-7",
      "kind": "prerequisite"
    },
    {
      "id": "edge-79",
      "source": "skill-1-8",
      "target": "skill-7-7",
      "kind": "prerequisite"
    },
    {
      "id": "edge-80",
      "source": "skill-7-7",
      "target": "skill-7-5",
      "kind": "prerequisite"
    },
    {
      "id": "edge-81",
      "source": "skill-7-6",
      "target": "skill-7-8",
      "kind": "prerequisite"
    },
    {
      "id": "edge-82",
      "source": "skill-7-7",
      "target": "skill-7-8",
      "kind": "prerequisite"
    },
    {
      "id": "edge-83",
      "source": "skill-7-4",
      "target": "skill-7-8",
      "kind": "prerequisite"
    },
    {
      "id": "edge-84",
      "source": "skill-7-4",
      "target": "skill-7-9",
      "kind": "prerequisite"
    },
    {
      "id": "edge-85",
      "source": "skill-7-9",
      "target": "skill-7-10",
      "kind": "prerequisite"
    },
    {
      "id": "edge-86",
      "source": "skill-2-1",
      "target": "skill-5-1",
      "kind": "prerequisite"
    },
    {
      "id": "edge-87",
      "source": "skill-5-2",
      "target": "skill-5-3",
      "kind": "prerequisite"
    },
    {
      "id": "edge-88",
      "source": "skill-5-2",
      "target": "skill-5-4",
      "kind": "prerequisite"
    },
    {
      "id": "edge-89",
      "source": "skill-6-3",
      "target": "skill-6-4",
      "kind": "prerequisite"
    },
    {
      "id": "edge-90",
      "source": "skill-6-3",
      "target": "skill-6-5",
      "kind": "prerequisite"
    },
    {
      "id": "edge-91",
      "source": "skill-5-4",
      "target": "skill-6-6",
      "kind": "prerequisite"
    },
    {
      "id": "edge-92",
      "source": "skill-4-1",
      "target": "skill-4-3",
      "kind": "prerequisite"
    },
    {
      "id": "edge-93",
      "source": "skill-4-3",
      "target": "skill-4-4",
      "kind": "prerequisite"
    },
    {
      "id": "edge-94",
      "source": "skill-4-5",
      "target": "skill-4-6",
      "kind": "prerequisite"
    },
    {
      "id": "edge-95",
      "source": "skill-8-1",
      "target": "skill-8-2",
      "kind": "prerequisite"
    },
    {
      "id": "edge-96",
      "source": "skill-8-1",
      "target": "skill-8-3",
      "kind": "prerequisite"
    },
    {
      "id": "edge-97",
      "source": "skill-8-4",
      "target": "skill-8-5",
      "kind": "prerequisite"
    },
    {
      "id": "edge-98",
      "source": "skill-9-1",
      "target": "skill-9-2",
      "kind": "prerequisite"
    },
    {
      "id": "edge-99",
      "source": "skill-9-1",
      "target": "skill-9-3",
      "kind": "prerequisite"
    },
    {
      "id": "edge-100",
      "source": "skill-10-2",
      "target": "skill-10-3",
      "kind": "prerequisite"
    },
    {
      "id": "edge-101",
      "source": "skill-10-3",
      "target": "skill-10-4",
      "kind": "prerequisite"
    }
  ]
}$seed$::jsonb);
INSERT INTO skill_board_revisions(board_id, revision, data, updated_at)
 SELECT id, revision, data, updated_at FROM skill_boards WHERE id='grade-6';
