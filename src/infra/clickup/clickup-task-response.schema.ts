import { z } from 'zod';

export const ClickUpTaskResponseSchema = z
  .object({
    id: z.string().min(1),
    custom_id: z.string().nullable().optional(),
    name: z.string().min(1),
    description: z.string().optional(),
    text_content: z.string().optional(),
    status: z.object({ status: z.string().optional() }).optional(),
    assignees: z
      .array(z.object({ username: z.string().nullable().optional() }))
      .optional(),
    priority: z
      .object({
        id: z.union([z.string(), z.number()]).nullable().optional(),
        priority: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    due_date: z.union([z.string(), z.number()]).nullable().optional(),
    attachments: z
      .array(
        z.object({
          title: z.string().optional(),
          url: z.string().optional(),
          mimetype: z.string().optional(),
          extension: z.string().optional(),
          deleted: z.boolean().optional(),
          hidden: z.boolean().optional(),
        }),
      )
      .optional(),
  })
  .passthrough();

export type ClickUpTaskPayload = z.infer<typeof ClickUpTaskResponseSchema>;
