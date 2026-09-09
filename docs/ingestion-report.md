# Ingestion report

## איך לקרוא את הדוח

דוח זה נוצר אוטומטית מתהליך קליטת קובצי האקסל, ומיועד לבדיקה מול הקבצים המקוריים.

- **unknown (לא מזוהה)** — קטע טבלה ללא שורת כותרת. המערכת נמנעת במכוון מלנחש סיווג כשאין לה על סמך מה, ולא מדובר בתקלה. ברוב המקרים אלה שורות סיכום/סה״כ בודדות שנשארו מבודדות אחרי זיהוי גבולות הטבלאות בגיליון.
- **רמת ביטחון (confidence) מתחת ל-0.50** — הסיווג אינו ודאי מספיק, והבלוק מסומן אוטומטית לבדיקה ידנית לפני שהוא נחשב מאושר; הוא לא נקלט כעובדה בלי בדיקה.
- כל שורה מפרטת את הגיליון, טווח התאים (בסימון A1 הרגיל, לחיפוש ישיר בקובץ המקורי), הסיווג שזוהה ורמת הביטחון.

## קופת קאמפ 23'-24'.xlsx

- sheets: 8
- blocks: 10
- needs review: 5

| sheet | range | archetype | confidence |
| --- | --- | --- | --- |
| Shliff day2day spending | A1:D33 | ledger | 1.00 |
| Shliff day2day spending | B38:D38 | unknown | 0.00 |
| מסיבת חורשה | A1:D8 | ledger | 0.17 |
| Shliff Gagarin 20.01 | A1:H31 | ticket_rounds | 0.49 |
| Shliff Spring #2 אצל אסף | A1:I26 | ticket_rounds | 0.71 |
| Shliff Collabo #3 | A1:E32 | ticket_rounds | 0.71 |
| שליף בצרה 08.08 | A1:D21 | event_lines | 0.71 |
| שליף בצרה 08.08 | C24:D24 | unknown | 0.00 |
| Shliff Deco 24 | A1:C10 | ledger | 0.17 |
| Winter Rave #2 | A1:F15 | ticket_rounds | 0.75 |

## קופת קאמפ 25’.xlsx

- sheets: 6
- blocks: 11
- needs review: 4

| sheet | range | archetype | confidence |
| --- | --- | --- | --- |
| סיכום כללי | A1:D9 | ledger | 0.89 |
| סיכום כללי | G1:I4 | account_balances | 0.63 |
| סיכום כללי | A38:D38 | unknown | 0.00 |
| תקציב קאמפ ברן 26 | A1:E26 | budget_lines | 0.96 |
| תקציב קאמפ ברן 26 | A29:F39 | obligations | 0.42 |
| House of trance 270925 | A1:E7 | income_channels | 0.89 |
| Halloween Underground 311025 | A1:E7 | income_channels | 0.89 |
| תקציב רחבה ברן 25 | A1:D26 | event_lines | 0.58 |
| תקציב רחבה ברן 25 | F1:G35 | ledger | 0.49 |
| תקציב רחבה ברן 25 | I1:J12 | event_lines | 0.17 |
| תקציב קאמפ ברן 25 | A1:J32 | budget_lines | 0.91 |

## קופת קאמפ 2026.xlsx

- sheets: 5
- blocks: 8
- needs review: 3

| sheet | range | archetype | confidence |
| --- | --- | --- | --- |
| סיכום כללי | G1:H16 | obligations | 0.72 |
| סיכום כללי | A1:E13 | ledger | 0.89 |
| סיכום כללי | A38:D38 | unknown | 0.00 |
| תקציב קאמפ ברן 26 | A1:J39 | budget_lines | 0.89 |
| תקציב קאמפ ברן 25 | A1:F32 | budget_lines | 0.96 |
| SuperNature 18.7 | A1:M59 | event_lines | 0.71 |
| SuperNature 3.10 | A1:C18 | event_lines | 0.88 |
| SuperNature 3.10 | F1:I12 | ticket_rounds | 0.83 |
