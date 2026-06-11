import type { ToolResult } from '../../domain/schemas/tool-result.schema.js';
import type {
  NavigatorOpenParamsSchema,
  ObserverCaptureParamsSchema,
  ActorClickParamsSchema,
  ActorFillParamsSchema,
  ActorTypeParamsSchema,
  ActorPressParamsSchema,
  ValidatorStateParamsSchema,
  ExplorerScanParamsSchema,
} from '../../domain/schemas/tool-queue.schema.js';
import type { z } from 'zod';

type NavigatorOpenParams = z.infer<typeof NavigatorOpenParamsSchema>;
type ObserverCaptureParams = z.infer<typeof ObserverCaptureParamsSchema>;
type ActorClickParams = z.infer<typeof ActorClickParamsSchema>;
type ActorFillParams = z.infer<typeof ActorFillParamsSchema>;
type ActorTypeParams = z.infer<typeof ActorTypeParamsSchema>;
type ActorPressParams = z.infer<typeof ActorPressParamsSchema>;
type ValidatorStateParams = z.infer<typeof ValidatorStateParamsSchema>;
type ExplorerScanParams = z.infer<typeof ExplorerScanParamsSchema>;

export interface ToolExecutorPort {
  navigatorOpen(params: NavigatorOpenParams): Promise<ToolResult>;
  observerCapture(params: ObserverCaptureParams): Promise<ToolResult>;
  actorClick(params: ActorClickParams): Promise<ToolResult>;
  actorFill(params: ActorFillParams): Promise<ToolResult>;
  actorType(params: ActorTypeParams): Promise<ToolResult>;
  actorPress(params: ActorPressParams): Promise<ToolResult>;
  validatorState(params: ValidatorStateParams): Promise<ToolResult>;
  explorerScan(params: ExplorerScanParams): Promise<ToolResult>;
}
