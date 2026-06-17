import { Controller, Post, Get, Body, Param, Query, Logger } from '@nestjs/common';
import { ApiService } from './api.service.js';
import { RunCommandDto, HealthResponseDto, LogsResponseDto, JobResponseDto } from './dto/index.js';
import { ApiJob } from './models/index.js';

@Controller()
export class ApiController {
  private readonly logger = new Logger(ApiController.name);

  constructor(private readonly api: ApiService) {}

  @Get('health')
  health(): HealthResponseDto {
    this.logger.log('GET /api/v1/health');
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Post('run')
  async run(@Body() body: RunCommandDto): Promise<ApiJob> {
    this.logger.log(`POST /api/v1/run — command: ${body.command}`);
    return this.api.runCommand(body.command, body.args ?? {});
  }

  @Get('jobs')
  listJobs(): ApiJob[] {
    this.logger.log('GET /api/v1/jobs');
    return this.api.getJobs();
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string): JobResponseDto {
    this.logger.log(`GET /api/v1/jobs/${id}`);
    const job = this.api.getJob(id);
    if (!job) return { error: 'Job not found' };
    return job;
  }

  @Get('logs')
  getLogs(@Query('tail') tail?: string): LogsResponseDto {
    this.logger.log(`GET /api/v1/logs?tail=${tail ?? '100'}`);
    const n = tail ? parseInt(tail, 10) : 100;
    return { logs: this.api.getLogs(n) };
  }
}
