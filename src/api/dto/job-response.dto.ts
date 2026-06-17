import { ApiJob } from '../models/index.js';

export type JobResponseDto = ApiJob | { error: string };
