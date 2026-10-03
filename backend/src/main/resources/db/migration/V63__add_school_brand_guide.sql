CREATE TABLE school_brand_guide (
    id SMALLINT PRIMARY KEY,
    guide_text TEXT NOT NULL,
    pdf_filename VARCHAR(255),
    pdf_content_type VARCHAR(100),
    pdf_data BYTEA,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version BIGINT NOT NULL DEFAULT 0
);

INSERT INTO school_brand_guide (
    id,
    guide_text,
    pdf_filename,
    pdf_content_type,
    pdf_data,
    updated_at,
    version
) VALUES (
    1,
    'MINDCRAFTI SCHOOL — Brand Guide
Единые правила визуального стиля школы

ГЛАВНОЕ ПРАВИЛО
Официальный логотип Mindcrafti School — только утверждённая оранжевая буква M из Brand Kit. Логотип не генерируем заново, не перерисовываем и не заменяем похожими вариантами.

1. Официальный логотип
Знак Mindcrafti School — оранжевая буква M, сформированная двумя пересекающимися лентами. Это основной визуальный идентификатор школы во всех цифровых и печатных материалах.
На белом фоне: документы, отчёты, домашние задания, презентации, Instagram.
Transparent: сайт, дизайн-макеты и цветные фоны с достаточным контрастом.

2. Свободное пространство и размер
Вокруг логотипа оставляем свободное пространство не меньше примерно 1/4 высоты буквы M. Логотип должен быть заметным, но не доминировать над содержанием документа.
Минимальный практический размер: 24 px для интерфейсов и 10 мм для печати. Если M начинает терять читаемость, используем более крупный размер.

3. Цветовая система
Основной стиль Mindcrafti — чистый белый фон, тёмный текст и оранжевый акцент. Оранжевый используется выборочно: для логотипа, кнопок, ключевых цифр и небольших акцентов.
Orange Primary #FF6A00 — главный бренд-акцент.
Orange Light #FF8A1D — градиенты и мягкие акценты.
Orange Soft #FFF3E8 — светлые фоновые блоки.
Navy Text #070A20 — заголовки и основной текст.
Gray Text #6B7280 — вторичный текст.
Line Gray #E5E7EB — разделители и границы.
White #FFFFFF — основной фон.

4. Типографика
Основной шрифт: Inter. Для Word/PDF, если Inter недоступен, используем Arial. Для интерфейсов: system-ui / Segoe UI / Arial как запасные варианты.
H1: заголовок документа — 24–32 pt, Bold.
H2: название раздела — 16–20 pt, Bold.
Body: основной текст — 10.5–12 pt, Regular.

5. Какой файл брать
Instagram профиль: 05_social/Mindcrafti_Logo_M_Instagram_Profile_1080x1080.png
Документы / PDF: 01_logo/Mindcrafti_Logo_M_MASTER_white_1536.png
Дизайн / цветной фон: 01_logo/Mindcrafti_Logo_M_MASTER_transparent_1536.png
Сайт: 04_site_assets/Mindcrafti_Logo_M_SITE.svg
Favicon: 04_site_assets/favicon.ico
PWA / Android: 04_site_assets/Mindcrafti_Logo_M_PWA_192.png + Web_512.png

6. Что запрещено
Не растягивать логотип по ширине или высоте.
Не менять оранжевую палитру на случайные цвета.
Не добавлять тени, обводки, рамки, 3D-эффекты или свечение.
Не менять форму буквы M и не перестраивать пересечение лент.
Не брать логотип со скриншота сайта, Instagram или телефона.
Не использовать старые версии, если они не находятся в текущем Brand Kit.

7. Шаблоны школы
Новые материалы создаются не с пустого листа, а на основе утверждённых шаблонов. Это сохраняет единый стиль и ускоряет работу команды.
Отчёт родителю: 03_templates/docs/Mindcrafti_Template_Parent_Report.docx
Домашнее задание: 03_templates/docs/Mindcrafti_Template_Homework_7_Days.docx
Диагностика: 03_templates/docs/Mindcrafti_Template_Diagnostics.docx
Внутренний документ: 03_templates/docs/Mindcrafti_Template_Internal_Document.docx
Презентация: 03_templates/slides/Mindcrafti_Template_Presentation.pptx
Таблица / трекинг: 03_templates/sheets/Mindcrafti_Template_Tracking.xlsx

8. Instagram и сайт
Instagram: профиль, Highlights, истории, кейсы, отзывы и карточки преподавателей должны использовать одинаковую оранжевую палитру, чистый фон, простые иконки и утверждённую M. Не смешиваем несколько визуальных стилей в одном профиле.
Сайт: все страницы должны ссылаться на один master-файл логотипа в assets/brand/. Для favicon, Apple Touch Icon и PWA используются отдельные подготовленные размеры из Site Assets.

ПРАВИЛО ДЛЯ КОМАНДЫ
Любой новый документ, PDF, презентация, отчёт, домашнее задание, история, рекламный материал или страница сайта Mindcrafti начинается с Brand Kit. Если нужен новый размер — создаём его из MASTER-файла, а не генерируем новый логотип.

Версия Brand Guide: 23.09.2026',
    NULL,
    NULL,
    NULL,
    NOW(),
    0
);
