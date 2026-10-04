"""One-time, reviewable grade-six seed and additive route integration.
Never overwrites an existing migration; never connects to a database.
"""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
TOPICS=[
["Натуральные числа","Natürliche Zahlen","orange",[
["Разряды и сравнение","Stellenwert und Ordnen","Читает, записывает и сравнивает натуральные числа по разрядам.","Запиши число: 4 сотни тысяч + 7 сотен + 3 единицы."],
["Округление и оценка","Runden und Überschlagen","Округляет до указанного разряда и оценивает разумность ответа.","Округли 48 761 до тысяч."],
["Сложение и вычитание","Addieren und Subtrahieren","Самостоятельно складывает и вычитает многозначные числа.","6 305 − 2 978."],
["Умножение и деление","Multiplizieren und Dividieren","Выполняет умножение и деление натуральных чисел, проверяет обратным действием.","4 368 : 24."],
["Степени","Potenzen","Объясняет степень как повторное умножение и вычисляет простые степени.","Объясни разницу между 3² и 3 · 2."],
["Систематический перебор","Kombinieren","Находит все варианты в простой задаче без пропусков и повторов.","3 футболки и 2 пары брюк: сколько комплектов?"],
["Порядок действий","Rechengesetze","Соблюдает скобки и приоритет операций; использует удобные способы вычисления.","36 − 4 · (2 + 3)."],
["Делители и кратные","Teilbarkeit","Находит делители и кратные; применяет признаки делимости.","Назови общие кратные 4 и 6; проверь делимость 345 на 3 и 5."]]],
["Основы геометрии","Geometrische Grundbegriffe","blue",[
["Длины и единицы","Längen","Переводит единицы длины и измеряет отрезки.","3,5 m = ? cm."],
["Прямые и отрезки","Strecken und Geraden","Различает отрезок и прямую, обозначает точки и строит отрезки.","Построй отрезок AB длиной 5 cm."],
["Параллельность и расстояние","Parallel, senkrecht, Abstand","Строит параллельные и перпендикулярные прямые; измеряет расстояние.","Построй перпендикуляр из точки к прямой."],
["Масштаб","Maßstab","Связывает размер на плане с реальным размером.","На плане 1:100 стена имеет длину 4 cm. Какова реальная длина?"],
["Координаты","Koordinatensystem","Читает координаты и отмечает точки в изученной области плоскости.","Отметь A(2|3) и B(5|1)."],
["Виды углов","Winkel","Различает острый, прямой, тупой и развёрнутый углы.","Назови вид угла 125°."],
["Измерение и построение углов","Winkel messen und zeichnen","Использует транспортир для измерения и построения углов.","Построй угол 65°."],
["Фигуры и окружность","Dreiecke, Vierecke, Kreise","Различает треугольники и четырёхугольники; находит радиус и диаметр, строит окружность.","Построй окружность радиуса 3 cm и укажи её диаметр."]]],
["Преобразования фигур","Geometrische Abbildungen","violet",[
["Осевая симметрия","Achsensymmetrie","Находит ось симметрии и строит отражение фигуры.","Отрази треугольник относительно вертикальной прямой."],
["Центральная симметрия","Punktsymmetrie","Строит образ точки и фигуры относительно центра.","Построй точку A′, симметричную A относительно O."],
["Параллельный перенос","Verschiebung","Переносит все точки фигуры на одинаковое расстояние в заданном направлении.","Перенеси фигуру на 3 клетки вправо и 2 вверх."],
["Особые треугольники","Besondere Dreiecke","Определяет равнобедренный, равносторонний и прямоугольный треугольники по свойствам.","Какие стороны равны у равнобедренного треугольника?"],
["Особые четырёхугольники","Besondere Vierecke","Классифицирует изученные четырёхугольники по сторонам, углам и симметриям.","Объясни, почему каждый квадрат является прямоугольником."]]],
["Целые числа","Ganze Zahlen","teal",[
["Отрицательные числа","Positive und negative Zahlen","Связывает отрицательные числа с температурой, высотой и числовой прямой.","Что означает температура −5 °C?"],
["Модуль и противоположное число","Betrag und Gegenzahl","Находит противоположное число и расстояние числа до нуля.","Найди |−8| и число, противоположное −8."],
["Сравнение целых","Ganze Zahlen ordnen","Сравнивает и упорядочивает целые числа, в том числе отрицательные.","Упорядочи −9, 3, −2, 0."],
["Сложение и вычитание целых","Ganze Zahlen addieren und subtrahieren","Объясняет и выполняет сложение и вычитание целых чисел.","−12 + 5; 4 − (−3)."],
["Умножение и деление целых","Ganze Zahlen multiplizieren und dividieren","Применяет правила знаков в умножении и делении.","(−6) · (−4); 28 : (−7)."],
["Выражения со знаками","Rechengesetze mit ganzen Zahlen","Выполняет смешанные действия с целыми числами и скобками.","−3 · (5 − 9) − 7."]]],
["Периметр и площадь","Umfang und Flächeninhalt","green",[
["Периметр","Umfang","Находит сумму длин всех сторон и отличает её от площади.","Найди периметр прямоугольника 7 m × 5 m."],
["Смысл площади","Flächen vergleichen und messen","Сравнивает площади по единичным квадратам; объясняет квадратную единицу.","Нарисуй две разные фигуры площадью 12 клеток."],
["Единицы площади","Flächeneinheiten","Переводит единицы площади, не путая их с единицами длины.","2 m² = ? cm²."],
["Площадь прямоугольника","Rechteck und Quadrat","Вычисляет площадь прямоугольника и квадрата, записывает единицы.","Сад 12 m × 4 m: сколько нужно газона и сколько ограждения?"]]],
["Геометрические тела","Raumgeometrie","blue",[
["Тела и их элементы","Körper","Различает изученные тела; находит грани, рёбра и вершины.","Сколько граней, рёбер и вершин у куба?"],
["Наглядный рисунок тела","Schrägbilder","Строит и читает наглядный рисунок куба и прямоугольного параллелепипеда.","Нарисуй прямоугольный параллелепипед, обозначь скрытые рёбра."],
["Смысл объёма","Volumen vergleichen und messen","Определяет объём через число единичных кубиков.","Каков объём тела из 24 кубиков по 1 cm³?"],
["Единицы объёма","Volumeneinheiten","Переводит единицы объёма и связывает dm³ с литром.","2 dm³ = ? cm³ = ? l."],
["Объём параллелепипеда","Volumen von Quadern","Находит объём по трём измерениям, выбирает единицу.","Коробка 8 cm × 5 cm × 3 cm: найди объём."],
["Развёртка и поверхность","Netze und Oberflächeninhalt","Распознаёт развёртки куба и параллелепипеда; суммирует площади граней.","Найди площадь поверхности куба с ребром 4 cm."]]],
["Обыкновенные дроби","Brüche","orange",[
["Доля и дробь","Bruchteile erkennen","Объясняет числитель и знаменатель, показывает дробь на рисунке.","Изобрази 3/4 круга и объясни числа 3 и 4."],
["Дробь как число","Brüche darstellen","Отмечает дробь на прямой; связывает неправильную дробь и смешанное число.","Отметь 7/4 на прямой и запиши смешанным числом."],
["Расширение дробей","Brüche erweitern","Умножает числитель и знаменатель на одно число, сохраняя значение дроби.","Представь 2/3 со знаменателем 12."],
["Сокращение дробей","Brüche kürzen","Делит числитель и знаменатель на общий делитель и сокращает до конца.","Сократи 18/24."],
["Сравнение дробей","Brüche ordnen","Сравнивает дроби с объяснением выбранного способа.","Сравни 3/4 и 5/6."],
["Одинаковые знаменатели","Gleichnamige Brüche addieren und subtrahieren","Складывает и вычитает дроби с одинаковыми знаменателями.","5/9 − 2/9."],
["Общий знаменатель","Gemeinsamer Nenner","Находит подходящий общий знаменатель и равные исходным дроби.","Приведи 1/4 и 1/6 к общему знаменателю."],
["Разные знаменатели","Ungleichnamige Brüche addieren und subtrahieren","Складывает и вычитает разноимённые дроби, сокращает результат.","2/3 + 1/6."],
["Умножение дробей","Brüche multiplizieren","Находит произведение дробей и дробь от величины.","3/5 · 10; 2/3 · 3/4."],
["Деление дробей и смешанные действия","Brüche dividieren; Rechenregeln","Использует обратную дробь при делении; соблюдает порядок действий.","3/4 : 1/2; (1/2 + 1/3) · 6."]]],
["Десятичные дроби","Dezimalzahlen","teal",[
["Разряды и связь с дробями","Dezimalzahlen darstellen","Читает десятичные дроби и переводит простые конечные дроби.","Запиши 3/4 десятичной дробью."],
["Сравнение и округление","Runden und Ordnen","Сравнивает десятичные дроби и округляет до заданного разряда.","Сравни 0,8 и 0,75; округли 3,476 до сотых."],
["Сложение и вычитание","Dezimalzahlen addieren und subtrahieren","Выполняет сложение и вычитание, соблюдая разряды.","12,4 − 3,78."],
["Умножение","Dezimalzahlen multiplizieren","Умножает десятичные дроби и проверяет положение запятой оценкой.","2,4 · 0,3."],
["Деление","Dezimalzahlen dividieren","Делит десятичные дроби на натуральные и десятичные числа.","7,2 : 3; 4,8 : 0,6."],
["Смешанные действия","Rechenregeln","Решает выражения и практические задачи с десятичными дробями.","3 товара по 2,35 €: сколько сдачи с 10 €?"]]],
["Пропорциональные величины","Proportionale Größen","violet",[
["Зависимости и таблицы","Zusammenhänge erkennen","Читает таблицы величин и описывает закономерность.","Опиши, как стоимость зависит от числа одинаковых тетрадей."],
["Прямая пропорциональность","Direkte Proportionalität","Распознаёт прямую пропорциональность и решает задачи через единицу.","4 тетради стоят 6 €. Сколько стоят 10?"],
["Обратная пропорциональность","Indirekte Proportionalität","Распознаёт обратную пропорциональность при явно заданных постоянных условиях.","При равной производительности 3 насоса работают 8 часов. Сколько работают 6?"],
["Выбор модели","Proportional oder nicht?","Отличает прямую, обратную и непропорциональную зависимости.","Такси: 4 € посадка + 2 €/km. Пропорциональна ли цена расстоянию?"]]],
["Выражения и уравнения","Terme und Gleichungen","green",[
["Числовые выражения","Zahlterme","Переводит словесное описание в выражение и вычисляет значение.","Из 40 вычти произведение 3 и 7."],
["Переменная и подстановка","Terme mit Variablen","Объясняет переменную и вычисляет значение выражения при подстановке.","Вычисли 3a + 2 при a = 4."],
["Простые уравнения","Einfache Gleichungen","Находит неизвестное обратными действиями и проверяет подстановкой.","Реши 3x + 4 = 19 и выполни проверку."],
["Уравнение из условия","Terme und Gleichungen in Sachaufgaben","Выделяет неизвестное, составляет простое уравнение и интерпретирует ответ.","Три одинаковых блокнота и ручка за 2 € стоят 14 €. Сколько стоит блокнот?"]]]]
SOURCE="Mathe.Logo 6 · Wirtschaftsschule Bayern · C.C.Buchner · 2021 · ISBN 978-3-7661-6237-3. Декомпозиция по присланному оглавлению; не единый стандарт всех школ."
def make_node(id,kind,title,de,description,example,source,color,x,y):
    return dict(id=id,kind=kind,title=title,de=de,description=description,example=example,source=source,color=color,x=x,y=y,archived=False)
nodes=[make_node('grade6','root','Математика — 6 класс','Mathematik · Klasse 6','Редактируемый черновик программы. Werkrealschule ещё не сверена.','',SOURCE,'orange',650,0)]
edges=[]
def edge(source,target,kind='contains'):
    edges.append(dict(id=f'edge-{len(edges)+1}',source=source,target=target,kind=kind))
for i,(title,de,color,skills) in enumerate(TOPICS,1):
    tid=f'topic-{i}';x=((i-1)%5)*340;y=260+((i-1)//5)*260
    nodes.append(make_node(tid,'topic',title,de,'Раздел программы. Откройте дочерние навыки.','',f'{SOURCE} Глава {i}.',color,x,y));edge('grade6',tid)
    for j,(name,german,description,example) in enumerate(skills):
        sid=f'skill-{i}-{j+1}'
        nodes.append(make_node(sid,'skill',name,german,description,example,f'Mathe.Logo 6, глава {i}: {de}. Методическая декомпозиция, требуется подтверждение программы конкретной школы.',color,x+(j%2)*340-170,y+250+(j//2)*200));edge(tid,sid)
for source,target in [('1-4','1-8'),('1-8','7-4'),('7-1','7-2'),('7-1','7-3'),('7-1','7-4'),('7-1','7-6'),('7-3','7-7'),('1-8','7-7'),('7-7','7-5'),('7-6','7-8'),('7-7','7-8'),('7-4','7-8'),('7-4','7-9'),('7-9','7-10'),('2-1','5-1'),('5-2','5-3'),('5-2','5-4'),('6-3','6-4'),('6-3','6-5'),('5-4','6-6'),('4-1','4-3'),('4-3','4-4'),('4-5','4-6'),('8-1','8-2'),('8-1','8-3'),('8-4','8-5'),('9-1','9-2'),('9-1','9-3'),('10-2','10-3'),('10-3','10-4')]:
    edge('skill-'+source,'skill-'+target,'prerequisite')
board=dict(schemaVersion=1,title='Математика — навыки к концу 6 класса',grade=6,source=SOURCE,nodes=nodes,edges=edges)
migration=ROOT/'backend/src/main/resources/db/migration/V65__add_skill_boards.sql'
if not migration.exists():
    migration.write_text('''-- Additive curriculum catalog: no pupil records are modified.
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
INSERT INTO skill_boards(id, data) VALUES ('grade-6', $seed$'''+json.dumps(board,ensure_ascii=False,indent=2)+'''$seed$::jsonb);
INSERT INTO skill_board_revisions(board_id, revision, data, updated_at)
 SELECT id, revision, data, updated_at FROM skill_boards WHERE id='grade-6';
''',encoding='utf-8')
app=ROOT/'frontend/src/App.tsx';text=app.read_text()
if "from './pages/SkillsPage'" not in text:
    text="import { SkillsPage } from './pages/SkillsPage';\n"+text
if 'path="/skills"' not in text:
    anchor='    <Routes>'
    assert text.count(anchor)==1,'Route anchor changed; review instead of guessing'
    text=text.replace(anchor,anchor+'\n      <Route path="/skills" element={<ProtectedRoute><Layout><SkillsPage /></Layout></ProtectedRoute>} />')
app.write_text(text,encoding='utf-8')
layout=ROOT/'frontend/src/components/Layout.tsx';text=layout.read_text()
if "to: '/skills'" not in text:
    teacher="      { to: '/teacher/lessons', label: 'Уроки' },"
    admin="            { to: '/admin/prompts', label: language === 'DE' ? 'Prompts' : 'Промты школы' },"
    assert text.count(teacher)==1 and text.count(admin)==1,'Menu anchors changed; review instead of guessing'
    text=text.replace(teacher,teacher+"\n      { to: '/skills', label: 'Навыки' },")
    text=text.replace(admin,admin+"\n            { to: '/skills', label: language === 'DE' ? 'Kompetenzen' : 'Навыки' },")
layout.write_text(text,encoding='utf-8')
print(f'Prepared grade-6 curriculum: {len(nodes)} cards, {len(edges)} typed arrows; route and menus integrated.')
