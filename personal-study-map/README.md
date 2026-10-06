# Personal Study Map

Личная статическая карта знаний для подготовки к экзаменам.

## Как устроено

Сайт полностью статический. Данные лежат в `data/study.json`.

Основная модель:

- semester
- exam
- topic
- skill
- relation
- evidence
- session

Процент навыка хранится в поле `mastery` от 0 до 100.

## Как обновлять

После учебной сессии ChatGPT анализирует ответы, домашние задания, конспекты и другие доказательства, затем:

1. обновляет `mastery` только у реально проверенных навыков;
2. добавляет `evidence`;
3. добавляет запись в `sessions`;
4. при необходимости создаёт новые темы, навыки и связи;
5. обновляет `updatedAt`.

## Пример экзамена

```json
{
  "id": "exam-math-1",
  "title": "Mathematik",
  "date": "2027-02-10",
  "weight": 1,
  "topics": [
    { "id": "topic-1", "title": "Ableitungen" }
  ],
  "skills": [
    {
      "id": "skill-1",
      "topicId": "topic-1",
      "title": "Kettenregel",
      "subtitle": "Chain rule",
      "description": "Производить сложные функции и выбирать внутреннюю функцию.",
      "mastery": 55,
      "weight": 1,
      "lastUpdated": "2026-10-06",
      "x": 100,
      "y": 100,
      "evidence": []
    }
  ],
  "relations": []
}
```

## Запуск локально

Открой папку через любой простой static server, например VS Code Live Server.

Публичная версия разворачивается автоматически из ветки `personal-study-map`.
