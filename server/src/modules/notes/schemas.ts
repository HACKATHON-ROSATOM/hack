import { z } from "zod";

// The generator reads a pipe's input schema: raw input has no length cap,
// because the 1–2000 Unicode code point limit applies only after trimming.
const noteContentInputSchema = z
  .string()
  .regex(/\S/)
  .pipe(z.string().trim().min(1).max(2000))
  .meta({
    description:
      "Пробелы по краям удаляются перед проверкой; результат должен содержать от 1 до 2000 кодовых точек Unicode. Исходный текст может содержать пробелы по краям.",
    example: "Пример заметки",
  });

export const createNoteSchema = z
  .strictObject({
    content: noteContentInputSchema,
  })
  .meta({
    id: "CreateNote",
    description: "Данные создаваемой заметки; неизвестные поля отклоняются.",
    example: { content: "Пример заметки" },
  });

export const noteParamsSchema = z
  .strictObject({
    id: z.uuid().meta({ description: "Идентификатор заметки в формате UUID" }),
  })
  .meta({ id: "NoteParams", description: "Идентификатор заметки в пути запроса." });
export const noQuerySchema = z.strictObject({}).meta({
  id: "NoQuery",
  description: "Параметры запроса не поддерживаются.",
});

export const noteResponseSchema = z
  .strictObject({
    id: z.uuid().meta({
      description: "Идентификатор заметки в формате UUID",
      example: "8e5c7ee2-5f05-4f40-b6a2-c62bce1c5328",
    }),
    content: z.string().min(1).max(2000).meta({
      description: "Текст без пробелов по краям, от 1 до 2000 кодовых точек Unicode.",
      example: "Пример заметки",
    }),
    createdAt: z.iso.datetime().meta({
      description: "Время создания в формате ISO 8601 UTC",
      example: "2026-01-01T12:00:00.000Z",
    }),
  })
  .meta({ id: "Note", description: "Сохранённая заметка." });
